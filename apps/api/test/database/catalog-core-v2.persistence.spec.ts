import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildCatalogCoreV2Manifest } from '../../src/modules/product-catalog/seed/catalog-core-v2.dataset';
import { buildPilotManifest } from '../../src/modules/product-catalog/seed/pilot-v1.dataset';
import { runCatalogSeed } from '../../src/modules/product-catalog/seed/apply-engine';
import { validateManifest } from '../../src/modules/product-catalog/seed/validate-manifest';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

describe('STEP_201 RP2-01C2B1 catalog-core-v2 persistence', () => {
  const manifest = buildCatalogCoreV2Manifest();

  beforeAll(async () => {
    // Ensure pilot ledger exists for lineage context (may already be applied).
    const pilot = buildPilotManifest();
    await runCatalogSeed({ client: pool, manifest: pilot, mode: 'apply' });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('validates v2 linkage and size', () => {
    expect(manifest.previousDatasetVersion).toBe('pilot-v1');
    expect(manifest.productCount).toBeGreaterThanOrEqual(150);
    expect(manifest.productCount).toBeLessThanOrEqual(180);
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('applies v2, preserves recipe refs, no-ops on repeat', async () => {
    const beforeIng = await pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM "RecipeIngredient"`);
    const first = await runCatalogSeed({ client: pool, manifest, mode: 'apply' });
    expect(['OK', 'NO_OP']).toContain(first.status);

    const count = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "Product" WHERE "productKey" = ANY($1::text[])`,
      [manifest.products.map((p) => p.productKey)],
    );
    expect(count.rows[0]!.c).toBe(manifest.productCount);

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
      forceChecksumProbe: 'f'.repeat(64),
    });
    expect(blocked.status).toBe('BLOCKED');
  });

  it('does not resurrect MERGED products', async () => {
    const key = 'pork_lean_raw';
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

    // restore for subsequent envs
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

  it('serializes concurrent apply to one logical batch', async () => {
    await pool.query(`DELETE FROM "CatalogSeedBatch" WHERE "datasetVersion"=$1`, ['catalog-core-v2-concurrent']);
    const fake = {
      ...manifest,
      datasetVersion: 'catalog-core-v2-concurrent',
      // reuse checksum/products for lock test — validation will fail size? use real manifest clone with unique version
    };
    // Use advisory lock path against real version by racing two applies after deleting ledger once
    await pool.query(`DELETE FROM "CatalogSeedBatch" WHERE "datasetVersion"=$1`, [manifest.datasetVersion]);
    const [a, b] = await Promise.all([
      runCatalogSeed({ client: pool, manifest, mode: 'apply' }),
      runCatalogSeed({ client: pool, manifest, mode: 'apply' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain('OK');
    expect(statuses.filter((s) => s === 'OK' || s === 'NO_OP').length).toBe(2);
    const batches = await pool.query(
      `SELECT COUNT(*)::int AS c FROM "CatalogSeedBatch" WHERE "datasetVersion"=$1`,
      [manifest.datasetVersion],
    );
    expect(batches.rows[0].c).toBe(1);
    void fake;
  }, 180_000);
});
