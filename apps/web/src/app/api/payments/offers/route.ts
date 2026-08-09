import { internalApiBaseUrl } from '@/lib/auth-bff';
import { NextResponse } from 'next/server'; export async function GET(){const r=await fetch(`${internalApiBaseUrl()}/payments/offers`,{cache:'no-store'});return NextResponse.json(await r.json(),{status:r.status});}
