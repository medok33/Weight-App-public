import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

export async function GET(request: Request) {
  const headers = await sessionAuthHeaders(request);
  if (headers instanceof Response) return headers;
  const response = await fetch(`${API}/assistant/owner-control`, {
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });
  if (headers instanceof Response) return headers;
  const response = await fetch(`${API}/assistant/owner-control`, {
    method: 'POST',
    headers,
    body: await request.text(),
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
