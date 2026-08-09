export type PlanKind = 'meal' | 'workout';

export type RevisionChangedItem = {
  path: string;
  previousValue: string;
  proposedValue: string;
};

export type PreviewRevisionRequest = {
  planKind: PlanKind;
  reason: string;
};

export type PreviewRevisionResponse = {
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
};

export type ConfirmRevisionRequest = {
  planKind: PlanKind;
  confirmationToken: string;
};

export type ConfirmRevisionResponse = {
  revisionId: string;
  planId: string;
  planKind: PlanKind;
  revisionVersion: number;
  activePlanId: string;
  activeVersion: number;
  reason: string;
  status: 'confirmed';
  idempotentReplay: boolean;
  createdAt: string;
};
