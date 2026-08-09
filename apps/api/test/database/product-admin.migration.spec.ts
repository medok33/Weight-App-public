import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('178_product-admin-merge migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/178_product-admin-merge/migration.sql'),
    'utf8',
  );

  it('adds merge lineage and review decision table', () => {
    expect(sql).toContain('canonicalProductId');
    expect(sql).toContain('MERGED');
    expect(sql).toContain('ProductReviewDecision');
    expect(sql).toContain('rowVersion');
  });
});
