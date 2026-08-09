import type { ObservabilityDashboard, ObservabilityOperations } from '../model/observability.types';

export async function getObservabilityOperations(): Promise<ObservabilityOperations> {
  const response = await fetch('/api/observability/operations', { credentials: 'include', cache: 'no-store' });
  if (response.status === 401 || response.status === 403) throw new Error('OWNER_ACCESS_FORBIDDEN');
  if (!response.ok) throw new Error('OBSERVABILITY_REQUEST_FAILED');
  return response.json() as Promise<ObservabilityOperations>;
}

export async function getObservabilityDashboard(): Promise<ObservabilityDashboard> {
  const response = await fetch('/api/observability/dashboard', { credentials: 'include', cache: 'no-store' });
  if (response.status === 401 || response.status === 403) throw new Error('OWNER_ACCESS_FORBIDDEN');
  if (!response.ok) throw new Error('OBSERVABILITY_REQUEST_FAILED');
  return response.json() as Promise<ObservabilityDashboard>;
}
