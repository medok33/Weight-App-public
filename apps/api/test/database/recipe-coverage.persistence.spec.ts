import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeCoverageAnalyzer } from '../../src/modules/recipe-platform/application/recipe-coverage-analyzer.service';
import { RecipeCoverageService } from '../../src/modules/recipe-platform/application/recipe-coverage.service';
import { COVERAGE_MATRIX_VERSION_V1 } from '../../src/modules/recipe-platform/domain/recipe-coverage.policy';
import { MealDishCatalogRepository } from '../../src/modules/meal-plan/infrastructure/meal-dish-catalog.repository';
import { COVERAGE_CORE_V1_SLOTS } from '../../src/modules/recipe-platform/seed/coverage-core-v1.slots';

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
          const result = await fn();
          return { acquired: true, result };
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

describe('RP2-03A coverage persistence', () => {
  const db = createDb();
  const analyzer = new RecipeCoverageAnalyzer(db);
  const coverage = new RecipeCoverageService(db, undefined, analyzer);
  const catalog = new MealDishCatalogRepository(db);
  let actorId = '';

  beforeAll(async () => {
    await applyMigration('191_recipe-coverage-slot');
    await applyMigration('192_recipe-coverage-assignment');
    await applyMigration('193_coverage-core-v1-marker');
    await applyMigration('194_recipe-coverage-analysis-run');
    await applyMigration('195_recipe-coverage-dirty-matrix-meta');
    await applyMigration('196_recipe-coverage-assignment-match-contract');
    await catalog.ensureCatalog();
    const coverageProductKeys = [...new Set(COVERAGE_CORE_V1_SLOTS.map((slot) => slot.primaryProductKey).filter(Boolean))] as string[];
    for (const productKey of coverageProductKeys) {
      await pool.query(
        `INSERT INTO "Product"
          ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g")
         VALUES ($1, $2, $1, 'g', 100, 10, 5, 10)
         ON CONFLICT ("productKey") DO NOTHING`,
        [`Coverage Fixture ${productKey}`, productKey],
      );
    }
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  it('seeds matrix idempotently and rejects duplicate slotKey', async () => {
    const first = await coverage.seedMatrixV1(actorId);
    const second = await coverage.seedMatrixV1(actorId);
    expect(first.created + first.existing).toBeGreaterThanOrEqual(50);
    expect(second.created).toBe(0);
    expect(second.existing).toBeGreaterThan(0);

    const sample = await pool.query(`SELECT * FROM "RecipeCoverageSlot" WHERE "matrixVersion" = $1 LIMIT 1`, [
      COVERAGE_MATRIX_VERSION_V1,
    ]);
    await expect(
      coverage.createSlot({
        actorUserId: actorId,
        actorRole: 'OWNER',
        name: 'dup',
        mealType: sample.rows[0]!.mealType,
        primaryProductId: sample.rows[0]!.primaryProductId,
        dishType: sample.rows[0]!.dishType,
        cookingMethod: sample.rows[0]!.cookingMethod,
        calorieMin: sample.rows[0]!.calorieMin,
        calorieMax: sample.rows[0]!.calorieMax,
        proteinMin: sample.rows[0]!.proteinMin == null ? null : Number(sample.rows[0]!.proteinMin),
        fatMax: sample.rows[0]!.fatMax == null ? null : Number(sample.rows[0]!.fatMax),
        maximumTimeMinutes: sample.rows[0]!.maximumTimeMinutes,
        dietaryProfile: sample.rows[0]!.dietaryProfile,
        equipmentProfile: sample.rows[0]!.equipmentProfile,
        desiredRecipeCount: 1,
        priority: 'LOW',
        provenance: 'TEST',
        rationale: 'dup',
      }),
    ).rejects.toThrow(/COVERAGE_SLOT_KEY_DUPLICATE/);
  });

  it('runs snapshot analysis and persists counts/status', async () => {
    const analysis = await coverage.runInitialSnapshotAnalysis(actorId);
    expect(analysis.slotsAnalyzed).toBeGreaterThan(0);
    expect(analysis.runId).toBeTruthy();
    const report = await coverage.matrixReport();
    expect(report.totalSlots).toBeGreaterThanOrEqual(50);
    expect(report.matrixVersion).toBe(COVERAGE_MATRIX_VERSION_V1);
    await applyMigration('191_recipe-coverage-slot');
  });
});
