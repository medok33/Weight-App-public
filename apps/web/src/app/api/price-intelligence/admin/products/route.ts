import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies, resolveBrowserMutationAuth } from '@/lib/session-proxy';

export async function GET() {
  const token = await getSessionTokenFromCookies();
  const response = await fetch(`${internalApiBaseUrl()}/price-intelligence/admin/products`, {
    headers: token ? { 'x-session-token': token } : {},
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
}

export async function POST(request: Request) {
  const auth = await resolveBrowserMutationAuth(request);
  if (auth instanceof Response) return auth;
  const token = auth.token;
  const body = await request.text();
  const response = await fetch(`${internalApiBaseUrl()}/price-intelligence/admin/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
}
