import { describe, expect, it } from 'vitest';
import {
  assertDisposableDatabaseName,
  buildIncidentResponsePlan,
  decryptBackupPayload,
  deriveBackupKey,
  encryptBackupPayload,
  evaluateRestoreIntegrity,
  evaluateSecurityReleaseGate,
  planFinalBackupRestoreSecurityRehearsal,
  parseBackupSnapshot,
  scanTextForSecrets,
  validateDestructiveReauth,
  validateRestoreProcedure,
  validateRestoreTestInput,
  validateThreatReview,
} from '../domain/audit-security.policy';

describe('audit-security STEP_155–161', () => {
  it('requires explicit confirmation and safe action key', () => {
    expect(validateDestructiveReauth({ action: 'owner.delete-user', confirmation: 'CONFIRM' }).action).toBe(
      'owner.delete-user',
    );
    expect(() => validateDestructiveReauth({ action: 'owner.delete-user', confirmation: 'yes' })).toThrow(
      'DESTRUCTIVE_CONFIRMATION_REQUIRED',
    );
  });

  it('encrypts and decrypts backup payload round-trip', () => {
    const key = deriveBackupKey('local-dev-backup-secret');
    const envelope = encryptBackupPayload(Buffer.from('{"users":1}', 'utf8'), key);
    expect(envelope.algorithm).toBe('aes-256-gcm');
    expect(decryptBackupPayload(envelope, key).toString('utf8')).toBe('{"users":1}');
  });

  it('documents restore procedure without executable production restore', () => {
    const plan = validateRestoreProcedure({
      backupId: 'b1',
      storageKey: 'b1.enc.json',
      environment: 'isolated',
      dryRun: true,
      confirmedByOwner: true,
      confirmation: 'RESTORE',
    });
    expect(plan.executable).toBe(false);
    expect(() =>
      validateRestoreProcedure({
        backupId: 'b1',
        storageKey: 'b1.enc.json',
        environment: 'production',
        dryRun: false,
        confirmedByOwner: true,
        confirmation: 'RESTORE',
      }),
    ).toThrow('RESTORE_PRODUCTION_DRY_RUN_REQUIRED');
  });

  it('gates isolated restore test to test+isolated+dryRun', () => {
    expect(
      validateRestoreTestInput({
        sourceBackupJobId: 'job-1',
        mode: 'test',
        environment: 'isolated',
        dryRun: true,
        confirmedByOwner: true,
        confirmation: 'RESTORE_TEST',
      }).mode,
    ).toBe('test');
    expect(() =>
      validateRestoreTestInput({
        sourceBackupJobId: 'job-1',
        mode: 'test',
        environment: 'isolated',
        dryRun: false,
        confirmedByOwner: true,
        confirmation: 'RESTORE_TEST',
      }),
    ).toThrow('RESTORE_TEST_DRY_RUN_REQUIRED');
    expect(() => assertDisposableDatabaseName('weight_app', 'weight_app')).toThrow('RESTORE_TARGET_INVALID');
    expect(() => assertDisposableDatabaseName('weight_app_restore_abc', 'weight_app_restore_abc')).toThrow(
      'RESTORE_PRIMARY_FORBIDDEN',
    );
  });

  it('parses snapshot and evaluates integrity', () => {
    const snapshot = parseBackupSnapshot(
      JSON.stringify({
        version: 1,
        tables: {
          User: [{ id: 'u1', email: 'a@b.c' }],
          Session: [{ id: 's1', userId: 'u1', tokenHash: 'h' }],
          AuditEvent: [{ id: 'e1', action: 'x', actorUserId: 'u1' }],
        },
      }),
    );
    const checks = evaluateRestoreIntegrity(snapshot, {
      userCount: 1,
      sessionCount: 1,
      auditEventCount: 1,
      orphanSessions: 0,
    });
    expect(checks.primaryDatabaseUntouched).toBe(true);
    expect(() =>
      evaluateRestoreIntegrity(snapshot, { userCount: 0, sessionCount: 1, auditEventCount: 1, orphanSessions: 0 }),
    ).toThrow('RESTORE_INTEGRITY_FAILED');
  });

  it('scans secrets without returning secret values', () => {
    const findings = scanTextForSecrets(
      'demo.env',
      'DATABASE_URL=postgresql://user:supersecretpass@localhost:5432/db\nsafe=1\n',
    );
    expect(findings.some((f) => f.rule === 'postgres-url-password')).toBe(true);
    expect(JSON.stringify(findings)).not.toContain('supersecretpass');
  });

  it('validates threat reviews and incident plans', () => {
    expect(
      validateThreatReview({
        title: 'Backup key exfiltration',
        category: 'secrets',
        severity: 'high',
        status: 'mitigated',
        abuseCase: 'Attacker reads BACKUP_ENCRYPTION_SECRET from logs',
        mitigation: 'Never log key; OWNER-only backup endpoints',
      }).title,
    ).toBe('Backup key exfiltration');
    expect(buildIncidentResponsePlan({ id: 'inc-1', title: 'Leak', severity: 'sev2' }).ownerOnly).toBe(true);
    expect(buildIncidentResponsePlan({ id: 'inc-1', title: 'Leak', severity: 'sev2' }).steps.length).toBeGreaterThan(3);
  });

  it('requires all security release gate checks', () => {
    const passed = evaluateSecurityReleaseGate([
      { id: 'verify_pass', ok: true },
      { id: 'secret_scan_clean', ok: true },
      { id: 'no_prod_restore_endpoint', ok: true },
      { id: 'audit_append_only', ok: true },
      { id: 'owner_rbac', ok: true },
      { id: 'health_ready', ok: true },
    ]);
    expect(passed.passed).toBe(true);
    const blocked = evaluateSecurityReleaseGate([{ id: 'verify_pass', ok: false }]);
    expect(blocked.passed).toBe(false);
    expect(blocked.blockedReasons.length).toBeGreaterThan(0);
  });

  it('STEP_171 plans final rehearsal without primary DB', () => {
    const plan = planFinalBackupRestoreSecurityRehearsal({
      targetDatabase: 'weight_app_restore_rehearsal',
      includeBackup: true,
      includeRestore: true,
      includeSecurityGate: true,
    });
    expect(plan.executable).toBe(false);
    expect(plan.touchesPrimaryDatabase).toBe(false);
    expect(plan.steps).toEqual(['createEncryptedBackup', 'restoreTestIsolated', 'securityReleaseGate']);
    expect(() =>
      planFinalBackupRestoreSecurityRehearsal({
        targetDatabase: 'weight_app',
        includeBackup: true,
        includeRestore: false,
        includeSecurityGate: false,
      }),
    ).toThrow('FINAL_REHEARSAL_PRIMARY_FORBIDDEN');
  });
});
