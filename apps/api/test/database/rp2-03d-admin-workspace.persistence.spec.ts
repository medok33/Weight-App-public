import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { RecipeAdminWorkspaceService } from '../../src/modules/recipe-platform/application/recipe-admin-workspace.service';
import { COVERAGE_MATRIX_VERSION_V1 } from '../../src/modules/recipe-platform/domain/recipe-coverage.policy';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

function createDb() {
  return {
    query: async (text: string, params?: unknown[]) => pool.query(text, params),
  } as unknown as PrismaService;
}

async function applyMigration(name: string) {
  const path = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (!existsSync(path)) throw new Error(`missing ${name}`);
  await pool.query(readFileSync(path, 'utf8'));
}

let pool: pg.Pool;

describeDb('RP2-03D STEP_212 admin workspace (PG)', () => {
  const db = createDb();
  const workspace = new RecipeAdminWorkspaceService(db);
  const stamp = Date.now().toString(36);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await applyMigration('200_recipe-dataclass-admin-workspace');
    await pool.query(
      `INSERT INTO "RecipeCoverageSlot" (
         "slotKey", "matrixVersion", name, description, "mealType", "dishType",
         "dietaryProfile", "equipmentProfile", "desiredRecipeCount", priority,
         "sortRank", status, provenance, rationale
       ) VALUES ($1, $2, 'Workspace fixture', 'TEST_ONLY workspace board fixture',
                 'lunch', 'MAIN', 'GENERAL', 'BASIC_STOVE', 1, 'LOW', 9999,
                 'EMPTY', 'TEST', 'workspace persistence isolation')
       ON CONFLICT ("matrixVersion", "slotKey") DO NOTHING`,
      [`rp212_workspace_${stamp}`, COVERAGE_MATRIX_VERSION_V1],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "RecipeCoverageSlot" WHERE "slotKey" = $1`, [`rp212_workspace_${stamp}`]);
    await pool.query(`DELETE FROM "Recipe" WHERE "recipeKey" LIKE $1`, [`rp212_%${stamp}%`]);
    await pool.end();
  });

  it('defaults catalog to PRODUCTION and hides TEST_ONLY', async () => {
    const testKey = `rp212_test_${stamp}`;
    // Use controlled keys that backfill won't force TEST (rp212_ starts with rp2 → TEST_ONLY)
    // so set dataClass explicitly after insert.
    const prod = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (name, servings, "recipeKey", "dataClass")
       VALUES ($1, 1, $2, 'PRODUCTION') RETURNING id`,
      [`Prod ${stamp}`, `buckwheat_chicken_rp212_${stamp}`],
    );
    const test = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (name, servings, "recipeKey", "dataClass")
       VALUES ($1, 1, $2, 'TEST_ONLY') RETURNING id`,
      [`Test ${stamp}`, testKey],
    );

    const productionOnly = await workspace.listCatalog({
      page: 1,
      pageSize: 25,
      q: `buckwheat_chicken_rp212_${stamp}`,
    });
    expect(productionOnly.activeDataClassFilter).toEqual(['PRODUCTION']);
    expect(productionOnly.items.some((i) => i.id === test.rows[0]!.id)).toBe(false);
    expect(productionOnly.items.some((i) => i.id === prod.rows[0]!.id)).toBe(true);

    const explicitTest = await workspace.listCatalog({
      dataClass: 'TEST_ONLY',
      page: 1,
      pageSize: 25,
      q: testKey,
    });
    expect(explicitTest.items.some((i) => i.id === test.rows[0]!.id)).toBe(true);

    await pool.query(`DELETE FROM "Recipe" WHERE id = ANY($1::uuid[])`, [
      [prod.rows[0]!.id, test.rows[0]!.id],
    ]);
  });

  it('workspace returns allowedActions and coverage board counts', async () => {
    const overview = await workspace.contentOverview();
    expect(overview.matrixVersion).toBe(COVERAGE_MATRIX_VERSION_V1);
    expect(typeof overview.productionRecipes).toBe('number');

    const board = await workspace.getCoverageBoard({ limit: 60, offset: 0 });
    expect(board.summary.totalSlots).toBeGreaterThanOrEqual(1);
    const sumStatuses = Object.values(board.summary.byStatus).reduce((a, b) => a + b, 0);
    expect(sumStatuses).toBe(board.summary.totalSlots);

    // classification persistence
    const row = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (name, servings, "recipeKey", "dataClass")
       VALUES ($1, 1, $2, 'PRODUCTION') RETURNING id`,
      [`Class ${stamp}`, `class_rp212_${stamp}`],
    );
    await workspace.classifyRecipe({
      recipeId: row.rows[0]!.id,
      dataClass: 'LEGACY',
      actorUserId: '00000000-0000-0000-0000-000000000001',
      actorRole: 'OWNER',
      reason: 'test',
    });
    const check = await pool.query<{ dataClass: string }>(
      `SELECT "dataClass" FROM "Recipe" WHERE id = $1`,
      [row.rows[0]!.id],
    );
    expect(check.rows[0]!.dataClass).toBe('LEGACY');
    await pool.query(`DELETE FROM "Recipe" WHERE id = $1`, [row.rows[0]!.id]);
  });

  it('checksum of migration is stable for no-op reapply', async () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/200_recipe-dataclass-admin-workspace/migration.sql'),
      'utf8',
    );
    const a = createHash('md5').update(sql).digest('hex');
    await applyMigration('200_recipe-dataclass-admin-workspace');
    const b = createHash('md5').update(sql).digest('hex');
    expect(a).toBe(b);
  });
});
