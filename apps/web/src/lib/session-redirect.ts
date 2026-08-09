/**
 * Safe post-login return path helpers.
 * Query param remains `next` for backward compatibility; `returnTo` is accepted as an alias.
 */

const AUTH_ENTRY_PATHS = new Set(['/login', '/register']);

export function isAuthEntryPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '/';
  return AUTH_ENTRY_PATHS.has(path);
}

/** Reject open redirects and auth loops. */
export function safeReturnTo(raw: string | null | undefined, fallback = '/dashboard-today'): string {
  if (!raw) return fallback;
  let trimmed = raw.trim();
  // Decode once so encoded //, javascript:, and backslash tricks are visible.
  try {
    trimmed = decodeURIComponent(trimmed);
  } catch {
    return fallback;
  }
  trimmed = trimmed.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('/\u005c')) return fallback;
  if (/[\\]/.test(trimmed)) return fallback;
  if (trimmed.includes('://')) return fallback;
  if (/^\/\s*javascript:/i.test(trimmed) || /javascript:/i.test(trimmed)) return fallback;
  const pathOnly = trimmed.split('?')[0] || '/';
  if (isAuthEntryPath(pathOnly)) return fallback;
  // Only allow relative app paths (no scheme-relative / host tricks).
  if (!/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/.test(trimmed.split('#')[0] || '/')) return fallback;
  return trimmed;
}

export function readReturnToParam(searchParams: { get(name: string): string | null }): string {
  return safeReturnTo(searchParams.get('returnTo') ?? searchParams.get('next'));
}

export function loginUrlWithReturnTo(pathname: string): string {
  const next = encodeURIComponent(safeReturnTo(pathname));
  return `/login?next=${next}`;
}
