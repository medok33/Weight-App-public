import { internalApiBaseUrl } from '@/lib/auth-bff';
import { resolveBrowserMutationAuth } from '@/lib/session-proxy';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await resolveBrowserMutationAuth(_request);
  if (auth instanceof Response) return auth;
  const token = auth.token;
  const response = await fetch(
    `${internalApiBaseUrl()}/export-share/jobs/${encodeURIComponent(id)}/download-link`,
    {
      method: 'POST',
      headers: { ...(token ? { 'x-session-token': token } : {}) },
      cache: 'no-store',
    },
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
