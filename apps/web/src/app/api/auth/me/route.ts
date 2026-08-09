import { internalApiBaseUrl, proxyAuthJsonResponse, upstreamAuthRequestHeaders } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

export async function GET(request: Request) {
  const sessionToken = await getSessionTokenFromCookies();
  const upstream = await fetch(`${internalApiBaseUrl()}/auth/me`, {
    method: 'GET',
    headers: upstreamAuthRequestHeaders(request, { sessionToken, forwardCookie: true }),
    cache: 'no-store',
  });
  return proxyAuthJsonResponse(upstream);
}
