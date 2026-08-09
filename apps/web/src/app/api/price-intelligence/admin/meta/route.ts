import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

async function proxy(path: string, init?: RequestInit) {
  const token = await getSessionTokenFromCookies();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { 'x-session-token': token } : {}),
    },
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
}

export async function GET() {
  return proxy('/price-intelligence/admin/meta');
}
