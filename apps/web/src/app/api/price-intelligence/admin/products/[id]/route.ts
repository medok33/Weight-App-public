import { internalApiBaseUrl } from '@/lib/auth-bff';
import { resolveBrowserMutationAuth } from '@/lib/session-proxy';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await resolveBrowserMutationAuth(request);
  if (auth instanceof Response) return auth;
  const token = auth.token;
  const body = await request.text();
  const response = await fetch(`${internalApiBaseUrl()}/price-intelligence/admin/products/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
}
