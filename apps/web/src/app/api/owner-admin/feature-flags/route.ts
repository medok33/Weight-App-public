import { internalApiBaseUrl } from '@/lib/auth-bff';
import { NextResponse } from 'next/server';
import { resolveBrowserMutationAuth, sessionAuthHeaders } from '@/lib/session-proxy';

const API = `${internalApiBaseUrl()}/owner-admin/feature-flags`;

export async function GET(request: Request) {
  const headers = await sessionAuthHeaders(request);
  if (headers instanceof Response) return headers;
  const response = await fetch(API, { headers, cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function POST(request: Request) {
  // Origin/Referer must pass before cookie → x-session-token conversion.
  const auth = await resolveBrowserMutationAuth(request);
  if (auth instanceof Response) return auth;
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/json',
      ...(auth.token ? { 'x-session-token': auth.token } : {}),
    },
    body: await request.text(),
    cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
