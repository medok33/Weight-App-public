import { internalApiBaseUrl } from '@/lib/auth-bff';
export async function POST(request: Request) {
  const body = await request.text();
  const response = await fetch(`${internalApiBaseUrl()}/price-intelligence/sources/catalog-csv/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
}
