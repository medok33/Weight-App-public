import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration 170_shopping-list-plan-version', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/170_shopping-list-plan-version/migration.sql'),
    'utf8',
  );

  it('adds plan version linkage and status columns', () => {
    expect(sql).toContain('"sourcePlanId"');
    expect(sql).toContain('"sourcePlanVersion"');
    expect(sql).toContain('"generationStatus"');
    expect(sql).toContain('"generatedAt"');
    expect(sql).toContain('ShoppingList_userId_sourcePlanVersion_uidx');
    expect(sql).toContain("CHECK (\"generationStatus\" IN ('CURRENT', 'STALE', 'REBUILDING', 'FAILED'))");
  });
});
