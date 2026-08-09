export type PlanKind = 'meal' | 'workout';

/** Persisted DB status — confirmation-only (STEP_099/100). */
export type RevisionStatus = 'confirmed';

/** Application/UI preview state before persist. */
export type PreviewStatus = 'pending' | 'confirmed';

export type RevisionSnapshot = Record<string, unknown>;

export type RevisionRequest = {
  userId: string;
  planId: string;
  planKind: PlanKind;
  reason: string;
  confirmed: boolean;
  snapshot: RevisionSnapshot;
};

export type RevisionResult = {
  status: PreviewStatus;
  reason: string;
};

export type PlanRevision = {
  id: string;
  userId: string;
  planId: string;
  planKind: PlanKind;
  version: number;
  reason: string;
  status: RevisionStatus;
  snapshot: RevisionSnapshot;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  createdAt: string;
};

export type CreatePlanRevisionInput = {
  userId: string;
  planId: string;
  planKind: PlanKind;
  version: number;
  reason: string;
  status: RevisionStatus;
  snapshot: RevisionSnapshot;
  idempotencyKey?: string | null;
  requestHash?: string | null;
};

export type RevisionChangedItem = {
  path: string;
  previousValue: string;
  proposedValue: string;
};

export type RevisionPreview = {
  planId: string;
  planKind: PlanKind;
  currentVersion: number;
  proposedVersion: number;
  reason: string;
  summary: string;
  changedItems: RevisionChangedItem[];
  warnings: string[];
  validationStatus: 'ok' | 'warning' | 'invalid';
  confirmationToken: string;
  proposedSnapshot: RevisionSnapshot;
};

export type ConfirmRevisionInput = {
  userId: string;
  planId: string;
  planKind: PlanKind;
  confirmationToken: string;
  idempotencyKey: string;
};

export type ConfirmRevisionResult = {
  revision: PlanRevision;
  activePlanId: string;
  activeVersion: number;
  idempotentReplay: boolean;
};
