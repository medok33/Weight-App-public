import type { BrowserSecurityConfig } from './browser-security.config';
import { getBrowserSecurityConfig } from './browser-security.config';

/** Legacy cookie cleared on logout; not used as an auth stack. */
export const LEGACY_OWNER_SESSION_COOKIE = 'owner_session';
/** Pre-ARCH-SEC-02A cookie name; cleared on logout to avoid cross-env leakage. */
export const LEGACY_USER_SESSION_COOKIE = 'wa_session';

export function getSessionCookieName(config: BrowserSecurityConfig = getBrowserSecurityConfig()): string {
  return config.cookie.name;
}

/** @deprecated Prefer getSessionCookieName() — kept for call sites that need a sync constant at module load. */
export const USER_SESSION_COOKIE = 'wa_session_local';

export function parseCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  const part = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : undefined;
}

function cookieAttributeString(
  config: BrowserSecurityConfig,
  maxAgeSeconds: number,
): string {
  const parts = [
    'HttpOnly',
    `Path=${config.cookie.path}`,
    `SameSite=${config.cookie.sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.cookie.secure) parts.push('Secure');
  if (config.cookie.domain) parts.push(`Domain=${config.cookie.domain}`);
  return parts.join('; ');
}

export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
  config: BrowserSecurityConfig = getBrowserSecurityConfig(),
): string {
  const attrs = cookieAttributeString(config, maxAgeSeconds);
  return `${config.cookie.name}=${encodeURIComponent(token)}; ${attrs}`;
}

export function clearSessionCookie(config: BrowserSecurityConfig = getBrowserSecurityConfig()): string {
  // Mirror set-cookie Domain/Path/SameSite/Secure so browsers actually clear the cookie.
  const attrs = cookieAttributeString(config, 0);
  return `${config.cookie.name}=; ${attrs}`;
}

export function clearLegacyOwnerSessionCookie(
  config: BrowserSecurityConfig = getBrowserSecurityConfig(),
): string {
  const attrs = cookieAttributeString(config, 0);
  return `${LEGACY_OWNER_SESSION_COOKIE}=; ${attrs}`;
}

export function clearLegacyUserSessionCookie(
  config: BrowserSecurityConfig = getBrowserSecurityConfig(),
): string {
  const attrs = cookieAttributeString(config, 0);
  return `${LEGACY_USER_SESSION_COOKIE}=; ${attrs}`;
}

export function readSessionTokenFromCookieHeader(
  cookieHeader: string | undefined,
  config: BrowserSecurityConfig = getBrowserSecurityConfig(),
): string | undefined {
  return (
    parseCookieValue(cookieHeader, config.cookie.name) ??
    // Accept legacy name only in LOCAL to avoid breaking in-flight local sessions during rollout.
    (config.appEnv === 'LOCAL' ? parseCookieValue(cookieHeader, LEGACY_USER_SESSION_COOKIE) : undefined)
  );
}

/** Resolve session token from x-session-token header or env-specific session cookie. */
export function resolveSessionTokenFromHeaders(input: {
  token?: string;
  cookie?: string;
  config?: BrowserSecurityConfig;
}): string | undefined {
  if (input.token?.trim()) return input.token.trim().replace(/^Bearer\s+/i, '');
  return readSessionTokenFromCookieHeader(input.cookie, input.config);
}
