export type SupportAccess = { actorId: string; userId: string; reason: string; expiresAt: string };
export type DestructiveReauth = { action: string; confirmation: string };

export type BackupJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type BackupJobRecord = {
  id: string;
  idempotencyKey: string;
  status: BackupJobStatus;
  storageKey: string | null;
  byteLength: number | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EncryptedBackupEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
};

export type BackupEnqueueInput = {
  idempotencyKey: string;
  actorUserId: string;
  plaintext: string;
};

export type RestoreEnvironment = 'isolated' | 'staging' | 'production';

export type RestoreProcedureInput = {
  backupId: string;
  storageKey: string;
  environment: RestoreEnvironment;
  dryRun: boolean;
  confirmedByOwner: boolean;
  confirmation: string;
};

export type RestoreProcedurePlan = {
  backupId: string;
  storageKey: string;
  environment: RestoreEnvironment;
  dryRun: boolean;
  steps: string[];
  executable: false;
  reason: string;
};

/** Logical snapshot carried inside encrypted BackupJob plaintext (STEP_157). */
export type BackupSnapshot = {
  version: 1;
  tables: {
    User: Array<{ id: string; email: string | null }>;
    Session: Array<{ id: string; userId: string; tokenHash: string }>;
    AuditEvent: Array<{ id: string; action: string; actorUserId: string | null }>;
  };
};

export type RestoreTestMode = 'test';

export type RestoreTestInput = {
  sourceBackupJobId: string;
  mode: RestoreTestMode;
  environment: 'isolated';
  dryRun: boolean;
  confirmedByOwner: boolean;
  confirmation: string;
};

export type RestoreIntegrityChecks = {
  tablesExist: boolean;
  userCount: number;
  sessionCount: number;
  auditEventCount: number;
  expectedUserCount: number;
  expectedSessionCount: number;
  expectedAuditEventCount: number;
  foreignKeysIntact: boolean;
  primaryDatabaseUntouched: true;
};

export type RestoreTestStatus = 'running' | 'passed' | 'failed';

export type RestoreTestResult = {
  id: string;
  sourceBackupJobId: string;
  targetEnvironment: 'isolated';
  status: RestoreTestStatus;
  startedAt: string;
  completedAt: string | null;
  checks: RestoreIntegrityChecks | Record<string, unknown>;
  errorCode: string | null;
  targetDatabase: string | null;
};

export type SecretScanFinding = {
  path: string;
  rule: string;
  line?: number;
};

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ThreatReviewStatus = 'open' | 'mitigated' | 'accepted';

export type ThreatReviewDraft = {
  title: string;
  category: string;
  severity: ThreatSeverity;
  status: ThreatReviewStatus;
  abuseCase: string;
  mitigation: string;
};

export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type IncidentStatus = 'detected' | 'contained' | 'eradicated' | 'recovered' | 'closed';

export type IncidentResponsePlan = {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  steps: string[];
  ownerOnly: true;
};

/** STEP_163 */
export type SecurityReleaseCheckId =
  | 'verify_pass'
  | 'secret_scan_clean'
  | 'no_prod_restore_endpoint'
  | 'audit_append_only'
  | 'owner_rbac'
  | 'health_ready';

export type SecurityReleaseCheck = {
  id: SecurityReleaseCheckId;
  ok: boolean;
  detail?: string;
};

export type SecurityReleaseGateResult = {
  passed: boolean;
  checks: SecurityReleaseCheck[];
  blockedReasons: string[];
};

/** STEP_171 */
export type FinalRehearsalPlanInput = {
  targetDatabase: string;
  includeBackup: boolean;
  includeRestore: boolean;
  includeSecurityGate: boolean;
};

export type FinalRehearsalPlan = {
  executable: false;
  touchesPrimaryDatabase: false;
  targetDatabase: string;
  steps: string[];
};
