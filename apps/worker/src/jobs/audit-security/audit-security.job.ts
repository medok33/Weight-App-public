export type AuditSecurityBackupJob = {
  idempotencyKey: string;
  backupJobId: string;
  actorUserId: string;
};

export function createAuditSecurityBackupJob(payload: AuditSecurityBackupJob): AuditSecurityBackupJob {
  if (!payload.idempotencyKey?.trim() || !payload.backupJobId?.trim() || !payload.actorUserId?.trim()) {
    throw new Error('AUDIT_SECURITY_JOB_INVALID');
  }
  return {
    idempotencyKey: payload.idempotencyKey.trim(),
    backupJobId: payload.backupJobId.trim(),
    actorUserId: payload.actorUserId.trim(),
  };
}

/** STEP_171: final backup / isolated restore / security rehearsal (never primary DB). */
export type AuditSecurityFinalRehearsalJob = {
  idempotencyKey: string;
  actorUserId: string;
  targetDatabase: string;
  includeBackup: boolean;
  includeRestore: boolean;
  includeSecurityGate: boolean;
};

export function createFinalRehearsalJob(
  payload: AuditSecurityFinalRehearsalJob,
): AuditSecurityFinalRehearsalJob {
  if (!payload.idempotencyKey?.trim() || !payload.actorUserId?.trim()) {
    throw new Error('FINAL_REHEARSAL_JOB_INVALID');
  }
  const targetDatabase = payload.targetDatabase?.trim() ?? '';
  if (!targetDatabase || targetDatabase === 'weight_app' || /prod/i.test(targetDatabase)) {
    throw new Error('FINAL_REHEARSAL_PRIMARY_FORBIDDEN');
  }
  if (!payload.includeBackup && !payload.includeRestore && !payload.includeSecurityGate) {
    throw new Error('FINAL_REHEARSAL_JOB_INVALID');
  }
  return {
    idempotencyKey: payload.idempotencyKey.trim(),
    actorUserId: payload.actorUserId.trim(),
    targetDatabase,
    includeBackup: payload.includeBackup === true,
    includeRestore: payload.includeRestore === true,
    includeSecurityGate: payload.includeSecurityGate === true,
  };
}
