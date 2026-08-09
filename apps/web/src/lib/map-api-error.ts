import { ApiError } from './api-fetch';
import { mapApiError, type MappedApiError } from '../i18n/errors';
import type { AppLocale } from '../i18n/types';

export type ApiErrorKind =
  | 'network'
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'service'
  | 'degraded'
  | 'unknown';

export type UiApiError = MappedApiError & {
  kind: ApiErrorKind;
  httpStatus: number;
  retryable: boolean;
};

const RETRYABLE: ReadonlySet<ApiErrorKind> = new Set([
  'network',
  'rate_limit',
  'service',
  'degraded',
  'conflict',
  'unknown',
]);

/** Stable codes / HTTP → kind. Never surfaces stack, SQL, or raw body to the UI. */
export function classifyApiErrorKind(input: {
  status?: number;
  code?: string | null;
}): ApiErrorKind {
  const code = String(input.code ?? '')
    .trim()
    .toUpperCase();
  const status = Number(input.status ?? NaN);

  if (code === 'NETWORK' || status === 0) return 'network';
  if (code === 'UNAUTHORIZED' || status === 401) return 'unauthenticated';
  if (code === 'FORBIDDEN' || status === 403) return 'forbidden';
  if (code === 'VALIDATION_ERROR' || status === 400 || status === 422) return 'validation';
  if (code === 'NOT_FOUND' || status === 404) return 'not_found';
  if (code === 'CONFLICT' || code === 'STALE_ACTION' || status === 409) return 'conflict';
  if (code === 'RATE_LIMITED' || status === 429) return 'rate_limit';
  if (code === 'SERVICE_UNAVAILABLE' || status === 503) return 'service';
  if (code === 'DEGRADED_DEPENDENCY' || status === 502 || status === 504) return 'degraded';
  if (code === 'SERVER' || status >= 500) return 'service';
  return 'unknown';
}

function codeForKind(kind: ApiErrorKind, fallbackCode?: string | null): string {
  const normalized = String(fallbackCode ?? '')
    .trim()
    .toUpperCase();
  // Prefer business/API codes for i18n; ignore transport-level ApiError codes (SERVER).
  if (normalized && normalized !== 'SERVER') return normalized;
  switch (kind) {
    case 'network':
      return 'NETWORK';
    case 'unauthenticated':
      return 'UNAUTHORIZED';
    case 'forbidden':
      return 'FORBIDDEN';
    case 'validation':
      return 'VALIDATION_ERROR';
    case 'not_found':
      return 'NOT_FOUND';
    case 'conflict':
      return 'CONFLICT';
    case 'rate_limit':
      return 'RATE_LIMITED';
    case 'service':
      return 'SERVICE_UNAVAILABLE';
    case 'degraded':
      return 'DEGRADED_DEPENDENCY';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Map any thrown value to safe user-facing copy.
 * Rejects leaking technical payload text (stack, SQL, internal URLs).
 */
export function mapUnknownToUiError(
  error: unknown,
  options?: { correlationId?: string | null; locale?: AppLocale },
): UiApiError {
  let status = 0;
  let code: string | null = null;

  if (error instanceof ApiError) {
    status = error.status;
    code = error.code;
  } else if (error instanceof TypeError) {
    status = 0;
    code = 'NETWORK';
  } else if (error && typeof error === 'object') {
    const bag = error as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof bag.status === 'number') status = bag.status;
    if (typeof bag.code === 'string') code = bag.code;
  }

  const kind = classifyApiErrorKind({ status, code });
  const mapped = mapApiError(codeForKind(kind, code), {
    correlationId: options?.correlationId,
    locale: options?.locale,
  });

  return {
    ...mapped,
    kind,
    httpStatus: status,
    retryable: RETRYABLE.has(kind),
  };
}

/** Short single-line message for legacy call sites. */
export function uiErrorMessage(error: unknown): string {
  const mapped = mapUnknownToUiError(error);
  return mapped.explanation || mapped.title;
}
