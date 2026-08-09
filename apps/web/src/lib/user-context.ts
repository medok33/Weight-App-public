import { browserApiBaseUrl, joinApiPath } from './api-base';

const STORAGE_KEY = 'weight-app.user-id';

function apiBase() {
  return browserApiBaseUrl();
}

/** Legacy anonymous id — used only for one-time migration on register/login. */
export function getStoredUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredUserId(userId: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, userId);
}

export function clearStoredUserId() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export async function bootstrapAnonymousUserId(): Promise<string> {
  const response = await fetch(joinApiPath(apiBase(), '/user-context/bootstrap'), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('USER_CONTEXT_BOOTSTRAP_FAILED');
  const data = (await response.json()) as { userId: string };
  setStoredUserId(data.userId);
  return data.userId;
}

/**
 * @deprecated Do not use for authorization. Prefer getCurrentUser() from auth.ts.
 * Kept for anonymous bootstrap before login/register.
 */
export async function getUserId(): Promise<string> {
  const existing = getStoredUserId();
  if (existing) return existing;
  return bootstrapAnonymousUserId();
}
