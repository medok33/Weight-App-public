import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

export async function GET() {
  const token = await getSessionTokenFromCookies();
  const response = await fetch(`${internalApiBaseUrl()}/export-share/shopping-print`, {
    headers: { ...(token ? { 'x-session-token': token } : {}) },
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'text/html; charset=utf-8' },
  });
}
