import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type {
  BackupEnqueueInput,
  BackupSnapshot,
  DestructiveReauth,
  EncryptedBackupEnvelope,
  IncidentResponsePlan,
  IncidentSeverity,
  RestoreIntegrityChecks,
  RestoreProcedureInput,
  RestoreProcedurePlan,
  RestoreTestInput,
  SecretScanFinding,
  SecurityReleaseCheck,
  SecurityReleaseCheckId,
  SecurityReleaseGateResult,
  SupportAccess,
  ThreatReviewDraft,
  FinalRehearsalPlan,
  FinalRehearsalPlanInput,
} from './audit-security.types';

export function validateSupportAccess(access: SupportAccess, now = Date.now()) {
  if (!access.actorId || !access.userId || !access.reason || Date.parse(access.expiresAt) <= now) {
    throw new Error('SUPPORT_ACCESS_INVALID');
  }
  return access;
}

export function validateDestructiveReauth(input: DestructiveReauth) {
  const action = input.action.trim();
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(action)) throw new Error('DESTRUCTIVE_ACTION_INVALID');
  if (input.confirmation !== 'CONFIRM') throw new Error('DESTRUCTIVE_CONFIRMATION_REQUIRED');
  return { action };
}

/** STEP_155: validate backup enqueue payload (no I/O). */
export function validateBackupEnqueue(input: BackupEnqueueInput): BackupEnqueueInput {
  if (!input.idempotencyKey?.trim() || !input.actorUserId?.trim()) throw new Error('BACKUP_JOB_INVALID');
  if (typeof input.plaintext !== 'string' || input.plaintext.length === 0) throw new Error('BACKUP_JOB_INVALID');
  if (input.plaintext.length > 5_000_000) throw new Error('BACKUP_PAYLOAD_TOO_LARGE');
  return {
    idempotencyKey: input.idempotencyKey.trim(),
    actorUserId: input.actorUserId.trim(),
    plaintext: input.plaintext,
  };
}

export function deriveBackupKey(secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error('BACKUP_KEY_INVALID');
  return createHash('sha256').update(secret).digest();
}

export function encryptBackupPayload(plaintext: Buffer, key: Buffer): EncryptedBackupEnvelope {
  if (key.length !== 32) throw new Error('BACKUP_KEY_INVALID');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptBackupPayload(envelope: EncryptedBackupEnvelope, key: Buffer): Buffer {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('BACKUP_ENVELOPE_INVALID');
  if (key.length !== 32) throw new Error('BACKUP_KEY_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
}

/**
 * STEP_156: documented restore procedure — never auto-executes against production.
 * Returns an explicit non-executable plan for operators.
 */
export function validateRestoreProcedure(input: RestoreProcedureInput): RestoreProcedurePlan {
  if (!input.backupId?.trim() || !input.storageKey?.trim()) throw new Error('RESTORE_INPUT_INVALID');
  if (!['isolated', 'staging', 'production'].includes(input.environment)) throw new Error('RESTORE_ENV_INVALID');
  if (input.confirmation !== 'RESTORE') throw new Error('RESTORE_CONFIRMATION_REQUIRED');
  if (!input.confirmedByOwner) throw new Error('RESTORE_OWNER_CONFIRMATION_REQUIRED');
  if (input.environment === 'production' && !input.dryRun) {
    throw new Error('RESTORE_PRODUCTION_DRY_RUN_REQUIRED');
  }

  const steps = [
    '1. Verify backup checksum and envelope version=1 aes-256-gcm',
    '2. Decrypt backup in memory with BACKUP_ENCRYPTION_SECRET (never log key)',
    '3. Restore into isolated Postgres instance only',
    '4. Run health/live + health/ready and auth smoke',
    '5. Compare row counts for User, Session, AuditEvent (append-only intact)',
    '6. Promote only after explicit OWNER sign-off (STEP_157 isolated restore test)',
  ];

  return {
    backupId: input.backupId.trim(),
    storageKey: input.storageKey.trim(),
    environment: input.environment,
    dryRun: input.dryRun,
    steps,
    executable: false,
    reason: 'Restore is documented and gated; automatic production restore is forbidden',
  };
}

/** STEP_157: isolated restore test may only target disposable DBs in test mode. */
export function validateRestoreTestInput(input: RestoreTestInput): RestoreTestInput {
  if (!input.sourceBackupJobId?.trim()) throw new Error('RESTORE_TEST_INPUT_INVALID');
  if (input.mode !== 'test') throw new Error('RESTORE_TEST_MODE_REQUIRED');
  if (input.environment !== 'isolated') throw new Error('RESTORE_TEST_ISOLATED_REQUIRED');
  if (!input.dryRun) throw new Error('RESTORE_TEST_DRY_RUN_REQUIRED');
  if (!input.confirmedByOwner) throw new Error('RESTORE_OWNER_CONFIRMATION_REQUIRED');
  if (input.confirmation !== 'RESTORE_TEST') throw new Error('RESTORE_TEST_CONFIRMATION_REQUIRED');
  return {
    ...input,
    sourceBackupJobId: input.sourceBackupJobId.trim(),
  };
}

export function parseBackupSnapshot(plaintext: string): BackupSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('BACKUP_SNAPSHOT_INVALID');
  }
  const snap = parsed as BackupSnapshot;
  if (snap?.version !== 1 || !snap.tables?.User || !snap.tables?.Session || !snap.tables?.AuditEvent) {
    throw new Error('BACKUP_SNAPSHOT_INVALID');
  }
  return snap;
}

export function assertDisposableDatabaseName(name: string, primaryDatabase: string) {
  if (!/^weight_app_restore_[a-z0-9]+$/i.test(name)) throw new Error('RESTORE_TARGET_INVALID');
  if (name.toLowerCase() === primaryDatabase.toLowerCase()) throw new Error('RESTORE_PRIMARY_FORBIDDEN');
  if (name.toLowerCase() === 'weight_app' || name.toLowerCase() === 'postgres') {
    throw new Error('RESTORE_PRIMARY_FORBIDDEN');
  }
}

export function evaluateRestoreIntegrity(
  snapshot: BackupSnapshot,
  actual: {
    userCount: number;
    sessionCount: number;
    auditEventCount: number;
    orphanSessions: number;
  },
): RestoreIntegrityChecks {
  const expectedUserCount = snapshot.tables.User.length;
  const expectedSessionCount = snapshot.tables.Session.length;
  const expectedAuditEventCount = snapshot.tables.AuditEvent.length;
  const foreignKeysIntact = actual.orphanSessions === 0;
  const countsOk =
    actual.userCount === expectedUserCount &&
    actual.sessionCount === expectedSessionCount &&
    actual.auditEventCount === expectedAuditEventCount;
  if (!countsOk || !foreignKeysIntact) throw new Error('RESTORE_INTEGRITY_FAILED');
  return {
    tablesExist: true,
    userCount: actual.userCount,
    sessionCount: actual.sessionCount,
    auditEventCount: actual.auditEventCount,
    expectedUserCount,
    expectedSessionCount,
    expectedAuditEventCount,
    foreignKeysIntact,
    primaryDatabaseUntouched: true,
  };
}

/** STEP_159: detect likely secrets in text without logging matched values. */
export function scanTextForSecrets(path: string, content: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  const rules: Array<{ rule: string; re: RegExp }> = [
    { rule: 'private-key', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
    { rule: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { rule: 'generic-api-key', re: /\b(?:api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,}['"]/i },
    { rule: 'postgres-url-password', re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i },
  ];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { rule, re } of rules) {
      if (re.test(line)) findings.push({ path, rule, line: index + 1 });
    }
  });
  return findings;
}

/** STEP_160 */
export function validateThreatReview(input: ThreatReviewDraft): ThreatReviewDraft {
  if (!input.title?.trim() || !input.category?.trim() || !input.abuseCase?.trim() || !input.mitigation?.trim()) {
    throw new Error('THREAT_REVIEW_INVALID');
  }
  if (!['low', 'medium', 'high', 'critical'].includes(input.severity)) throw new Error('THREAT_REVIEW_INVALID');
  if (!['open', 'mitigated', 'accepted'].includes(input.status)) throw new Error('THREAT_REVIEW_INVALID');
  return {
    title: input.title.trim(),
    category: input.category.trim(),
    severity: input.severity,
    status: input.status,
    abuseCase: input.abuseCase.trim(),
    mitigation: input.mitigation.trim(),
  };
}

/** STEP_161 */
export function buildIncidentResponsePlan(input: {
  id: string;
  title: string;
  severity: IncidentSeverity;
}): IncidentResponsePlan {
  if (!input.id?.trim() || !input.title?.trim()) throw new Error('INCIDENT_PLAN_INVALID');
  if (!['sev1', 'sev2', 'sev3', 'sev4'].includes(input.severity)) throw new Error('INCIDENT_PLAN_INVALID');
  return {
    id: input.id.trim(),
    title: input.title.trim(),
    severity: input.severity,
    status: 'detected',
    ownerOnly: true,
    steps: [
      '1. Detect & triage (OWNER MFA)',
      '2. Contain blast radius; revoke compromised sessions',
      '3. Preserve AuditEvent trail (append-only; no update/delete)',
      '4. Eradicate cause; rotate secrets offline (never via API response)',
      '5. Recover services; verify health/live + health/ready',
      '6. Post-incident review; update ThreatReview mitigations',
    ],
  };
}

export function databaseNameFromUrl(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    const name = u.pathname.replace(/^\//, '');
    if (!name) throw new Error('DATABASE_URL_INVALID');
    return name;
  } catch {
    throw new Error('DATABASE_URL_INVALID');
  }
}

const REQUIRED_RELEASE_CHECKS: SecurityReleaseCheckId[] = [
  'verify_pass',
  'secret_scan_clean',
  'no_prod_restore_endpoint',
  'audit_append_only',
  'owner_rbac',
  'health_ready',
];

/** STEP_163: all required security gates must be true before release. */
export function evaluateSecurityReleaseGate(checks: SecurityReleaseCheck[]): SecurityReleaseGateResult {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('SECURITY_GATE_INVALID');
  const byId = new Map(checks.map((c) => [c.id, c]));
  const normalized: SecurityReleaseCheck[] = REQUIRED_RELEASE_CHECKS.map((id) => {
    const found = byId.get(id);
    if (!found) return { id, ok: false, detail: 'missing' };
    return { id, ok: found.ok === true, detail: found.detail };
  });
  const blockedReasons = normalized.filter((c) => !c.ok).map((c) => c.id);
  return { passed: blockedReasons.length === 0, checks: normalized, blockedReasons };
}

/** STEP_171: plan-only rehearsal; never marks executable against primary DB. */
export function planFinalBackupRestoreSecurityRehearsal(
  input: FinalRehearsalPlanInput,
): FinalRehearsalPlan {
  const targetDatabase = input.targetDatabase?.trim() ?? '';
  if (!targetDatabase || targetDatabase === 'weight_app' || /prod/i.test(targetDatabase)) {
    throw new Error('FINAL_REHEARSAL_PRIMARY_FORBIDDEN');
  }
  if (!/^weight_app_restore[_-][a-z0-9_]+$/i.test(targetDatabase) && !/^weight_app_rehearsal[_-][a-z0-9_]+$/i.test(targetDatabase)) {
    throw new Error('FINAL_REHEARSAL_TARGET_INVALID');
  }
  if (!input.includeBackup && !input.includeRestore && !input.includeSecurityGate) {
    throw new Error('FINAL_REHEARSAL_INVALID');
  }
  const steps: string[] = [];
  if (input.includeBackup) steps.push('createEncryptedBackup');
  if (input.includeRestore) steps.push('restoreTestIsolated');
  if (input.includeSecurityGate) steps.push('securityReleaseGate');
  return {
    executable: false,
    touchesPrimaryDatabase: false,
    targetDatabase,
    steps,
  };
}

