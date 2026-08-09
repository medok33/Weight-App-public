import { apiFetch, ApiError } from '@/lib/api-fetch';
import type { ProgressSummary } from '../model/progress.types';

export async function getProgressSummary(): Promise<ProgressSummary> {
  const response = await apiFetch('/progress');
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<ProgressSummary>;
}

export async function addProgressWeight(weightKg: number): Promise<ProgressSummary> {
  const response = await apiFetch('/progress', {
    method: 'POST',
    body: JSON.stringify({ weightKg, measuredAt: new Date().toISOString() }),
  });
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  const data = (await response.json()) as { summary: ProgressSummary };
  return data.summary;
}
