import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const headers = await sessionAuthHeaders(request, { 'content-type': 'application/json' });

  if (headers instanceof Response) return headers;

  const response = await fetch(`${API}/admin/recipe-search/runs${qs ? `?${qs}` : ''}`, {
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
