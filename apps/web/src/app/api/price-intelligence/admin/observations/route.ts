import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

export async function GET(request: Request) {
  const token = await getSessionTokenFromCookies();
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const response = await fetch(
    `${internalApiBaseUrl()}/price-intelligence/admin/observations${query ? `?${query}` : ''}`,
    { headers: token ? { 'x-session-token': token } : {}, cache: 'no-store' },
  );
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
}
