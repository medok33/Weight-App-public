import { apiFetch, ApiError } from '@/lib/api-fetch';

export type ActivityConsentState = 'NOT_GRANTED' | 'GRANTED' | 'REVOKED';
export type ActivityConnectionState = 'NOT_CONNECTED' | 'CONNECTED' | 'DISCONNECTED';
export type ActivitySyncHealth =
  | 'BLOCKED_BY_CONSENT'
  | 'BLOCKED_BY_DISCONNECT'
  | 'NEVER_SYNCED'
  | 'HEALTHY'
  | 'STALE';

export type ActivityProviderStatus = {
  source: 'HEALTHKIT' | 'HEALTH_CONNECT';
  consentState: ActivityConsentState;
  connectionState: ActivityConnectionState;
  syncHealth: ActivitySyncHealth;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSuccessfulSyncAt: string | null;
};

export type ActivityConnectionsResponse = {
  timeZone: string;
  staleAfterHours: number;
  providers: ActivityProviderStatus[];
};

export type ActivityTodayResponse = {
  localDate: string;
  timeZone: string;
  dataState: 'NO_DATA' | 'SYNCED';
  steps: number | null;
  source: 'HEALTHKIT' | 'HEALTH_CONNECT' | null;
  lastSyncedAt: string | null;
  targetSteps: number | null;
  remainingSteps: number | null;
};

export async function getActivityToday(): Promise<ActivityTodayResponse> {
  const response = await apiFetch('/activity/today');
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<ActivityTodayResponse>;
}

export async function getActivityConnections(): Promise<ActivityConnectionsResponse> {
  const response = await apiFetch('/activity/connections');
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<ActivityConnectionsResponse>;
}

export async function disconnectActivityProvider(
  source: 'HEALTHKIT' | 'HEALTH_CONNECT',
): Promise<ActivityProviderStatus> {
  const response = await apiFetch(`/activity/connections/${source}/disconnect`, {
    method: 'POST',
  });
  if (response.status === 401) throw new ApiError(401);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<ActivityProviderStatus>;
}
