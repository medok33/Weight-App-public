import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

export async function GET(request: Request) {
  const headers = await sessionAuthHeaders(request);
  if (headers instanceof Response) return headers;
  const response = await fetch(`${internalApiBaseUrl()}/owner-admin/overview`, {
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
