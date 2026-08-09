import type {
  BetaFeedbackCategory,
  BetaFeedbackInput,
  BetaOnboardingStatus,
  BetaOnboardingStep,
  BetaOnboardingStepKey,
} from './retention.types';

export const BETA_ONBOARDING_STEPS: readonly BetaOnboardingStep[] = [
  { key: 'welcome', title: 'Welcome to closed beta', required: true },
  { key: 'profile_goal', title: 'Confirm profile and goal', required: true },
  { key: 'meal_plan_intro', title: 'Open meal plan once', required: true },
  { key: 'feedback_invite', title: 'Leave first feedback', required: false },
];

const FEEDBACK_CATEGORIES: readonly BetaFeedbackCategory[] = ['product', 'safety', 'ux', 'other'];

export function validateOnboardingStepKey(stepKey: string): BetaOnboardingStepKey {
  const found = BETA_ONBOARDING_STEPS.find((s) => s.key === stepKey);
  if (!found) throw new Error('BETA_ONBOARDING_STEP_INVALID');
  return found.key;
}

export function buildOnboardingStatus(
  completed: ReadonlyArray<{ stepKey: string; completedAt: string }>,
): BetaOnboardingStatus {
  const byKey = new Map(completed.map((c) => [c.stepKey, c.completedAt]));
  const steps = BETA_ONBOARDING_STEPS.map((step) => ({
    ...step,
    completed: byKey.has(step.key),
    completedAt: byKey.get(step.key) ?? null,
  }));
  const required = steps.filter((s) => s.required);
  const completedCount = required.filter((s) => s.completed).length;
  return {
    steps,
    completedCount,
    totalRequired: required.length,
    complete: completedCount === required.length,
  };
}

export function validateFeedbackInput(input: {
  userId?: string;
  category?: string;
  message?: string;
  idempotencyKey?: string;
}): BetaFeedbackInput {
  const userId = input.userId?.trim() ?? '';
  const category = input.category?.trim() as BetaFeedbackCategory;
  const message = input.message?.trim() ?? '';
  const idempotencyKey = input.idempotencyKey?.trim() ?? '';
  if (!userId) throw new Error('BETA_FEEDBACK_INVALID');
  if (!FEEDBACK_CATEGORIES.includes(category)) throw new Error('BETA_FEEDBACK_CATEGORY_INVALID');
  if (message.length < 3 || message.length > 2000) throw new Error('BETA_FEEDBACK_MESSAGE_INVALID');
  if (!idempotencyKey || idempotencyKey.length > 128) throw new Error('BETA_FEEDBACK_IDEMPOTENCY_INVALID');
  return { userId, category, message, idempotencyKey };
}

/** Never log raw feedback message (may contain PII / health notes). */
export function redactFeedbackForLog(input: BetaFeedbackInput): Record<string, string> {
  return {
    userId: input.userId,
    category: input.category,
    idempotencyKey: input.idempotencyKey,
    message: '[REDACTED]',
  };
}
