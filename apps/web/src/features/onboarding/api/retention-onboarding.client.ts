import { apiFetch, ApiError } from '@/lib/api-fetch';

export type OnboardingStepKey = 'welcome' | 'profile_goal' | 'meal_plan_intro' | 'feedback_invite';

export type BetaOnboardingStatus = {
  steps: Array<{
    key: OnboardingStepKey;
    title: string;
    required: boolean;
    completed: boolean;
    completedAt: string | null;
  }>;
  completedCount: number;
  totalRequired: number;
  complete: boolean;
};

export async function getBetaOnboardingStatus(): Promise<BetaOnboardingStatus | null> {
  const response = await apiFetch('/retention/beta-onboarding');
  if (response.status === 404) return null;
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<BetaOnboardingStatus>;
}

export async function completeBetaOnboardingStep(stepKey: OnboardingStepKey): Promise<BetaOnboardingStatus> {
  const response = await apiFetch('/retention/beta-onboarding/complete', {
    method: 'POST',
    body: JSON.stringify({ stepKey }),
  });
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<BetaOnboardingStatus>;
}
