import { apiFetch, ApiError } from '@/lib/api-fetch';
import type { UserGoal, UserProfile } from '../model/user-profile.types';

export async function getUserProfile(): Promise<UserProfile | null> {
  const response = await apiFetch('/profile');
  if (response.status === 404) return null;
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<UserProfile>;
}

export async function saveUserProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
  const response = await apiFetch('/profile', { method: 'PUT', body: JSON.stringify(profile) });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<UserProfile>;
}

/** @deprecated use saveUserProfile */
export const putUserProfile = saveUserProfile;

export async function getUserGoal(): Promise<UserGoal | null> {
  const response = await apiFetch('/goal');
  if (response.status === 404) return null;
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<UserGoal>;
}

export async function saveUserGoal(goal: Partial<UserGoal>): Promise<UserGoal> {
  const response = await apiFetch('/goal', { method: 'PUT', body: JSON.stringify(goal) });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<UserGoal>;
}

/** @deprecated use saveUserGoal */
export const putUserGoal = saveUserGoal;
