import { getUserGoal, getUserProfile } from '@/features/user-profile/api/user-profile.client';
import { hasAdminCapabilities, isOwnerRole } from '@/lib/auth';
import { ApiError } from '@/lib/api-fetch';

export type OnboardingCompletionStatus = 'complete' | 'incomplete' | 'unknown';

/**
 * Single completion predicate for UX-STAB-01F.
 * - complete: profile AND goal readable (GET 200)
 * - incomplete: definitive absence (404 / null) of profile and/or goal
 * - unknown: transient network/5xx — must NOT be treated as incomplete
 */
export async function getOnboardingCompletionStatus(): Promise<OnboardingCompletionStatus> {
  try {
    const [profile, goal] = await Promise.all([getUserProfile(), getUserGoal()]);
    if (profile && goal) return 'complete';
    return 'incomplete';
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return 'unknown';
  }
}

/** True only when status is definitively complete. */
export async function hasCompletedProfileOnboarding(): Promise<boolean> {
  return (await getOnboardingCompletionStatus()) === 'complete';
}

export function shouldBypassUserOnboarding(role: string | undefined | null): boolean {
  return isOwnerRole(role) || hasAdminCapabilities(role);
}

export function isOnboardingExemptPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '/';
  if (path === '/onboarding' || path === '/settings') return true;
  if (path === '/login' || path === '/register') return true;
  if (path.startsWith('/admin')) return true;
  if (path.startsWith('/owner')) return true;
  if (path.startsWith('/observability')) return true;
  if (path.startsWith('/price-intelligence')) return true;
  return false;
}

/**
 * After login/register: OWNER/ADMIN keep safeReturnTo;
 * definitive incomplete USER → onboarding;
 * unknown (transient API failure) → requested path (do not fake incomplete / do not throw into auth errors).
 */
export async function resolvePostAuthDestination(
  role: string | undefined | null,
  requestedSafePath: string,
): Promise<string> {
  if (shouldBypassUserOnboarding(role)) return requestedSafePath;
  try {
    const status = await getOnboardingCompletionStatus();
    if (status === 'incomplete') return '/onboarding';
    return requestedSafePath;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return requestedSafePath;
  }
}
