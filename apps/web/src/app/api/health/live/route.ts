import { NextResponse } from 'next/server';

/** Container / load-balancer liveness for the web process (no upstream dependency). */
export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
