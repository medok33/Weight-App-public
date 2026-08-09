import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('STEP_153/154/155 migrations on disk', () => {
  it('ships AlertRule and BackupJob SQL', () => {
    const alerts = readFileSync(resolve('prisma/migrations/153_alert-rules/migration.sql'), 'utf8');
    const backups = readFileSync(resolve('prisma/migrations/154_backup-job/migration.sql'), 'utf8');
    expect(alerts).toContain('CREATE TABLE IF NOT EXISTS "AlertRule"');
    expect(alerts).toContain('CREATE TABLE IF NOT EXISTS "OwnerNotification"');
    expect(backups).toContain('CREATE TABLE IF NOT EXISTS "BackupJob"');
    expect(backups).toContain('"idempotencyKey"');
  });
});
