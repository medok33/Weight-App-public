import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

export async function GET(request: Request) {
  const headers = await sessionAuthHeaders(request);
  if (headers instanceof Response) return headers;
  const url = new URL(request.url);
  const response = await fetch(
    `${internalApiBaseUrl()}/owner-admin/users?q=${encodeURIComponent(url.searchParams.get('q') ?? '')}`,
    { headers, cache: 'no-store' },
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
