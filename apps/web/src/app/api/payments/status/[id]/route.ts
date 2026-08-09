import { internalApiBaseUrl } from '@/lib/auth-bff';
import { getSessionTokenFromCookies } from '@/lib/session-proxy';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const token = await getSessionTokenFromCookies();
  const response = await fetch(`${internalApiBaseUrl()}/payments/status/${encodeURIComponent(id)}`, {
    headers: {
      ...(token ? { 'x-session-token': token } : {}),
    },
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
