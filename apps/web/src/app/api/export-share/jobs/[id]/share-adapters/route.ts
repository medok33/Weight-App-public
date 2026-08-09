import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const token = await getSessionTokenFromCookies();
  const base = request.headers.get('x-public-base-url') ?? 'http://localhost:3000';
  const response = await fetch(
    `${internalApiBaseUrl()}/export-share/jobs/${encodeURIComponent(id)}/share-adapters`,
    {
      headers: {
        ...(token ? { 'x-session-token': token } : {}),
        'x-public-base-url': base,
      },
      cache: 'no-store',
    },
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
