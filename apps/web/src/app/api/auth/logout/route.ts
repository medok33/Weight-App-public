import {
  finalizeAuthMutationResponse,
  internalApiBaseUrl,
  upstreamAuthRequestHeaders,
} from '@/lib/auth-bff';
import { browserMutationOriginRejected, getSessionTokenFromCookies } from '@/lib/session-proxy';

export async function POST(request: Request) {
  const rejected = browserMutationOriginRejected(request);
  if (rejected) return rejected;

  const sessionToken = await getSessionTokenFromCookies();
  const upstream = await fetch(`${internalApiBaseUrl()}/auth/logout`, {
    method: 'POST',
    headers: upstreamAuthRequestHeaders(request, {
      sessionToken,
      forwardCookie: true,
    }),
    cache: 'no-store',
  });

  return finalizeAuthMutationResponse(upstream);
}
