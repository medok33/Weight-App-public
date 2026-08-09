import { internalApiBaseUrl } from '@/lib/auth-bff';
import {
  getSessionTokenFromCookies,
  sessionAuthHeaders,
} from '@/lib/session-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Runtime BFF proxy for same-origin `/api/v1/*`.
 *
 * Next.js `rewrites()` bake the upstream at build time, which breaks Docker
 * (baked `127.0.0.1:3001` while compose uses hostname `api`). This route reads
 * INTERNAL_API_BASE_URL / API_BASE_URL at request time.
 *
 * Auth cookie → `x-session-token`; unsafe methods keep Origin guard.
 * Dedicated `/api/auth/*` routes remain the cookie-issuing BFF.
 */
async function proxyApiV1(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const suffix = (path ?? []).map(encodeURIComponent).join('/');
  const incoming = new URL(request.url);
  const target = `${internalApiBaseUrl()}/${suffix}${incoming.search}`;

  const method = request.method.toUpperCase();
  const unsafe = method !== 'GET' && method !== 'HEAD';

  let headers: HeadersInit;
  if (unsafe) {
    const authHeaders = await sessionAuthHeaders(request, {
      ...(request.headers.get('content-type')
        ? { 'content-type': request.headers.get('content-type')! }
        : {}),
      accept: request.headers.get('accept') ?? 'application/json',
    });
    if (authHeaders instanceof Response) return authHeaders;
    headers = authHeaders;
  } else {
    const token = await getSessionTokenFromCookies();
    headers = {
      accept: request.headers.get('accept') ?? 'application/json',
      ...(token ? { 'x-session-token': token } : {}),
    };
  }

  const upstream = await fetch(target, {
    method,
    headers,
    body: unsafe ? await request.arrayBuffer() : undefined,
    cache: 'no-store',
    redirect: 'manual',
  });

  const out = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) out.set('content-type', contentType);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) out.set('cache-control', cacheControl);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export const GET = proxyApiV1;
export const HEAD = proxyApiV1;
export const POST = proxyApiV1;
export const PUT = proxyApiV1;
export const PATCH = proxyApiV1;
export const DELETE = proxyApiV1;
