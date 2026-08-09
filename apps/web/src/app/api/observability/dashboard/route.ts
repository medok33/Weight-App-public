import { internalApiBaseUrl } from '@/lib/auth-bff';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const response = await fetch(`${internalApiBaseUrl()}/observability/dashboard`, {
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      'x-session-token': request.headers.get('x-session-token') ?? '',
    },
    cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
