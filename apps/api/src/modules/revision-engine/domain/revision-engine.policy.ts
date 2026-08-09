import type { PlanKind, RevisionRequest, RevisionResult } from './revision-engine.types';

const PLAN_KINDS: PlanKind[] = ['meal', 'workout'];

/**
 * Confirmation model (STEP_099/100): PlanRevision rows are created only after confirmation.
 * `pending` is a pre-persist validation/UI result; it is never written to PostgreSQL.
 */
export function validateRevision(request: RevisionRequest): RevisionResult {
  if (!request.userId || !request.reason?.trim()) throw new Error('REVISION_INVALID');
  if (!request.planId || !PLAN_KINDS.includes(request.planKind)) throw new Error('REVISION_PLAN_REQUIRED');
  if (!request.snapshot || typeof request.snapshot !== 'object' || Array.isArray(request.snapshot)) {
    throw new Error('REVISION_SNAPSHOT_REQUIRED');
  }
  return { status: request.confirmed ? 'confirmed' : 'pending', reason: request.reason.trim() };
}

export function assertConfirmedForPersist(request: RevisionRequest): void {
  if (!request.confirmed) throw new Error('REVISION_CONFIRMATION_REQUIRED');
}

export function validatePreviewRequest(input: { planId: string; planKind: PlanKind; reason: string }): void {
  if (!input.planId || !PLAN_KINDS.includes(input.planKind)) throw new Error('REVISION_PLAN_REQUIRED');
  if (!input.reason?.trim() || input.reason.trim().length < 2) throw new Error('REVISION_REASON_REQUIRED');
  if (input.reason.length > 500) throw new Error('REVISION_REASON_TOO_LONG');
}
