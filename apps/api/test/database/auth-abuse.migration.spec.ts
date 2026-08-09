import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('203_auth-abuse-controls migration', () => {
  const path = existsSync(resolve(process.cwd(), 'prisma/migrations/203_auth-abuse-controls/migration.sql'))
    ? resolve(process.cwd(), 'prisma/migrations/203_auth-abuse-controls/migration.sql')
    : resolve(process.cwd(), 'apps/api/prisma/migrations/203_auth-abuse-controls/migration.sql');
  const sql = readFileSync(path, 'utf8');

  it('creates durable throttle and lockout tables with lookup constraints', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "AuthThrottleBucket"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "AuthAccountLockout"');
    expect(sql).toContain('AuthThrottleBucket_action_subject_unique');
    expect(sql).toContain('"action" IN (');
    expect(sql).toContain('"subjectType" IN (');
    expect(sql).toContain('AuthThrottleBucket_lookup_idx');
    expect(sql).toContain('AuthAccountLockout_lockedUntil_idx');
  });
});
