/**
 * Browser vs server API base separation (BUGFIX-PROFILE-SAVE-01).
 *
 * - Browser: always same-origin `/api/v1` (Next rewrite → Nest).
 * - Server/BFF: INTERNAL_API_BASE_URL / API_BASE_URL only (never NEXT_PUBLIC_*).
 */

export const SAME_ORIGIN_API_BASE = '/api/v1';

const DEFAULT_INTERNAL_API_BASE = 'http://127.0.0.1:3001/api/v1';

/** Loose env bag — accepts Node `ProcessEnv` without weak-type assignability errors. */
export type ApiBaseEnv = Record<string, string | undefined>;

function readEnv(env?: ApiBaseEnv): ApiBaseEnv {
  if (env) return env;
  return typeof process !== 'undefined' ? process.env : {};
}

/** Strip trailing slashes without turning "/" into "". */
export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '') || '/';
}

/**
 * Ensure an absolute or relative API root ends with `/api/v1` exactly once.
 * Does not invent double `/api/v1/api/v1`.
 */
export function ensureApiV1Base(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return SAME_ORIGIN_API_BASE;
  const base = stripTrailingSlash(trimmed);
  if (base === SAME_ORIGIN_API_BASE || base.endsWith(SAME_ORIGIN_API_BASE)) {
    return base === '/' ? SAME_ORIGIN_API_BASE : base;
  }
  if (base === '/') return SAME_ORIGIN_API_BASE;
  return `${base}${SAME_ORIGIN_API_BASE}`;
}

/**
 * Browser public API base. Absolute NEXT_PUBLIC_* values are ignored so Nest
 * hosts (e.g. localhost:3001) never leak into client fetches.
 */
export function browserApiBaseUrl(env?: ApiBaseEnv): string {
  const configured = readEnv(env).NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!configured) return SAME_ORIGIN_API_BASE;
  // Only allow the same-origin relative path; never absolute Nest URLs.
  const normalized = stripTrailingSlash(configured);
  if (normalized === SAME_ORIGIN_API_BASE) return SAME_ORIGIN_API_BASE;
  return SAME_ORIGIN_API_BASE;
}

/**
 * Server-only Nest upstream for Next rewrites / BFF.
 * Does not read NEXT_PUBLIC_* (must not enter browser bundles as a dependency of client code).
 */
export function resolveInternalApiBaseUrl(env?: ApiBaseEnv): string {
  const bag = readEnv(env);
  const explicit = bag.INTERNAL_API_BASE_URL?.trim() || bag.API_BASE_URL?.trim();
  if (explicit) return ensureApiV1Base(explicit);
  return DEFAULT_INTERNAL_API_BASE;
}

/**
 * Join API base + path without producing `/api/v1/api/v1/...`.
 * Absolute http(s) paths are returned unchanged (escape hatch for tests only).
 */
export function joinApiPath(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const root = stripTrailingSlash(base);
  let suffix = path.startsWith('/') ? path : `/${path}`;
  if (root.endsWith(SAME_ORIGIN_API_BASE) && (suffix === SAME_ORIGIN_API_BASE || suffix.startsWith(`${SAME_ORIGIN_API_BASE}/`))) {
    suffix = suffix.slice(SAME_ORIGIN_API_BASE.length) || '/';
  }
  if (suffix === '/') return root;
  return `${root}${suffix}`;
}

/** True when a request URL is a forbidden browser→Nest direct hit on /profile. */
export function isDirectNestProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'http://localhost');
    const hostPort = `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
    const isLocalNest =
      hostPort === 'localhost:3001' ||
      hostPort === '127.0.0.1:3001' ||
      parsed.host === 'localhost:3001' ||
      parsed.host === '127.0.0.1:3001';
    if (!isLocalNest) return false;
    return parsed.pathname === '/profile' || parsed.pathname === '/profile/';
  } catch {
    return /https?:\/\/(localhost|127\.0\.0\.1):3001\/profile\/?(\?|$)/.test(url);
  }
}
