import {
  finalizeAuthMutationResponse,
  internalApiBaseUrl,
  upstreamAuthRequestHeaders,
} from '@/lib/auth-bff';
import { browserMutationOriginRejected } from '@/lib/session-proxy';

export async function POST(request: Request) {
  const rejected = browserMutationOriginRejected(request);
  if (rejected) return rejected;

  const upstream = await fetch(`${internalApiBaseUrl()}/auth/register`, {
    method: 'POST',
    headers: upstreamAuthRequestHeaders(request),
    body: await request.text(),
    cache: 'no-store',
  });

  return finalizeAuthMutationResponse(upstream);
}
