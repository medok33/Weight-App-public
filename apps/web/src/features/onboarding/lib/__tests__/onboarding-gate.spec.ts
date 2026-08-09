import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getOnboardingCompletionStatus,
  isOnboardingExemptPath,
  resolvePostAuthDestination,
  shouldBypassUserOnboarding,
} from '../onboarding-gate';
import { ApiError } from '@/lib/api-fetch';

vi.mock('@/features/user-profile/api/user-profile.client', () => ({
  getUserProfile: vi.fn(),
  getUserGoal: vi.fn(),
}));

import { getUserGoal, getUserProfile } from '@/features/user-profile/api/user-profile.client';

describe('onboarding-gate', () => {
  beforeEach(() => {
    vi.mocked(getUserProfile).mockReset();
    vi.mocked(getUserGoal).mockReset();
  });

  it('bypasses OWNER and ADMIN', () => {
    expect(shouldBypassUserOnboarding('OWNER')).toBe(true);
    expect(shouldBypassUserOnboarding('ADMIN')).toBe(true);
    expect(shouldBypassUserOnboarding('USER')).toBe(false);
    expect(shouldBypassUserOnboarding(undefined)).toBe(false);
  });

  it('exempts onboarding, settings, auth, and admin workspace paths', () => {
    expect(isOnboardingExemptPath('/onboarding')).toBe(true);
    expect(isOnboardingExemptPath('/settings')).toBe(true);
    expect(isOnboardingExemptPath('/login')).toBe(true);
    expect(isOnboardingExemptPath('/admin/content')).toBe(true);
    expect(isOnboardingExemptPath('/owner-admin')).toBe(true);
    expect(isOnboardingExemptPath('/dashboard-today')).toBe(false);
    expect(isOnboardingExemptPath('/meal-plan')).toBe(false);
  });

  it('marks complete only when profile and goal both exist', async () => {
    vi.mocked(getUserProfile).mockResolvedValue({ displayName: 'A' } as never);
    vi.mocked(getUserGoal).mockResolvedValue({ target: 70 } as never);
    expect(await getOnboardingCompletionStatus()).toBe('complete');
  });

  it('marks incomplete when profile or goal missing', async () => {
    vi.mocked(getUserProfile).mockResolvedValue({ displayName: 'A' } as never);
    vi.mocked(getUserGoal).mockResolvedValue(null);
    expect(await getOnboardingCompletionStatus()).toBe('incomplete');

    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(getUserGoal).mockResolvedValue({ target: 70 } as never);
    expect(await getOnboardingCompletionStatus()).toBe('incomplete');
  });

  it('marks unknown on transient server/network errors', async () => {
    vi.mocked(getUserProfile).mockRejectedValue(new ApiError(503));
    vi.mocked(getUserGoal).mockResolvedValue(null);
    expect(await getOnboardingCompletionStatus()).toBe('unknown');
  });

  it('resolvePostAuthDestination sends incomplete USER to onboarding and keeps path on unknown', async () => {
    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(getUserGoal).mockResolvedValue(null);
    expect(await resolvePostAuthDestination('USER', '/meal-plan')).toBe('/onboarding');

    vi.mocked(getUserProfile).mockRejectedValue(new ApiError(0));
    expect(await resolvePostAuthDestination('USER', '/meal-plan')).toBe('/meal-plan');

    expect(await resolvePostAuthDestination('OWNER', '/admin/content')).toBe('/admin/content');
  });
});
