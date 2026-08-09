import { cookies } from 'next/headers';
import { resolveInternalApiBaseUrl } from './api-base';
import { loadBrowserSecurityConfig } from './browser-security';

export type ParsedSetCookie = {
  name: string;
  value: string;
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
};

/** Server-only Nest upstream. Never reads NEXT_PUBLIC_* for browser leakage safety. */
export function internalApiBaseUrl(): string {
  return resolveInternalApiBaseUrl(process.env);
}

export function readSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

export function parseSetCookieHeader(header: string): ParsedSetCookie | null {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf('=');
  if (eq <= 0) return null;
  const name = nameValue.slice(0, eq).trim();
  const rawValue = nameValue.slice(eq + 1);
  let value = rawValue;
  try {
    value = decodeURIComponent(rawValue);
  } catch {
    value = rawValue;
  }

  const parsed: ParsedSetCookie = { name, value };
  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower === 'httponly') parsed.httpOnly = true;
    else if (lower === 'secure') parsed.secure = true;
    else if (lower.startsWith('path=')) parsed.path = attr.slice(5);
    else if (lower.startsWith('domain=')) parsed.domain = attr.slice(7);
    else if (lower.startsWith('max-age=')) parsed.maxAge = Number(attr.slice(8));
    else if (lower.startsWith('samesite=')) {
      const site = attr.slice(9);
      if (site === 'Strict' || site === 'Lax' || site === 'None') parsed.sameSite = site;
    } else if (lower.startsWith('expires=')) {
      const when = new Date(attr.slice(8));
      if (!Number.isNaN(when.getTime())) parsed.expires = when;
    }
  }
  return parsed;
}

/** Apply Nest session Set-Cookie headers to the browser-facing Next origin (localhost:3000). */
export async function applyUpstreamSessionCookies(upstream: Response): Promise<void> {
  const jar = await cookies();
  const config = loadBrowserSecurityConfig(process.env);
  for (const header of readSetCookieHeaders(upstream)) {
    const parsed = parseSetCookieHeader(header);
    if (!parsed) continue;

    const maxAge = parsed.maxAge;
    const deleting = maxAge === 0 || (parsed.value === '' && maxAge === 0);
    if (deleting) {
      jar.delete(parsed.name);
      continue;
    }

    const options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax' | 'strict' | 'none';
      path: string;
      maxAge?: number;
      expires?: Date;
    } = {
      httpOnly: parsed.httpOnly ?? true,
      secure: parsed.secure ?? config.cookie.secure,
      sameSite: (parsed.sameSite?.toLowerCase() as 'lax' | 'strict' | 'none') ?? 'lax',
      path: parsed.path ?? '/',
    };
    if (parsed.expires) options.expires = parsed.expires;
    else if (maxAge !== undefined && maxAge > 0) options.maxAge = maxAge;
    else options.maxAge = config.cookie.maxAgeSeconds;

    jar.set(parsed.name, parsed.value, options);
  }
}

export function upstreamAuthRequestHeaders(
  request: Request,
  options?: { sessionToken?: string; forwardCookie?: boolean },
): HeadersInit {
  const headers: Record<string, string> = {};
  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;
  const origin = request.headers.get('origin');
  if (origin) headers.origin = origin;
  const referer = request.headers.get('referer');
  if (referer) headers.referer = referer;
  const forwarded = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  if (forwarded) headers['x-forwarded-for'] = forwarded;
  if (options?.sessionToken) headers['x-session-token'] = options.sessionToken;
  if (options?.forwardCookie) {
    const cookie = request.headers.get('cookie');
    if (cookie) headers.cookie = cookie;
  }
  return headers;
}

export async function proxyAuthJsonResponse(upstream: Response, options?: { forwardSessionCookies?: boolean }): Promise<Response> {
  const body = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  });
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  if (options?.forwardSessionCookies) {
    for (const cookieHeader of readSetCookieHeaders(upstream)) {
      headers.append('set-cookie', cookieHeader);
    }
  }

  return new Response(body, { status: upstream.status, headers });
}

export async function finalizeAuthMutationResponse(upstream: Response): Promise<Response> {
  const cookieHeaders = readSetCookieHeaders(upstream);
  await applyUpstreamSessionCookies(upstream);
  const body = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  });
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);
  for (const cookieHeader of cookieHeaders) {
    headers.append('set-cookie', cookieHeader);
  }
  return new Response(body, { status: upstream.status, headers });
}
