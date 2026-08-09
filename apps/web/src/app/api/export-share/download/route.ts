import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

/** Proxy signed download from API (query: key, expires, sig). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const token = await getSessionTokenFromCookies();
  const response = await fetch(`${internalApiBaseUrl()}/export-share/download?${qs}`, {
    headers: { ...(token ? { 'x-session-token': token } : {}) },
    cache: 'no-store',
  });
  const buffer = await response.arrayBuffer();
  return new Response(buffer, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, no-store',
    },
  });
}
