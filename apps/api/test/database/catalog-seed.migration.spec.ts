import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('179_catalog-seed-batch migration SQL', () => {
  it('creates CatalogSeedBatch and Product seed provenance columns', () => {
    const sql = readFileSync('prisma/migrations/179_catalog-seed-batch/migration.sql', 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "CatalogSeedBatch"');
    expect(sql).toContain('"datasetVersion"');
    expect(sql).toContain('seedDatasetVersion');
    expect(sql).toContain('seedProvenance');
    expect(sql).not.toMatch(/001_|178_/);
  });
});
