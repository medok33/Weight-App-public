import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('audit-event migration', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/152_audit-event/migration.sql'), 'utf8');
  it('creates append-only AuditEvent table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "AuditEvent"');
    expect(sql).toContain('AuditEvent_createdAt_idx');
  });
});
