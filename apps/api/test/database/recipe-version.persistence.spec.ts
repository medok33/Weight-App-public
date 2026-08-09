import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

async function applyMigration(name: string) {
  const path = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (!existsSync(path)) throw new Error(`missing migration ${name}`);
  await pool.query(readFileSync(path, 'utf8'));
}

describe('recipe platform version persistence (RP2-02A)', () => {
  let recipeId = '';
  let versionId = '';
  let mealItemId = '';
  let userId = '';
  let planId = '';

  beforeAll(async () => {
    await applyMigration('180_recipe-family');
    await applyMigration('181_recipe-version');
    await applyMigration('182_meal-item-recipe-version');
    await applyMigration('183_recipe-version-immutability');

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    userId = user.rows[0]!.id;

    const product = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g")
       VALUES (gen_random_uuid(), $1, 'g', 100, 10, 1, 5)
       ON CONFLICT ("canonicalName") DO UPDATE SET unit = EXCLUDED.unit
       RETURNING id`,
      [`rp2_test_product_${Date.now()}`],
    );
    const productId = product.rows[0]!.id;

    const recipe = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, description, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), 'RP2 Test Dish', 1, 'desc', $1, 'TEST_ONLY')
       RETURNING id`,
      [`rp2_test_${Date.now()}`],
    );
    recipeId = recipe.rows[0]!.id;
    await pool.query(
      `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit) VALUES ($1,$2,100,'g')`,
      [recipeId, productId],
    );
    await pool.query(
      `INSERT INTO "RecipeStep" ("recipeId", "stepIndex", instruction) VALUES ($1,0,'Mix')`,
      [recipeId],
    );

    // Create published version manually (simulate service) if not auto-created.
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM "RecipeVersion" WHERE "recipeId" = $1 LIMIT 1`,
      [recipeId],
    );
    if (existing.rows[0]) {
      versionId = existing.rows[0].id;
    } else {
      const version = await pool.query<{ id: string }>(
        `INSERT INTO "RecipeVersion" (
           "recipeId", "versionNumber", status,
           "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
           "nutritionSnapshotJson", "restrictionSnapshotJson",
           servings, "changeType", "publishedAt", checksum, provenance
         ) VALUES (
           $1, 1, 'PUBLISHED',
           '{"title":"RP2 Test Dish"}'::jsonb,
           '[{"productId":"${productId}","canonicalProductId":"${productId}","displayName":"P","amount":100,"unit":"g","ordering":1}]'::jsonb,
           '[{"stepIndex":0,"instruction":"Mix","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
           '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"per_recipe_servings","source":"test"}'::jsonb,
           '{"allergens":[],"dietaryTags":[]}'::jsonb,
           1, 'MANUAL_PUBLISH', now(), 'abc123checksum', 'OWNER_PUBLISH'
         ) RETURNING id`,
        [recipeId],
      );
      versionId = version.rows[0]!.id;
      await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [recipeId, versionId]);
    }

    const plan = await pool.query<{ id: string }>(
      `INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, 1, true) RETURNING id`,
      [userId],
    );
    planId = plan.rows[0]!.id;
    const day = await pool.query<{ id: string }>(
      `INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, 0) RETURNING id`,
      [planId],
    );
    const meal = await pool.query<{ id: string }>(
      `INSERT INTO "Meal" ("planDayId", name) VALUES ($1, 'RP2 Test Dish') RETURNING id`,
      [day.rows[0]!.id],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO "MealItem" ("mealId", "recipeId", "recipeVersionId", servings, "portionGrams", "contentProvenance")
       VALUES ($1,$2,$3,1,100,'RECIPE_VERSION') RETURNING id`,
      [meal.rows[0]!.id, recipeId, versionId],
    );
    mealItemId = item.rows[0]!.id;
  });

  afterAll(async () => {
    if (planId) await pool.query(`DELETE FROM "Plan" WHERE id = $1`, [planId]);
    if (recipeId) {
      await pool.query(`UPDATE "Recipe" SET "currentVersionId" = NULL WHERE id = $1`, [recipeId]);
      // Cannot delete published version — leave fixtures; remove meal items first.
      await pool.query(
        `DELETE FROM "MealItem" WHERE "recipeId" = $1`,
        [recipeId],
      ).catch(() => undefined);
    }
    if (userId) await pool.query(`DELETE FROM "User" WHERE id = $1`, [userId]).catch(() => undefined);
    await pool.end();
  });

  it('rejects published version UPDATE', async () => {
    await expect(
      pool.query(`UPDATE "RecipeVersion" SET checksum = 'hacked' WHERE id = $1`, [versionId]),
    ).rejects.toThrow(/RECIPE_VERSION_IMMUTABLE/);
  });

  it('rejects published version DELETE', async () => {
    await expect(pool.query(`DELETE FROM "RecipeVersion" WHERE id = $1`, [versionId])).rejects.toThrow(
      /RECIPE_VERSION_IMMUTABLE|RECIPE_VERSION_REFERENCED/,
    );
  });

  it('rejects cross-recipe MealItem mismatch', async () => {
    const other = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings) VALUES (gen_random_uuid(), 'Other', 1) RETURNING id`,
    );
    const otherId = other.rows[0]!.id;
    await expect(
      pool.query(
        `UPDATE "MealItem" SET "recipeId" = $2 WHERE id = $1`,
        [mealItemId, otherId],
      ),
    ).rejects.toThrow(/MEAL_ITEM_RECIPE_VERSION_MISMATCH/);
    await pool.query(`DELETE FROM "Recipe" WHERE id = $1`, [otherId]);
  });

  it('mutable RecipeIngredient edit does not change version snapshot', async () => {
    const before = await pool.query<{ snap: unknown }>(
      `SELECT "ingredientsSnapshotJson" AS snap FROM "RecipeVersion" WHERE id = $1`,
      [versionId],
    );
    await pool.query(
      `UPDATE "RecipeIngredient" SET quantity = quantity + 1 WHERE "recipeId" = $1`,
      [recipeId],
    );
    const after = await pool.query<{ snap: unknown }>(
      `SELECT "ingredientsSnapshotJson" AS snap FROM "RecipeVersion" WHERE id = $1`,
      [versionId],
    );
    expect(JSON.stringify(after.rows[0]?.snap)).toBe(JSON.stringify(before.rows[0]?.snap));
  });

  it('allocates unique versionNumbers', async () => {
    // Draft insert then... drafts are mutable; insert published via new number.
    // Use advisory path: insert version 2 as published.
    const v2 = await pool.query<{ versionNumber: number }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 2, 'PUBLISHED',
         '{"title":"v2"}'::jsonb, '[]'::jsonb, '[]'::jsonb,
         '{"calories":0,"proteinG":0,"fatG":0,"carbsG":0,"basis":"x","source":"x"}'::jsonb,
         '{}'::jsonb, 1, 'CONTENT_UPDATE', now(), 'checksum_v2_unique', 'OWNER_PUBLISH'
       ) RETURNING "versionNumber"`,
      [recipeId],
    );
    expect(v2.rows[0]?.versionNumber).toBe(2);
    await expect(
      pool.query(
        `INSERT INTO "RecipeVersion" (
           "recipeId", "versionNumber", status,
           "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
           "nutritionSnapshotJson", "restrictionSnapshotJson",
           servings, "changeType", "publishedAt", checksum, provenance
         ) VALUES (
           $1, 2, 'PUBLISHED',
           '{"title":"dup"}'::jsonb, '[]'::jsonb, '[]'::jsonb,
           '{"calories":0,"proteinG":0,"fatG":0,"carbsG":0,"basis":"x","source":"x"}'::jsonb,
           '{}'::jsonb, 1, 'CONTENT_UPDATE', now(), 'checksum_dup', 'OWNER_PUBLISH'
         )`,
        [recipeId],
      ),
    ).rejects.toThrow();
  });
});
