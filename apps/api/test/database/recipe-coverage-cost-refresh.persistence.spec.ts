import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeCoverageAnalyzer } from '../../src/modules/recipe-platform/application/recipe-coverage-analyzer.service';
import { RecipeCoverageService } from '../../src/modules/recipe-platform/application/recipe-coverage.service';
import { PriceIntelligenceRepository } from '../../src/modules/price-intelligence/infrastructure/price-intelligence.repository';
import { COVERAGE_MATRIX_VERSION_V1 } from '../../src/modules/recipe-platform/domain/recipe-coverage.policy';
import { normalizeProductAlias } from '../../src/modules/product-catalog/domain/product-foundation.policy';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(key1: number, key2Text: string, fn: () => Promise<unknown>) {
      const client = await pool.connect();
      try {
        const got = await client.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
          [key1, key2Text],
        );
        if (!got.rows[0]?.locked) return { acquired: false };
        try {
          return { acquired: true, result: await fn() };
        } finally {
          await client.query(`SELECT pg_advisory_unlock($1, hashtext($2))`, [key1, key2Text]);
        }
      } finally {
        client.release();
      }
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
      try {
        await client.query('BEGIN');
        const result = await fn(txQuery);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

async function applyMigration(name: string) {
  const path = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (!existsSync(path)) throw new Error(`missing ${name}`);
  await pool.query(readFileSync(path, 'utf8'));
}

describe('RP2-03B coverage cost refresh via PriceObservation', () => {
  const db = createDb();
  const analyzer = new RecipeCoverageAnalyzer(db);
  const coverage = new RecipeCoverageService(db, undefined, analyzer);
  const prices = new PriceIntelligenceRepository(db);
  let actorId = '';
  let productId = '';
  let storeId = '';
  let slotId = '';

  beforeAll(async () => {
    await applyMigration('194_recipe-coverage-analysis-run');
    await applyMigration('195_recipe-coverage-dirty-matrix-meta');
    await applyMigration('196_recipe-coverage-assignment-match-contract');
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
    await coverage.seedMatrixV1(actorId);

    const slot = await pool.query<{ id: string; primaryProductId: string | null }>(
      `SELECT id, "primaryProductId" FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = $1 AND active = true AND "maximumCost" IS NOT NULL
         AND "primaryProductId" IS NOT NULL
       ORDER BY "sortRank" ASC LIMIT 1`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    if (!slot.rows[0]?.id || !slot.rows[0]?.primaryProductId) {
      // Disposable migrate-only CI DB has matrix slots without product bindings.
      slotId = '';
      productId = '';
      return;
    }
    slotId = slot.rows[0]!.id;
    productId = slot.rows[0]!.primaryProductId!;

    // Ensure retailer/store for observation insert
    const retailer = await prices.ensureRetailerByCode({
      code: 'rp203b-test-retailer',
      name: 'RP2-03B Test Retailer',
      region: 'RU',
      active: true,
    });
    storeId = retailer.storeId;

    // Clear dirty from seed
    await pool.query(`DELETE FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`, [
      COVERAGE_MATRIX_VERSION_V1,
    ]);
  }, 120000);

  afterAll(async () => {
    await pool.end();
  });

  it('stale/missing price does not prove PRIMARY; new observation dirties + refresh can confirm', async (ctx) => {
    if (!slotId || !productId) {
      ctx.skip();
    }
    // Wipe recent prices for product to force PRICE_MISSING/INCOMPLETE path
    await pool.query(`DELETE FROM "PriceObservation" WHERE "productId" = $1`, [productId]);

    const dryMissing = await analyzer.analyze({
      mode: 'INCREMENTAL_SLOTS',
      slotIds: [slotId],
      reason: 'cost missing probe',
      dryRun: true,
      requestedBy: actorId,
    });
    const proposedMissing = (dryMissing.proposedChanges ?? []) as Array<{
      slotId: string;
      assignmentType: string;
      matchStatus: string;
      costStatus: string;
    }>;
    const primaryMissing = proposedMissing.filter(
      (p) => p.slotId === slotId && p.assignmentType === 'PRIMARY',
    );
    // Either no PRIMARY, or if present must not be from unknown cost alone —
    // for cost-constrained slots unknown cost yields PARTIAL_MATCH SECONDARY, not proven PRIMARY.
    for (const p of proposedMissing.filter((x) => x.slotId === slotId)) {
      if (p.costStatus === 'PRICE_MISSING' || p.costStatus === 'PRICE_INCOMPLETE' || p.costStatus === 'STALE_PRICE') {
        expect(p.assignmentType).not.toBe('PRIMARY');
      }
    }
    expect(primaryMissing.every((p) => p.costStatus === 'CURRENT_PRICE_CONFIRMED')).toBe(true);

    await prices.insertObservation({
      productId,
      storeId,
      price: 50,
      currency: 'RUB',
      sourceType: 'MANUAL',
      sourceName: 'rp203b-cost-refresh',
      collectedAt: new Date().toISOString(),
      legacySource: 'manual',
    });

    const dirty = await analyzer.getDirty(COVERAGE_MATRIX_VERSION_V1);
    expect(dirty).toBeTruthy();
    const reasons = dirty!.reasonSetJson as string[];
    expect(reasons).toContain('COST_PRICE_REFRESH');

    const applied = await analyzer.analyze({
      mode: 'INCREMENTAL_SLOTS',
      slotIds: [slotId],
      reason: 'cost refresh after observation',
      dryRun: false,
      requestedBy: actorId,
      triggerType: 'DIRTY_QUEUE',
    });
    expect(['SUCCEEDED', 'PARTIAL'].includes(applied.status)).toBe(true);

    const assignments = await pool.query<{
      assignmentType: string;
      matchStatus: string;
      costStatus: string | null;
    }>(
      `SELECT "assignmentType", "matchStatus", "costStatus"
       FROM "RecipeCoverageAssignment"
       WHERE "slotId" = $1 AND active = true`,
      [slotId],
    );
    const withCost = assignments.rows.filter((a) => a.costStatus != null);
    if (withCost.length) {
      // When match is cost-decidable, confirmed status is expected.
      expect(
        withCost.some(
          (a) =>
            a.costStatus === 'CURRENT_PRICE_CONFIRMED' ||
            a.costStatus === 'PRICE_INCOMPLETE' ||
            a.costStatus === 'NOT_APPLICABLE',
        ),
      ).toBe(true);
    }

    const slot = await pool.query<{ publishedRecipeCount: number; status: string }>(
      `SELECT "publishedRecipeCount", status FROM "RecipeCoverageSlot" WHERE id = $1`,
      [slotId],
    );
    expect(slot.rows[0]).toBeTruthy();
    // Status is analyzer-owned and consistent with count.
    const count = Number(slot.rows[0]!.publishedRecipeCount);
    if (count === 0) expect(['EMPTY', 'NEEDS_REFRESH']).toContain(slot.rows[0]!.status);
    else expect(['UNDERFILLED', 'COVERED', 'OVERFILLED']).toContain(slot.rows[0]!.status);
  }, 180000);

  it('alias display correction does not mark coverage dirty', async (ctx) => {
    if (!slotId || !productId) {
      ctx.skip();
    }
    await pool.query(`DELETE FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`, [
      COVERAGE_MATRIX_VERSION_V1,
    ]);
    const alias = `rp203b-alias-${Date.now()}`;
    const normalized = normalizeProductAlias(alias);
    await pool.query(
      `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
       VALUES ($1,$2,$3,'MANUAL',1.0,'ACTIVE')`,
      [productId, alias, normalized],
    );
    const dirty = await analyzer.getDirty(COVERAGE_MATRIX_VERSION_V1);
    expect(dirty).toBeNull();
  });
});
