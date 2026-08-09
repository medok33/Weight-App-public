import type { AuditSecurityBackupJob, AuditSecurityFinalRehearsalJob } from './audit-security.job';

/**
 * Worker contract for encrypted backup.
 * Encryption + storage run in API AuditSecurityService; worker records accepted outcome.
 */
export function processAuditSecurityBackupJob(job: AuditSecurityBackupJob) {
  return {
    idempotencyKey: job.idempotencyKey,
    backupJobId: job.backupJobId,
    actorUserId: job.actorUserId,
    status: 'accepted' as const,
    next: 'api.audit-security.createEncryptedBackup',
  };
}

/**
 * STEP_171: final rehearsal processor.
 * Does not open primary DB connections; delegates to isolated API flows.
 */
export function processFinalRehearsalJob(job: AuditSecurityFinalRehearsalJob) {
  const steps: string[] = [];
  if (job.includeBackup) steps.push('api.audit-security.createEncryptedBackup');
  if (job.includeRestore) steps.push('api.audit-security.restoreTestIsolated');
  if (job.includeSecurityGate) steps.push('api.audit-security.securityReleaseGate');
  return {
    idempotencyKey: job.idempotencyKey,
    actorUserId: job.actorUserId,
    targetDatabase: job.targetDatabase,
    status: 'accepted' as const,
    touchesPrimaryDatabase: false,
    steps,
  };
}
