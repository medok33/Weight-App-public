import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('plan revision confirm migration 168', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/168_plan-revision-confirm/migration.sql'), 'utf8');

  it('restricts status to confirmed and adds idempotency columns', () => {
    expect(sql).toContain('CHECK (status = \'confirmed\')');
    expect(sql).toContain('"idempotencyKey"');
    expect(sql).toContain('"requestHash"');
    expect(sql).toContain('PlanRevision_userId_idempotencyKey_key');
  });
});
