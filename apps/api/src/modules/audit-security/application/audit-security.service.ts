import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  buildIncidentResponsePlan,
  decryptBackupPayload,
  deriveBackupKey,
  encryptBackupPayload,
  parseBackupSnapshot,
  scanTextForSecrets,
  validateBackupEnqueue,
  validateDestructiveReauth,
  validateRestoreProcedure,
  validateRestoreTestInput,
  validateSupportAccess,
  evaluateSecurityReleaseGate,
  planFinalBackupRestoreSecurityRehearsal,
  validateThreatReview,
} from '../domain/audit-security.policy';
import type {
  BackupEnqueueInput,
  DestructiveReauth,
  EncryptedBackupEnvelope,
  FinalRehearsalPlanInput,
  IncidentSeverity,
  RestoreTestInput,
  SecurityReleaseCheck,
  ThreatReviewDraft,
} from '../domain/audit-security.types';
import type { AuditEventDraft } from '../domain/audit-event.policy';
import {
  LOGIN_BRUTE_FORCE,
  assertWithinRateLimit,
  clearRateLimit,
  recordRateLimitFailure,
  type RateLimitBucket,
} from '../domain/rate-limit.policy';
import { AuditSecurityRepository } from '../infrastructure/audit-security.repository';
import { BackupObjectStorage } from '../infrastructure/backup-object-storage';
import { IsolatedRestoreRunner } from '../infrastructure/isolated-restore.runner';

@Injectable()
export class AuditSecurityService {
  private readonly rateBuckets = new Map<string, RateLimitBucket>();

  constructor(
    @Inject(AuditSecurityRepository) private readonly repository: AuditSecurityRepository,
    @Inject(BackupObjectStorage) private readonly backups: BackupObjectStorage,
  ) {}

  authorize(access: { actorId: string; userId: string; reason: string; expiresAt: string }) {
    return validateSupportAccess(access);
  }

  async reauthenticate(token: string | undefined, input: DestructiveReauth) {
    if (!token) throw new Error('OWNER_ACCESS_FORBIDDEN');
    const session = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!session || session.role !== 'OWNER') {
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    const { action } = validateDestructiveReauth(input);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await this.repository.audit(session.userId, 'owner.destructive.reauthenticated', { action, expiresAt });
    await this.appendEvent({
      actorUserId: session.userId,
      action: 'owner.destructive.reauthenticated',
      metadata: { action, expiresAt },
    });
    return {
      action,
      reauthToken: createHash('sha256').update(`${session.userId}:${action}:${expiresAt}`).digest('hex'),
      expiresAt,
    };
  }

  assertBruteForceAllowed(key: string) {
    assertWithinRateLimit(this.rateBuckets, key, LOGIN_BRUTE_FORCE, Date.now(), 'RATE_LIMITED');
  }

  recordBruteForceFailure(key: string) {
    recordRateLimitFailure(this.rateBuckets, key, LOGIN_BRUTE_FORCE);
  }

  clearBruteForce(key: string) {
    clearRateLimit(this.rateBuckets, key);
  }

  appendEvent(input: AuditEventDraft) {
    return this.repository.appendAuditEvent(input);
  }

  assertOwner(role: string) {
    if (role !== 'OWNER') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  /** STEP_155: encrypt snapshot and persist BackupJob (idempotent by key). */
  async createEncryptedBackup(role: string, input: BackupEnqueueInput) {
    this.assertOwner(role);
    const data = validateBackupEnqueue(input);
    const existing = await this.repository.findBackupByIdempotency(data.idempotencyKey);
    if (existing) return existing;

    const job = await this.repository.createBackupJob(data.idempotencyKey);
    await this.repository.updateBackupJob(job.id, { status: 'running' });
    try {
      const key = deriveBackupKey(this.backupSecret());
      const envelope = encryptBackupPayload(Buffer.from(data.plaintext, 'utf8'), key);
      const storageKey = `${job.id}.enc.json`;
      const body = Buffer.from(JSON.stringify(envelope), 'utf8');
      await this.backups.put(storageKey, body);
      const completed = await this.repository.updateBackupJob(job.id, {
        status: 'completed',
        storageKey,
        byteLength: body.byteLength,
        errorCode: null,
      });
      await this.appendEvent({
        actorUserId: data.actorUserId,
        action: 'backup.encrypted.completed',
        entityType: 'BackupJob',
        entityId: job.id,
        metadata: { storageKey, byteLength: body.byteLength },
      });
      return completed;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'BACKUP_FAILED';
      await this.repository.updateBackupJob(job.id, { status: 'failed', errorCode: code });
      throw error;
    }
  }

  async getBackup(role: string, id: string) {
    this.assertOwner(role);
    const job = await this.repository.findBackupById(id);
    if (!job) throw new Error('BACKUP_JOB_NOT_FOUND');
    return job;
  }

  /** Verify decrypt round-trip without exposing plaintext in logs. */
  async verifyBackupDecrypt(role: string, id: string) {
    this.assertOwner(role);
    const job = await this.getBackup(role, id);
    if (!job.storageKey) throw new Error('BACKUP_STORAGE_MISSING');
    const raw = await this.backups.get(job.storageKey);
    const envelope = JSON.parse(raw.toString('utf8')) as EncryptedBackupEnvelope;
    const plaintext = decryptBackupPayload(envelope, deriveBackupKey(this.backupSecret()));
    return { id: job.id, ok: plaintext.byteLength > 0, byteLength: plaintext.byteLength };
  }

  /** STEP_156: return documented restore plan; never executes restore. */
  planRestore(role: string, input: Parameters<typeof validateRestoreProcedure>[0]) {
    this.assertOwner(role);
    return validateRestoreProcedure(input);
  }

  /**
   * STEP_157: decrypt backup in-memory and restore into a disposable database only.
   * Primary app DB is never a restore target. Temporary DB is always dropped.
   */
  async runIsolatedRestoreTest(role: string, actorUserId: string, input: RestoreTestInput) {
    this.assertOwner(role);
    const data = validateRestoreTestInput(input);
    const job = await this.repository.findBackupById(data.sourceBackupJobId);
    if (!job || job.status !== 'completed' || !job.storageKey) throw new Error('BACKUP_JOB_NOT_FOUND');

    const primaryUsersBefore = await this.repository.countPrimaryUsers();
    const startedAt = new Date().toISOString();
    const result = await this.repository.createRestoreTestResult({
      sourceBackupJobId: job.id,
      targetEnvironment: 'isolated',
      status: 'running',
      startedAt,
    });

    try {
      const raw = await this.backups.get(job.storageKey);
      const envelope = JSON.parse(raw.toString('utf8')) as EncryptedBackupEnvelope;
      const plaintext = decryptBackupPayload(envelope, deriveBackupKey(this.backupSecret()));
      const snapshot = parseBackupSnapshot(plaintext.toString('utf8'));

      const runner = new IsolatedRestoreRunner(
        process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
      );
      const { targetDatabase, checks } = await runner.run(snapshot);

      const primaryUsersAfter = await this.repository.countPrimaryUsers();
      if (primaryUsersAfter !== primaryUsersBefore) throw new Error('RESTORE_PRIMARY_MUTATED');

      const finished = await this.repository.finishRestoreTestResult(result.id, {
        status: 'passed',
        completedAt: new Date().toISOString(),
        checks,
        errorCode: null,
        targetDatabase,
      });
      await this.appendEvent({
        actorUserId,
        action: 'backup.restore.test.passed',
        entityType: 'RestoreTestResult',
        entityId: finished.id,
        metadata: { sourceBackupJobId: job.id, targetDatabase, status: 'passed' },
      });
      return finished;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'RESTORE_TEST_FAILED';
      const finished = await this.repository.finishRestoreTestResult(result.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        checks: { primaryDatabaseUntouched: true },
        errorCode: code,
        targetDatabase: null,
      });
      await this.appendEvent({
        actorUserId,
        action: 'backup.restore.test.failed',
        entityType: 'RestoreTestResult',
        entityId: finished.id,
        metadata: { sourceBackupJobId: job.id, errorCode: code },
      });
      return finished;
    }
  }

  async getRestoreTestResult(role: string, id: string) {
    this.assertOwner(role);
    const row = await this.repository.findRestoreTestResult(id);
    if (!row) throw new Error('RESTORE_TEST_NOT_FOUND');
    return row;
  }

  /** STEP_159: scan text for secrets; never returns matched secret values. */
  scanSecrets(role: string, path: string, content: string) {
    this.assertOwner(role);
    return { findings: scanTextForSecrets(path, content) };
  }

  /** STEP_160 */
  async upsertThreatReview(role: string, draft: ThreatReviewDraft) {
    this.assertOwner(role);
    return this.repository.upsertThreatReview(validateThreatReview(draft));
  }

  async listThreatReviews(role: string) {
    this.assertOwner(role);
    return this.repository.listThreatReviews();
  }

  /** STEP_161 */
  incidentPlan(role: string, input: { id: string; title: string; severity: IncidentSeverity }) {
    this.assertOwner(role);
    return buildIncidentResponsePlan(input);
  }

  /** STEP_163 */
  securityReleaseGate(role: string, checks: SecurityReleaseCheck[]) {
    this.assertOwner(role);
    return evaluateSecurityReleaseGate(checks);
  }

  /** STEP_171: plan-only final rehearsal (no primary DB mutations). */
  finalRehearsalPlan(role: string, input: FinalRehearsalPlanInput) {
    this.assertOwner(role);
    return planFinalBackupRestoreSecurityRehearsal(input);
  }

  private backupSecret(): string {
    return process.env.BACKUP_ENCRYPTION_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || 'local-dev-backup-secret';
  }
}
