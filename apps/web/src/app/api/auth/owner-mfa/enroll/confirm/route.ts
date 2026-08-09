import { internalApiBaseUrl } from '@/lib/auth-bff';
import { resolveBrowserMutationAuth } from '@/lib/session-proxy';

export async function POST(request: Request) {
  const auth = await resolveBrowserMutationAuth(request);
  if (auth instanceof Response) return auth;
  const response = await fetch(`${internalApiBaseUrl()}/auth/owner-mfa/enroll/confirm`, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/json',
      ...(auth.token ? { 'x-session-token': auth.token } : {}),
    },
    body: await request.text(),
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: response.headers });
}
