import { internalApiBaseUrl } from '@/lib/auth-bff';
import { NextResponse } from 'next/server';
import { resolveBrowserMutationAuth } from '@/lib/session-proxy';

/**
 * OWNER destructive reauth via BFF.
 * Origin/Referer must pass before cookie → x-session-token.
 * Do not forward client-supplied x-session-token or raw Cookie (avoids CSRF bypass).
 */
export async function POST(request: Request) {
  const auth = await resolveBrowserMutationAuth(request);
  if (auth instanceof Response) return auth;

  const response = await fetch(`${internalApiBaseUrl()}/audit-security/reauth`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth.token ? { 'x-session-token': auth.token } : {}),
    },
    body: await request.text(),
    cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
