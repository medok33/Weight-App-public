import { describe, expect, it } from 'vitest';
import { IsolatedRestoreRunner } from '../../src/modules/audit-security/infrastructure/isolated-restore.runner';
import {
  decryptBackupPayload,
  deriveBackupKey,
  encryptBackupPayload,
} from '../../src/modules/audit-security/domain/audit-security.policy';
import { BackupObjectStorage } from '../../src/modules/audit-security/infrastructure/backup-object-storage';
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

describe('STEP_157 isolated restore smoke', () => {
  it('restores into disposable DB then drops it; primary stays intact', async () => {
    const primary = new pg.Client({ connectionString: DATABASE_URL });
    await primary.connect();
    const before = await primary.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM "User"');
    const beforeCount = Number(before.rows[0].c);

    const snapshot = {
      version: 1 as const,
      tables: {
        User: [{ id: '11111111-1111-1111-1111-111111111111', email: 'restore-test@example.com' }],
        Session: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            userId: '11111111-1111-1111-1111-111111111111',
            tokenHash: 'hash-only',
          },
        ],
        AuditEvent: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            action: 'restore.test.seed',
            actorUserId: '11111111-1111-1111-1111-111111111111',
          },
        ],
      },
    };

    const key = deriveBackupKey('local-dev-backup-secret');
    const envelope = encryptBackupPayload(Buffer.from(JSON.stringify(snapshot), 'utf8'), key);
    const storage = new BackupObjectStorage();
    const storageKey = `restore-smoke-${Date.now()}.enc.json`;
    await storage.put(storageKey, Buffer.from(JSON.stringify(envelope), 'utf8'));

    const raw = await storage.get(storageKey);
    const plaintext = decryptBackupPayload(JSON.parse(raw.toString('utf8')), key).toString('utf8');
    const runner = new IsolatedRestoreRunner(DATABASE_URL);
    const { targetDatabase, checks } = await runner.run(JSON.parse(plaintext));

    expect(checks.userCount).toBe(1);
    expect(checks.sessionCount).toBe(1);
    expect(checks.auditEventCount).toBe(1);
    expect(checks.primaryDatabaseUntouched).toBe(true);
    expect(targetDatabase.startsWith('weight_app_restore_')).toBe(true);

    const after = await primary.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM "User"');
    expect(Number(after.rows[0].c)).toBe(beforeCount);

    const leftover = await primary.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS exists`,
      [targetDatabase],
    );
    expect(leftover.rows[0].exists).toBe(false);
    await primary.end();
  }, 60_000);
});
