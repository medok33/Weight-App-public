import type {
  ConfirmRevisionResponse,
  PreviewRevisionRequest,
  PreviewRevisionResponse,
} from '../model/revision-engine.types';
import { apiFetch, ApiError } from '../../../lib/api-fetch';

function revisionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Нет доступа к этому плану';
    if (error.status === 409) {
      if (error.message === 'IDEMPOTENCY_KEY_REUSED') return 'Этот ключ подтверждения уже использован с другими данными';
      if (error.message === 'REVISION_PREVIEW_STALE') return 'План изменился — сформируйте preview заново';
      return 'Конфликт версий. Обновите preview и повторите';
    }
    if (error.status === 400) {
      if (error.message === 'REVISION_REASON_REQUIRED' || error.message === 'REVISION_REASON_TOO_LONG') {
        return 'Укажите корректную причину изменения';
      }
      if (
        error.message === 'REVISION_TOKEN_INVALID' ||
        error.message === 'REVISION_TOKEN_EXPIRED' ||
        error.message === 'REVISION_TOKEN_MISMATCH' ||
        error.message === 'REVISION_SNAPSHOT_MISMATCH'
      ) {
        return 'Срок действия подтверждения истёк или токен недействителен. Сформируйте preview заново';
      }
    }
    if (error.status === 401) return 'Войдите в аккаунт, чтобы продолжить';
    if (error.code === 'NETWORK') return 'API недоступен';
    if (error.code === 'SERVER') return 'Сервер временно недоступен';
  }
  return fallback;
}

export async function previewPlanRevision(
  planId: string,
  body: PreviewRevisionRequest,
): Promise<PreviewRevisionResponse> {
  const response = await apiFetch(`/plans/${planId}/revisions/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof payload.message === 'string' ? payload.message : undefined);
  }
  return response.json() as Promise<PreviewRevisionResponse>;
}

export async function confirmPlanRevision(
  planId: string,
  body: { planKind: 'meal' | 'workout'; confirmationToken: string },
  idempotencyKey: string,
): Promise<ConfirmRevisionResponse> {
  const response = await apiFetch(`/plans/${planId}/revisions/confirm`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.message === 'string' ? payload.message : undefined;
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<ConfirmRevisionResponse>;
}

export async function cancelPlanRevision(planId: string, planKind: 'meal' | 'workout'): Promise<void> {
  const response = await apiFetch(`/plans/${planId}/revisions/cancel`, {
    method: 'POST',
    body: JSON.stringify({ planKind }),
  });
  if (!response.ok) throw new ApiError(response.status);
}

export { revisionErrorMessage };
