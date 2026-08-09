import { internalApiBaseUrl } from '@/lib/auth-bff';
import { resolveBrowserMutationAuth } from '@/lib/session-proxy';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await resolveBrowserMutationAuth(_request);
  if (auth instanceof Response) return auth;
  const token = auth.token;
  const response = await fetch(`${internalApiBaseUrl()}/export-share/share-links/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...(token ? { 'x-session-token': token } : {}) },
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
