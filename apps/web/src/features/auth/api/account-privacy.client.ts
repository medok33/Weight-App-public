export type AccountSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  deviceLabel: string | null;
  current: boolean;
};

export async function listAccountSessions(): Promise<{ sessions: AccountSession[] }> {
  return request('/api/v1/auth/sessions');
}

export async function revokeAccountSession(sessionId: string): Promise<{ ok: true }> {
  return request(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST' });
}

export async function revokeOtherAccountSessions(): Promise<{ ok: true }> {
  return request('/api/v1/auth/sessions/revoke-others', { method: 'POST' });
}

export async function exportAccountPrivacy(): Promise<unknown> {
  return request('/api/v1/auth/privacy/export', { method: 'POST' });
}

export async function deleteAccountPrivacy(confirmation: string): Promise<{ ok: true }> {
  return request('/api/v1/auth/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = body?.error?.code ?? 'ACCOUNT_PRIVACY_REQUEST_FAILED';
    throw new Error(code);
  }
  return response.json() as Promise<T>;
}
