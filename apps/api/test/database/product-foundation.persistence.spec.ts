import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import {
  ProductAliasResolver,
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../src/modules/product-catalog/application/product-foundation.resolvers';
import { MealDishCatalogRepository } from '../../src/modules/meal-plan/infrastructure/meal-dish-catalog.repository';
import { MealDishDetailService } from '../../src/modules/meal-plan/application/meal-dish-detail.service';
import { MealPlanRepository } from '../../src/modules/meal-plan/infrastructure/meal-plan.repository';
import { buildWeeklyPlan } from '../../src/modules/meal-plan/domain/meal-plan.builder';
import { validatePlan } from '../../src/modules/meal-plan/domain/meal-plan.policy';
import { STEP092_PRODUCTS } from '../../src/modules/meal-plan/domain/meal-dish.fixture';
import { normalizeProductAlias } from '../../src/modules/product-catalog/domain/product-foundation.policy';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return { query, withTransaction: async (fn) => fn(query) } as PrismaService;
}

async function applyMigration(name: string): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');
  await pool.query(sql);
}

describe('RP2-01A product foundation persistence', () => {
  const db = createDb();
  const nutrition = new ProductNutritionResolver(db);
  const aliases = new ProductAliasResolver(db);
  const restrictions = new ProductRestrictionResolver(db);
  const catalog = new MealDishCatalogRepository(db);
  const plans = new MealPlanRepository(db);
  const details = new MealDishDetailService(db, catalog, nutrition, restrictions);
  const probeProductId = STEP092_PRODUCTS[0]!.id;
  const snapshotIds = new Map<string, string>();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await applyMigration('169_meal-dish-detail');
    await applyMigration('171_product-category-and-form');
    await applyMigration('172_product-alias-normalization');
    await applyMigration('173_product-nutrition-version');
    await applyMigration('174_product-allergen-dietary');
    await catalog.ensureCatalog();

    for (const p of STEP092_PRODUCTS) {
      await pool.query(
        `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
         VALUES ($1, $2, $3, 'FIXTURE', 1, 'ACTIVE')
         ON CONFLICT ("productId", "normalizedAlias") WHERE (status = 'ACTIVE') DO NOTHING`,
        [p.id, p.canonicalName, normalizeProductAlias(p.canonicalName)],
      );
      const row = await pool.query<{ id: string }>(
        `SELECT id FROM "Product" WHERE "productKey" = $1`,
        [p.productKey],
      );
      snapshotIds.set(p.productKey, row.rows[0]!.id);
    }
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('preserves Product IDs and RecipeIngredient references after foundation migrations', async () => {
    for (const p of STEP092_PRODUCTS) {
      expect(snapshotIds.get(p.productKey)).toBe(p.id);
    }
    const refs = await pool.query<{ productId: string }>(
      `SELECT DISTINCT "productId" FROM "RecipeIngredient" ri
       JOIN "Recipe" r ON r.id = ri."recipeId"
       WHERE r."recipeKey" IS NOT NULL`,
    );
    expect(refs.rows.length).toBeGreaterThan(0);
    for (const row of refs.rows) {
      const exists = await pool.query(`SELECT 1 FROM "Product" WHERE id = $1`, [row.productId]);
      expect(exists.rowCount).toBe(1);
    }
  });

  it('backfills nutrition version 1 idempotently and rejects immutable updates', async () => {
    const before = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "ProductNutritionVersion" WHERE "productId" = $1`,
      [probeProductId],
    );
    await applyMigration('173_product-nutrition-version');
    const after = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "ProductNutritionVersion" WHERE "productId" = $1`,
      [probeProductId],
    );
    expect(after.rows[0]!.c).toBe(before.rows[0]!.c);

    const snap = await nutrition.resolveForProduct(probeProductId);
    expect(snap.status).toBe('CURRENT_VERSION');
    expect(snap.version).toBe(1);
    expect(snap.calories).toBeGreaterThan(0);

    await expect(
      pool.query(`UPDATE "ProductNutritionVersion" SET calories = calories + 1 WHERE "productId" = $1`, [
        probeProductId,
      ]),
    ).rejects.toThrow(/PRODUCT_NUTRITION_VERSION_IMMUTABLE/);
    await expect(
      pool.query(`DELETE FROM "ProductNutritionVersion" WHERE "productId" = $1`, [probeProductId]),
    ).rejects.toThrow(/PRODUCT_NUTRITION_VERSION_IMMUTABLE/);
  });

  it('resolves aliases and keeps AMBIGUOUS explicit', async () => {
    const unique = await aliases.resolve('овсянка');
    // may be NOT_FOUND if fixture name differs; ensure deterministic normalize path
    const byCanonical = await aliases.resolve(STEP092_PRODUCTS[0]!.canonicalName);
    expect(['EXACT', 'UNIQUE_NORMALIZED_MATCH']).toContain(byCanonical.kind);
    expect(byCanonical.productIds).toEqual([STEP092_PRODUCTS[0]!.id]);

    await pool.query(
      `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
       VALUES ($1, 'shared alias probe', 'shared alias probe', 'FIXTURE', 0.5, 'ACTIVE'),
              ($2, 'shared alias probe', 'shared alias probe', 'FIXTURE', 0.5, 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [STEP092_PRODUCTS[0]!.id, STEP092_PRODUCTS[1]!.id],
    );
    // Partial unique is per productId+normalizedAlias, so same normalizedAlias across products is allowed.
    const ambiguous = await aliases.resolve('shared alias probe');
    expect(ambiguous.kind).toBe('AMBIGUOUS');
    expect(ambiguous.productIds.length).toBeGreaterThan(1);
    void unique;
  });

  it('rejects deleting category that still has products', async () => {
    const cat = await pool.query<{ id: string }>(
      `SELECT "categoryId" AS id FROM "Product" WHERE id = $1`,
      [probeProductId],
    );
    await expect(pool.query(`DELETE FROM "ProductCategory" WHERE id = $1`, [cat.rows[0]!.id])).rejects.toThrow();
  });

  it('maps allergens/dietary tags and serves STEP_092 day detail via nutrition resolver', async () => {
    const rest = await restrictions.resolveForProduct(probeProductId);
    expect(rest.productId).toBe(probeProductId);

    const userId = 'a193a193-a193-4193-8193-a193a193a193';
    await pool.query(`INSERT INTO "User" (id, email) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [
      userId,
      'rp201a@test.local',
    ]);
    const version = Date.now() % 100000;
    await plans.save(validatePlan(buildWeeklyPlan(userId, [], { version })));
    const day = await details.getDayDetail(userId, 0, {
      targetKcal: 2500,
      proteinG: 120,
      fatG: 80,
      carbsG: 280,
      tdeeKcal: 2700,
      bmrKcal: 1700,
    });
    expect(day.items[0]?.calories).toBeGreaterThan(0);
    expect(day.items[0]?.substitutionReady.ingredientProductIds.length).toBeGreaterThan(0);
  });

  it('writes reproducible backfill report artifact', async () => {
    const stats = await pool.query<{
      products: string;
      classified: string;
      unclassified: string;
      withNutrition: string;
      withoutNutrition: string;
      aliases: string;
      allergens: string;
      dietary: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM "Product") AS products,
         (SELECT count(*)::text FROM "Product" p JOIN "ProductCategory" c ON c.id = p."categoryId" WHERE c.code <> 'UNCLASSIFIED') AS classified,
         (SELECT count(*)::text FROM "Product" p JOIN "ProductCategory" c ON c.id = p."categoryId" WHERE c.code = 'UNCLASSIFIED') AS unclassified,
         (SELECT count(*)::text FROM "Product" WHERE "currentNutritionVersionId" IS NOT NULL) AS "withNutrition",
         (SELECT count(*)::text FROM "Product" WHERE "currentNutritionVersionId" IS NULL) AS "withoutNutrition",
         (SELECT count(*)::text FROM "ProductAlias") AS aliases,
         (SELECT count(*)::text FROM "ProductAllergen") AS allergens,
         (SELECT count(*)::text FROM "ProductDietaryTag") AS dietary`,
    );
    const row = stats.rows[0]!;
    const report = {
      package: 'RP2-01A',
      steps: ['STEP_193', 'STEP_194', 'STEP_195', 'STEP_196', 'STEP_197'],
      generatedAt: new Date().toISOString(),
      productsProcessed: Number(row.products),
      categoryAssigned: Number(row.classified),
      categoryUnclassified: Number(row.unclassified),
      nutritionVersioned: Number(row.withNutrition),
      nutritionMissing: Number(row.withoutNutrition),
      aliasesMigrated: Number(row.aliases),
      allergensLinked: Number(row.allergens),
      dietaryTagsLinked: Number(row.dietary),
      legacyFieldsStillPresent: [
        'Product.caloriesPer100g',
        'Product.proteinPer100g',
        'Product.fatPer100g',
        'Product.carbsPer100g',
        'Product.category',
        'Recipe.allergens jsonb',
        'Recipe.dietaryTags jsonb',
        'Product.packageSize',
        'Product.packageUnit',
      ],
      notes: [
        'Product form stored on Product (model A); dry vs boiled = separate Product rows.',
        'Absence of ProductAllergen does not mean allergen-free.',
        'No PII included.',
      ],
    };
    const outDir = process.env.WEIGHT_APP_DISPOSABLE_MODE === '1'
      ? resolve(process.cwd(), '../../.data/verification/recipe-platform')
      : resolve(process.cwd(), '../../docs/recipe-platform');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'RP2_01A_BACKFILL_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
    expect(report.productsProcessed).toBeGreaterThan(0);
  });
});
