import { describe, expect, it, vi } from 'vitest';
import { RetentionService } from '../application/retention.service';
import {
  BETA_ONBOARDING_STEPS,
  buildOnboardingStatus,
  redactFeedbackForLog,
  validateFeedbackInput,
  validateOnboardingStepKey,
} from '../domain/retention.policy';

describe('retention policy', () => {
  it('builds incomplete then complete onboarding status', () => {
    const empty = buildOnboardingStatus([]);
    expect(empty.complete).toBe(false);
    expect(empty.totalRequired).toBe(3);
    const done = buildOnboardingStatus(
      BETA_ONBOARDING_STEPS.filter((s) => s.required).map((s) => ({
        stepKey: s.key,
        completedAt: '2026-07-22T00:00:00.000Z',
      })),
    );
    expect(done.complete).toBe(true);
  });

  it('rejects invalid step and feedback', () => {
    expect(() => validateOnboardingStepKey('nope')).toThrow('BETA_ONBOARDING_STEP_INVALID');
    expect(() =>
      validateFeedbackInput({ userId: 'u1', category: 'product', message: 'long enough', idempotencyKey: '' }),
    ).toThrow('BETA_FEEDBACK_IDEMPOTENCY_INVALID');
    expect(redactFeedbackForLog({
      userId: 'u1',
      category: 'product',
      message: 'secret health note',
      idempotencyKey: 'k1',
    }).message).toBe('[REDACTED]');
  });
});

describe('RetentionService', () => {
  it('completes step and returns status; feedback is idempotent', async () => {
    const store = new Map<string, { stepKey: string; completedAt: string }>();
    const feedback = new Map<string, {
      id: string;
      userId: string;
      category: 'product';
      message: string;
      idempotencyKey: string;
      createdAt: string;
    }>();
    const repository = {
      listCompletedSteps: vi.fn(async (userId: string) =>
        [...store.values()].filter(() => userId === 'user-1'),
      ),
      completeStep: vi.fn(async (_userId: string, stepKey: string) => {
        const row = { stepKey, completedAt: '2026-07-22T12:00:00.000Z' };
        store.set(stepKey, row);
        return row;
      }),
      findFeedbackByIdempotency: vi.fn(async (key: string) => feedback.get(key) ?? null),
      insertFeedback: vi.fn(async (input: {
        userId: string;
        category: 'product';
        message: string;
        idempotencyKey: string;
      }) => {
        const row = {
          id: 'fb-1',
          createdAt: '2026-07-22T12:00:00.000Z',
          ...input,
        };
        feedback.set(input.idempotencyKey, row);
        return row;
      }),
    };
    const service = new RetentionService(repository as never);

    const afterWelcome = await service.completeOnboardingStep('user-1', 'welcome');
    expect(afterWelcome.steps.find((s) => s.key === 'welcome')?.completed).toBe(true);

    const first = await service.submitFeedback({
      userId: 'user-1',
      category: 'product',
      message: 'Great beta so far',
      idempotencyKey: 'idem-1',
    });
    const second = await service.submitFeedback({
      userId: 'user-1',
      category: 'product',
      message: 'Great beta so far',
      idempotencyKey: 'idem-1',
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.feedback.id).toBe(first.feedback.id);
    expect(repository.insertFeedback).toHaveBeenCalledTimes(1);
  });
});
