import { internalApiBaseUrl } from '@/lib/auth-bff';
import { sessionAuthHeaders } from '@/lib/session-proxy';

const API = internalApiBaseUrl();

async function proxy(request: Request, path: string, init?: RequestInit) {
  const headers = await sessionAuthHeaders(request, {
    'content-type': 'application/json',
    ...(init?.headers ?? {}),
  });
  if (headers instanceof Response) return headers;
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  const body = await request.text();
  const map: Record<string, string> = {
    aliases: `/admin/products/${id}/aliases`,
    'nutrition-versions': `/admin/products/${id}/nutrition-versions`,
    review: `/admin/products/${id}/review`,
    'merge-preview': `/admin/products/${id}/merge-preview`,
    merge: `/admin/products/${id}/merge`,
    substitutions: `/admin/products/${id}/substitutions`,
  };
  const path = map[action];
  if (!path) return new Response(JSON.stringify({ message: 'NOT_FOUND' }), { status: 404 });
  return proxy(request, path, { method: 'POST', body });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  const body = await request.text();
  const map: Record<string, string> = {
    allergens: `/admin/products/${id}/allergens`,
    'dietary-tags': `/admin/products/${id}/dietary-tags`,
    'culinary-roles': `/admin/products/${id}/culinary-roles`,
  };
  const path = map[action];
  if (!path) return new Response(JSON.stringify({ message: 'NOT_FOUND' }), { status: 404 });
  return proxy(request, path, { method: 'PUT', body });
}
