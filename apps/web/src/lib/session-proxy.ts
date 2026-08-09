import { cookies } from 'next/headers';
import {
  browserMutationOriginAllowed,
  loadBrowserSecurityConfig,
  sessionCookieNameForEnv,
  type BrowserSecurityConfig,
} from './browser-security';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const CSRF_ORIGIN_REJECTED = 'CSRF_ORIGIN_REJECTED';

let cachedConfig: BrowserSecurityConfig | null = null;

export function getWebBrowserSecurityConfig(): BrowserSecurityConfig {
  if (!cachedConfig) {
    cachedConfig = loadBrowserSecurityConfig(process.env);
  }
  return cachedConfig;
}

export function resetWebBrowserSecurityConfigCache(): void {
  cachedConfig = null;
}

/** Must stay aligned with API sessionCookieNameForEnv / ARCH-SEC-02A. */
export function sessionCookieName(): string {
  return sessionCookieNameForEnv(getWebBrowserSecurityConfig().appEnv);
}

/**
 * ARCH-SEC-02A BFF boundary:
 * For unsafe methods, validate Origin/Referer BEFORE reading wa_session_* cookies
 * and converting them to x-session-token for NestJS.
 *
 * NestJS CsrfOriginGuard alone is insufficient because the BFF strips the browser
 * cookie and forwards only x-session-token (header-auth path on the API).
 */
export function browserMutationOriginRejected(request: Request): Response | null {
  const method = String(request.method ?? 'GET').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return null;

  const config = getWebBrowserSecurityConfig();
  const allowed = browserMutationOriginAllowed({
    origin: request.headers.get('origin') ?? undefined,
    referer: request.headers.get('referer') ?? undefined,
    allowedOrigins: config.allowedOrigins,
  });
  if (allowed) return null;

  const requestId =
    request.headers.get('x-request-id') ?? request.headers.get('x-correlation-id') ?? undefined;
  return new Response(
    JSON.stringify({
      code: CSRF_ORIGIN_REJECTED,
      message: 'Origin check failed',
      ...(requestId ? { requestId } : {}),
    }),
    {
      status: 403,
      headers: { 'content-type': 'application/json' },
    },
  );
}

async function readSessionTokenFromJar(): Promise<string | undefined> {
  const jar = await cookies();
  const config = getWebBrowserSecurityConfig();
  return (
    jar.get(config.cookie.name)?.value ??
    // Legacy pre-ARCH-SEC-02A name (LOCAL rollout only).
    (config.appEnv === 'LOCAL' ? jar.get('wa_session')?.value : undefined)
  );
}

/** Safe reads (GET) may call this without Origin checks. */
export async function getSessionTokenFromCookies(): Promise<string | undefined> {
  return readSessionTokenFromJar();
}

/**
 * Unsafe BFF mutations: Origin/Referer gate first, then cookie → token.
 * Returns a 403 Response when rejected.
 */
export async function resolveBrowserMutationAuth(
  request: Request,
): Promise<{ token?: string } | Response> {
  const rejected = browserMutationOriginRejected(request);
  if (rejected) return rejected;
  return { token: await readSessionTokenFromJar() };
}

/**
 * Build upstream auth headers for a BFF proxy call.
 * Unsafe methods are Origin-gated before any cookie is read.
 * Returns Response when CSRF/origin check fails.
 */
export async function sessionAuthHeaders(
  request: Request,
  extra?: HeadersInit,
): Promise<HeadersInit | Response> {
  const resolved = await resolveBrowserMutationAuth(request);
  if (resolved instanceof Response) return resolved;
  return {
    ...extra,
    ...(resolved.token ? { 'x-session-token': resolved.token } : {}),
  };
}
