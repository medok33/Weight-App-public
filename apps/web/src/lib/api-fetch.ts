import { browserApiBaseUrl, joinApiPath } from './api-base';
import { mapApiError } from '../i18n/errors';
import type { AppLocale } from '../i18n/types';

/** Prefer same-origin /api/v1 (Next rewrite → INTERNAL_API_BASE_URL). Never call Nest :3001 from the browser. */
const apiBase = () => browserApiBaseUrl();

export class ApiError extends Error {
  readonly status: number;
  readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'SERVER' | 'NETWORK' | 'UNKNOWN';

  constructor(status: number, message?: string) {
    const code =
      status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : status >= 500
            ? 'SERVER'
            : status === 0
              ? 'NETWORK'
              : 'UNKNOWN';
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Safe user-facing one-liner (no stack / SQL / internal URLs). */
export function apiErrorMessage(error: unknown, locale: AppLocale = 'ru'): string {
  if (error instanceof ApiError) {
    return mapApiError(error.code, { locale }).explanation;
  }
  if (error instanceof TypeError) return mapApiError('NETWORK', { locale }).explanation;
  return mapApiError('UNKNOWN', { locale }).explanation;
}

export function resolveBrowserApiUrl(path: string): string {
  return joinApiPath(apiBase(), path);
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = resolveBrowserApiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  return response;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
