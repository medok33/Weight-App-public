import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

async function proxy(request: Request, path: string[], method: string) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const body = method === 'GET' ? undefined : await request.text();
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });
  if (headers instanceof Response) return headers;
  const response = await fetch(`${API}/admin/recipe-research/${path.join('/')}${qs ? `?${qs}` : ''}`, {
    method,
    body,
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path, 'GET');
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path, 'POST');
}
