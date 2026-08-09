import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

async function proxy(request: Request, path: string, init?: RequestInit) {
  const headers = await sessionAuthHeaders(request, {
    'content-type': 'application/json',
    ...(init?.headers ?? {}),
  });
  if (headers instanceof Response) return headers;
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request) {
  return proxy(request, '/admin/recipe-search/preflight', { method: 'POST', body: await request.text() });
}
