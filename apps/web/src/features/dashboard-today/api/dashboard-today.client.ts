import { apiFetch, ApiError } from '@/lib/api-fetch';

export async function getDashboardToday() {
  const response = await apiFetch('/dashboard/today');
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}
