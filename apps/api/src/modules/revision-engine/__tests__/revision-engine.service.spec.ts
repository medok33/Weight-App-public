import { describe, expect, it } from 'vitest';
import { validateRevision, validatePreviewRequest } from '../domain/revision-engine.policy';
import { hashSnapshot, issueConfirmationToken, verifyConfirmationToken, validateIdempotencyKey } from '../domain/revision-confirmation.token';
import { buildMealProposal, buildWorkoutProposal } from '../domain/revision-proposal.policy';
import { RevisionEngineService } from '../application/revision-engine.service';
import { InMemoryRevisionEngineRepository } from '../infrastructure/revision-engine.repository.memory';
import { RevisionEngineRepository } from '../infrastructure/revision-engine.repository';
import type { PlanRevision, RevisionResult } from '../domain/revision-engine.types';
import { parsePreviewBody, parseConfirmBody } from '../dto/revision-engine.request.dto';

const baseRequest = {
  userId: 'user-1',
  planId: 'plan-1',
  planKind: 'meal' as const,
  reason: 'travel',
  confirmed: false,
  snapshot: { version: 1, days: [] },
};

function isPlanRevision(value: RevisionResult | PlanRevision): value is PlanRevision {
  return 'id' in value && 'version' in value;
}

describe('revision engine policy', () => {
  it('requires confirmation for final state', () => {
    expect(validateRevision(baseRequest).status).toBe('pending');
  });

  it('rejects missing plan reference', () => {
    expect(() => validateRevision({ ...baseRequest, planId: '' })).toThrow('REVISION_PLAN_REQUIRED');
  });

  it('rejects missing snapshot', () => {
    expect(() => validateRevision({ ...baseRequest, snapshot: undefined as never })).toThrow('REVISION_SNAPSHOT_REQUIRED');
  });

  it('validates preview reason', () => {
    expect(() => validatePreviewRequest({ planId: 'p', planKind: 'meal', reason: '' })).toThrow('REVISION_REASON_REQUIRED');
  });
});

describe('confirmation token', () => {
  it('binds token to user and plan', () => {
    const snapshot = { kind: 'meal', days: [] };
    const token = issueConfirmationToken({
      userId: 'u1',
      planId: 'p1',
      planKind: 'meal',
      sourceVersion: 1,
      reason: 'travel',
      snapshotHash: hashSnapshot(snapshot),
    });
    const payload = verifyConfirmationToken(token, { userId: 'u1', planId: 'p1', planKind: 'meal' });
    expect(payload.sourceVersion).toBe(1);
    expect(() => verifyConfirmationToken(token, { userId: 'u2', planId: 'p1', planKind: 'meal' })).toThrow(
      'REVISION_TOKEN_FORBIDDEN',
    );
  });

  it('validates idempotency key format', () => {
    expect(validateIdempotencyKey('abcd-1234')).toBe('abcd-1234');
    expect(() => validateIdempotencyKey('short')).toThrow('REVISION_IDEMPOTENCY_KEY_INVALID');
  });
});

describe('proposal policy', () => {
  it('builds deterministic meal proposal for travel', () => {
    const proposal = buildMealProposal(
      {
        planId: 'p1',
        version: 1,
        days: [{ dayIndex: 0, meals: [{ name: 'oats' }] }],
      },
      'travel week',
    );
    expect(proposal.changedItems.length).toBe(1);
    expect(proposal.snapshot.days).toBeTruthy();
  });

  it('builds workout proposal excluding high risk for injury', () => {
    const proposal = buildWorkoutProposal(
      {
        planId: 'w1',
        version: 1,
        days: [{ dayIndex: 0, exercises: [{ name: 'light_jog', riskLevel: 'medium' }] }],
      },
      'knee injury',
    );
    expect(proposal.changedItems[0]?.proposedValue).toBe('recovery_walk');
  });
});

describe('request dto', () => {
  it('rejects unknown fields', () => {
    expect(() => parsePreviewBody({ planKind: 'meal', reason: 'x', userId: 'hack' })).toThrow('REVISION_UNKNOWN_FIELD');
    expect(() => parseConfirmBody({ planKind: 'meal', confirmationToken: 't', extra: 1 })).toThrow('REVISION_UNKNOWN_FIELD');
  });
});

describe('revision engine service', () => {
  it('revise() without confirmation does not persist', async () => {
    const repository = new InMemoryRevisionEngineRepository();
    const service = new RevisionEngineService(repository as unknown as RevisionEngineRepository);
    const result = await service.revise(baseRequest);
    expect(result).toEqual({ status: 'pending', reason: 'travel' });
    expect(await repository.listByPlan('user-1', 'plan-1', 'meal')).toHaveLength(0);
  });

  it('revise() with confirmation persists via repository', async () => {
    const repository = new InMemoryRevisionEngineRepository();
    const service = new RevisionEngineService(repository as unknown as RevisionEngineRepository);
    const result = await service.revise({ ...baseRequest, confirmed: true });
    expect(isPlanRevision(result)).toBe(true);
    if (!isPlanRevision(result)) return;
    expect(result.status).toBe('confirmed');
    expect(result.version).toBe(1);
  });

  it('createRevision requires confirmation', async () => {
    const repository = new InMemoryRevisionEngineRepository();
    const service = new RevisionEngineService(repository as unknown as RevisionEngineRepository);
    await expect(service.createRevision(baseRequest)).rejects.toThrow('REVISION_CONFIRMATION_REQUIRED');
  });

  it('memory idempotency returns same revision for same key+hash', async () => {
    const repository = new InMemoryRevisionEngineRepository();
    const first = await repository.create({
      userId: 'u',
      planId: 'p',
      planKind: 'meal',
      version: 0,
      reason: 'travel',
      status: 'confirmed',
      snapshot: { a: 1 },
      idempotencyKey: 'idem-0001',
      requestHash: 'hash-a',
    });
    const second = await repository.create({
      userId: 'u',
      planId: 'p',
      planKind: 'meal',
      version: 0,
      reason: 'travel',
      status: 'confirmed',
      snapshot: { a: 1 },
      idempotencyKey: 'idem-0001',
      requestHash: 'hash-a',
    });
    expect(second.id).toBe(first.id);
    await expect(
      repository.create({
        userId: 'u',
        planId: 'p',
        planKind: 'meal',
        version: 0,
        reason: 'other',
        status: 'confirmed',
        snapshot: { a: 2 },
        idempotencyKey: 'idem-0001',
        requestHash: 'hash-b',
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('revision engine module wiring', () => {
  it('uses PostgreSQL repository in production module', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../revision-engine.module.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain('RevisionEngineRepository');
    expect(source).not.toContain('InMemoryRevisionEngineRepository');
    expect(source).toContain('DatabaseModule');
    expect(source).toContain('RevisionEngineController');
  });
});
