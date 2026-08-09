import type {
  SubstitutionCandidate,
  SubstitutionListResponse,
  SubstitutionPreview,
  SubstitutionKind,
} from '../model/substitution.types';
import { apiFetch, ApiError } from '@/lib/api-fetch';
import { confirmPlanRevision } from '../../revision-engine/api/revision-engine.client';

export async function listMealSubstitutions(
  itemId: string,
  type: 'dish' | 'ingredient',
  ingredientProductId?: string,
): Promise<SubstitutionListResponse> {
  const params = new URLSearchParams({ type });
  if (ingredientProductId) params.set('ingredientProductId', ingredientProductId);
  const response = await apiFetch(`/meal-plan/items/${encodeURIComponent(itemId)}/substitutions?${params}`);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<SubstitutionListResponse>;
}

export async function previewMealSubstitution(
  itemId: string,
  body: { candidateId: string; compensation?: string | null },
): Promise<SubstitutionPreview> {
  const response = await apiFetch(`/meal-plan/items/${encodeURIComponent(itemId)}/substitutions/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof payload.message === 'string' ? payload.message : undefined);
  }
  return response.json() as Promise<SubstitutionPreview>;
}

export async function cancelMealSubstitution(itemId: string, planId: string): Promise<void> {
  const response = await apiFetch(`/meal-plan/items/${encodeURIComponent(itemId)}/substitutions/cancel`, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
  if (!response.ok) throw new ApiError(response.status);
}

export async function confirmMealSubstitution(
  planId: string,
  confirmationToken: string,
  idempotencyKey: string,
) {
  return confirmPlanRevision(planId, { planKind: 'meal', confirmationToken }, idempotencyKey);
}

export type { SubstitutionCandidate, SubstitutionKind };
