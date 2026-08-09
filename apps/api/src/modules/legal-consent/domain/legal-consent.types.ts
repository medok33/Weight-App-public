export type ConsentKind = 'terms' | 'privacy' | 'health_tracking' | 'communications' | 'ai_assistant';

export interface ConsentRecord {
  userId: string;
  kind: ConsentKind;
  policyKind: string;
  policyVersion: string;
  grantedAt?: Date;
  withdrawnAt?: Date;
}

export type LegalDocumentKind = 'terms' | 'privacy' | 'health_consent';

export type LegalDocumentVersion = {
  kind: LegalDocumentKind;
  version: string;
  checksum: string;
  effectiveAt: string;
};

export type LegalVersionCheckResult = {
  ok: boolean;
  missing: LegalDocumentKind[];
  outdated: LegalDocumentKind[];
  current: LegalDocumentVersion[];
};
