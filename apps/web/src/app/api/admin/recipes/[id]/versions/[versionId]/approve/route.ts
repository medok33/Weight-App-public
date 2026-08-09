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

function makePost(action: string) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string; versionId: string }> },
  ) {
    const { id, versionId } = await context.params;
    return proxy(request, `/admin/recipes/${id}/versions/${versionId}/${action}`, {
      method: 'POST',
      body: await request.text(),
    });
  };
}

export const POST = makePost('approve');
