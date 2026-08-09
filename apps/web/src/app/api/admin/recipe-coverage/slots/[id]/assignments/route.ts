import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

export async function GET(request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });

  if (headers instanceof Response) return headers;

  const response = await fetch(`${API}/admin/recipe-coverage/slots/${id}/assignments`, {
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });

  if (headers instanceof Response) return headers;

  const response = await fetch(`${API}/admin/recipe-coverage/slots/${id}/assignments`, {
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
