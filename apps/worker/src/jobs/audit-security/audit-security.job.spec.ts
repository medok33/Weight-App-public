import { describe, expect, it } from 'vitest';
import { createAuditSecurityBackupJob, createFinalRehearsalJob } from './audit-security.job';
import { processAuditSecurityBackupJob, processFinalRehearsalJob } from './audit-security.processor';

describe('audit-security backup job', () => {
  it('keeps idempotency key and records accepted status', () => {
    const job = createAuditSecurityBackupJob({
      idempotencyKey: 'bk-1',
      backupJobId: 'id-1',
      actorUserId: 'owner-1',
    });
    expect(processAuditSecurityBackupJob(job)).toMatchObject({
      idempotencyKey: 'bk-1',
      status: 'accepted',
    });
  });

  it('rejects invalid payload', () => {
    expect(() =>
      createAuditSecurityBackupJob({ idempotencyKey: '', backupJobId: 'x', actorUserId: 'y' }),
    ).toThrow('AUDIT_SECURITY_JOB_INVALID');
  });
});

describe('audit-security STEP_171 final rehearsal', () => {
  it('accepts isolated rehearsal without touching primary DB', () => {
    const job = createFinalRehearsalJob({
      idempotencyKey: 'reh-1',
      actorUserId: 'owner-1',
      targetDatabase: 'weight_app_restore_rehearsal',
      includeBackup: true,
      includeRestore: true,
      includeSecurityGate: true,
    });
    const result = processFinalRehearsalJob(job);
    expect(result.touchesPrimaryDatabase).toBe(false);
    expect(result.steps).toHaveLength(3);
    expect(result.status).toBe('accepted');
  });

  it('rejects primary / production targets', () => {
    expect(() =>
      createFinalRehearsalJob({
        idempotencyKey: 'reh-2',
        actorUserId: 'owner-1',
        targetDatabase: 'weight_app',
        includeBackup: true,
        includeRestore: false,
        includeSecurityGate: false,
      }),
    ).toThrow('FINAL_REHEARSAL_PRIMARY_FORBIDDEN');
  });
});
