import type { ConfirmRevisionResult, RevisionPreview } from '../domain/revision-engine.types';

export function toPreviewResponse(preview: RevisionPreview) {
  return {
    planId: preview.planId,
    planKind: preview.planKind,
    currentVersion: preview.currentVersion,
    proposedVersion: preview.proposedVersion,
    reason: preview.reason,
    summary: preview.summary,
    changedItems: preview.changedItems,
    warnings: preview.warnings,
    validationStatus: preview.validationStatus,
    confirmationToken: preview.confirmationToken,
  };
}

export function toConfirmResponse(result: ConfirmRevisionResult) {
  return {
    revisionId: result.revision.id,
    planId: result.revision.planId,
    planKind: result.revision.planKind,
    revisionVersion: result.revision.version,
    activePlanId: result.activePlanId,
    activeVersion: result.activeVersion,
    reason: result.revision.reason,
    status: result.revision.status,
    idempotentReplay: result.idempotentReplay,
    createdAt: result.revision.createdAt,
  };
}
