import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildCatalogCoreV2Manifest } from '../../src/modules/product-catalog/seed/catalog-core-v2.dataset';
import { buildCatalogCoreV3Manifest } from '../../src/modules/product-catalog/seed/catalog-core-v3.dataset';
import { runCatalogSeed } from '../../src/modules/product-catalog/seed/apply-engine';
import { validateManifest } from '../../src/modules/product-catalog/seed/validate-manifest';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

describe('STEP_201 RP2-01C2B2 catalog-core-v3 persistence', () => {
  const manifest = buildCatalogCoreV3Manifest();

  beforeAll(async () => {
    const v2Ledger = await pool.query(
      `SELECT 1 FROM "CatalogSeedBatch" WHERE "datasetVersion"='catalog-core-v2' LIMIT 1`,
    );
    if (!v2Ledger.rowCount) {
      const v2 = buildCatalogCoreV2Manifest();
      await runCatalogSeed({ client: pool, manifest: v2, mode: 'apply' });
    }
  }, 180_000);

  afterAll(async () => {
    await pool.end();
  });

  it('validates final size and linkage', () => {
    expect(manifest.previousDatasetVersion).toBe('catalog-core-v2');
    expect(manifest.productCount).toBeGreaterThanOrEqual(250);
    expect(manifest.productCount).toBeLessThanOrEqual(350);
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.sourceCoverage?.withSourceRecordId).toBe(manifest.productCount);
    expect(manifest.reviewSummary?.blocking).toBe(0);
  });

  it('applies v3, preserves recipe refs, no-ops on repeat', async () => {
    const beforeIng = await pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM "RecipeIngredient"`);
    // Force a real apply once so seedDatasetVersion advances even if an older dataset was re-applied.
    await pool.query(`DELETE FROM "CatalogSeedBatch" WHERE "datasetVersion"=$1`, [manifest.datasetVersion]);
    const first = await runCatalogSeed({ client: pool, manifest, mode: 'apply' });
    expect(first.status).toBe('OK');

    const count = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "Product" WHERE "productKey" = ANY($1::text[])`,
      [manifest.products.map((p) => p.productKey)],
    );
    expect(count.rows[0]!.c).toBe(manifest.productCount);

    const tagged = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "Product" WHERE "seedDatasetVersion"=$1`,
      [manifest.datasetVersion],
    );
    expect(tagged.rows[0]!.c).toBe(manifest.productCount);

    const afterIng = await pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM "RecipeIngredient"`);
    expect(afterIng.rows[0]!.c).toBe(beforeIng.rows[0]!.c);

    const second = await runCatalogSeed({ client: pool, manifest, mode: 'apply' });
    expect(second.status).toBe('NO_OP');
  }, 180_000);

  it('blocks different checksum for same version', async () => {
    const blocked = await runCatalogSeed({
      client: pool,
      manifest,
      mode: 'apply',
      forceChecksumProbe: 'a'.repeat(64),
    });
    expect(blocked.status).toBe('BLOCKED');
  });

  it('does not resurrect MERGED products', async () => {
    const key = 'duck_breast_raw';
    const row = await pool.query<{ id: string }>(`SELECT id FROM "Product" WHERE "productKey"=$1`, [key]);
    expect(row.rows[0]).toBeTruthy();
    const id = row.rows[0]!.id;
    const survivor = await pool.query<{ id: string }>(
      `SELECT id FROM "Product" WHERE "productKey"='step092_chicken' LIMIT 1`,
    );
    await pool.query(
      `UPDATE "Product" SET status='MERGED', "canonicalProductId"=$2, "mergedAt"=now(), "reviewStatus"='RESOLVED'
       WHERE id=$1`,
      [id, survivor.rows[0]!.id],
    );
    await pool.query(`DELETE FROM "CatalogSeedBatch" WHERE "datasetVersion"=$1`, [manifest.datasetVersion]);

    const result = await runCatalogSeed({ client: pool, manifest, mode: 'apply' });
    expect(result.status).toBe('OK');
    expect(result.conflicts.some((c) => c.code === 'SEED_MERGED_PRODUCT_PROTECTED' && c.productKey === key)).toBe(
      true,
    );
    const status = await pool.query<{ status: string }>(`SELECT status FROM "Product" WHERE id=$1`, [id]);
    expect(status.rows[0]!.status).toBe('MERGED');

    await pool.query(
      `UPDATE "Product" SET status='ACTIVE', "canonicalProductId"=NULL, "mergedAt"=NULL, "reviewStatus"='NEEDS_REVIEW'
       WHERE id=$1`,
      [id],
    );
    await pool.query(
      `INSERT INTO "CatalogSeedBatch" ("datasetVersion", checksum, "productCount", status, "durationMs", "resultJson")
       VALUES ($1,$2,$3,'APPLIED',1,'{}')
       ON CONFLICT ("datasetVersion") DO UPDATE SET checksum=EXCLUDED.checksum, status='APPLIED'`,
      [manifest.datasetVersion, manifest.checksum, manifest.productCount],
    );
  }, 120_000);
});
