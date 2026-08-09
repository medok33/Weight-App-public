import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('export-share migration contract', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/150_export-share/migration.sql'), 'utf8');
  it('creates ExportJob with ownership and idempotency', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ExportJob"');
    expect(sql).toContain('ExportJob_idempotencyKey_key');
    expect(sql).toContain('ExportJob_userId_createdAt_idx');
  });
});
