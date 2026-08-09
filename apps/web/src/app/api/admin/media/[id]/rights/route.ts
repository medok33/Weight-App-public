import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.text();
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });

  if (headers instanceof Response) return headers;

  const response = await fetch(`${API}/admin/media/${id}/rights`, {
    method: 'PATCH',
    headers,
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
