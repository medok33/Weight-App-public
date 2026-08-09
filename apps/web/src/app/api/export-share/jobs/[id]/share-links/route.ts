import { internalApiBaseUrl } from '@/lib/auth-bff';
import { resolveBrowserMutationAuth } from '@/lib/session-proxy';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await resolveBrowserMutationAuth(request);
  if (auth instanceof Response) return auth;
  const token = auth.token;
  const body = await request.text();
  const response = await fetch(
    `${internalApiBaseUrl()}/export-share/jobs/${encodeURIComponent(id)}/share-links`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-session-token': token } : {}),
      },
      body: body || JSON.stringify({ ttlMinutes: 60 }),
      cache: 'no-store',
    },
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
