import { internalApiBaseUrl } from '@/lib/auth-bff';
import { NextResponse } from 'next/server';

export async function GET() {
  const response = await fetch(`${internalApiBaseUrl()}/health/ready`, { cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
