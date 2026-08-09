import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

export async function POST(request: Request) {
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });
  if (headers instanceof Response) return headers;
  const response = await fetch(`${API}/admin/recipe-coverage/matrix/seed`, {
    method: 'POST',
    headers,
    body: '{}',
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
