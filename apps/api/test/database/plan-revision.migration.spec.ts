import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('plan revision migration contract', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/167_plan-revision/migration.sql'), 'utf8');

  it('creates append-only plan revision storage', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "PlanRevision"');
    expect(sql).toContain('"PlanRevision_planId_planKind_version_key"');
    expect(sql).toContain('"PlanRevision_userId_createdAt_idx"');
    expect(sql).toContain('PLAN_REVISION_IMMUTABLE');
    expect(sql).toContain(`CHECK (status IN ('pending', 'confirmed'))`);
    expect(sql).toContain(`CHECK ("planKind" IN ('meal', 'workout'))`);
  });
});
