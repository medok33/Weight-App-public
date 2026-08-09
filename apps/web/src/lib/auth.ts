import { ApiError } from './api-fetch';
import { clearStoredUserId, getStoredUserId } from './user-context';

export type AuthUser = {
  id: string;
  email: string | null;
  username?: string | null;
  role: string;
  tier?: 'FREE' | 'PREMIUM';
};

let cachedUser: AuthUser | null | undefined;

export function clearAuthCache() {
  cachedUser = undefined;
}

/** Same-origin BFF so session cookies are stored on localhost:3000, not cross-origin :3001. */
async function authBffFetch(path: string, init?: RequestInit): Promise<Response> {
  const suffix = path.startsWith('/auth') ? path.slice('/auth'.length) : path;
  const url = `/api/auth${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  try {
    return await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
}

export async function getCurrentUser(force = false): Promise<AuthUser | null> {
  if (!force && cachedUser !== undefined) return cachedUser;
  const response = await authBffFetch('/auth/me');
  if (response.status === 401) {
    cachedUser = null;
    return null;
  }
  if (!response.ok) throw new ApiError(response.status);
  cachedUser = (await response.json()) as AuthUser;
  return cachedUser;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const response = await authBffFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, anonymousUserId: getStoredUserId() }),
  });
  if (!response.ok) throw new ApiError(response.status, 'AUTH_REGISTER_FAILED');
  clearStoredUserId();
  clearAuthCache();
  const user = await getCurrentUser(true);
  if (!user) throw new ApiError(401, 'AUTH_REQUIRED');
  return user;
}

export async function login(identifier: string, password: string): Promise<AuthUser> {
  const response = await authBffFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password, anonymousUserId: getStoredUserId() }),
  });
  if (!response.ok) throw new ApiError(response.status, 'AUTH_LOGIN_FAILED');
  clearStoredUserId();
  clearAuthCache();
  const user = await getCurrentUser(true);
  if (!user) throw new ApiError(401, 'AUTH_REQUIRED');
  return user;
}

export async function logout(): Promise<void> {
  await authBffFetch('/auth/logout', { method: 'POST' });
  cachedUser = null;
}

export function isStaffRole(role: string | undefined | null): boolean {
  return hasAdminCapabilities(role);
}

export function isOwnerRole(role: string | undefined | null): boolean {
  const normalized = String(role ?? '').toUpperCase();
  return normalized === 'OWNER';
}

/** Exact ADMIN role only (does not include OWNER). Prefer hasAdminCapabilities for capability checks. */
export function isAdminRole(role: string | undefined | null): boolean {
  const normalized = String(role ?? '').toUpperCase();
  return normalized === 'ADMIN';
}

/** OWNER supersedes ADMIN for administrative capability checks. */
export function hasAdminCapabilities(role: string | undefined | null): boolean {
  const normalized = String(role ?? '').toUpperCase();
  return normalized === 'OWNER' || normalized === 'ADMIN';
}

/** OWNER / ADMIN / USER hierarchy: OWNER satisfies every lower tier. */
export function roleSatisfies(actorRole: string | undefined | null, allowed: Array<'USER' | 'ADMIN' | 'OWNER'>): boolean {
  const rank: Record<string, number> = { USER: 1, ADMIN: 2, OWNER: 3 };
  const actor = String(actorRole ?? '').toUpperCase();
  const actorRank = rank[actor] ?? 0;
  if (!allowed.length) return true;
  return allowed.some((required) => actorRank >= (rank[required] ?? 99));
}
