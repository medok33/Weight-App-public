import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type QueryResultRow } from 'pg';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { ShoppingListRepository } from '../../src/modules/shopping-list/infrastructure/shopping-list.repository';
import { ShoppingListService } from '../../src/modules/shopping-list/application/shopping-list.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = <T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values);
  return {
    query,
    async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txQuery: SqlQuery = <R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
        client.query<R>(text, values);
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

describe('historical plan + shopping from RecipeVersion snapshots (RP2-02A)', () => {
  const db = createDb();
  const shopping = new ShoppingListService(new ShoppingListRepository(db), undefined, db);

  let userId = '';
  let recipeId = '';
  let productA = '';
  let productB = '';
  let productC = '';
  let version1 = '';
  let version2 = '';
  let planV1 = '';
  let planV2 = '';

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    userId = user.rows[0]!.id;

    const insertProduct = async (name: string) => {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO "Product" (id, "canonicalName", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", "packageSize", "packageUnit")
         VALUES (gen_random_uuid(), $1, $1, 'g', 100, 10, 1, 5, 500, 'g')
         RETURNING id`,
        [name],
      );
      return row.rows[0]!.id;
    };
    productA = await insertProduct(`hist_ing_a_${stamp}`);
    productB = await insertProduct(`hist_ing_b_${stamp}`);
    productC = await insertProduct(`hist_ing_c_${stamp}`);

    const recipe = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 1, $2, 'HISTORICAL_ONLY') RETURNING id`,
      [`Historical Dish ${stamp}`, `hist_dish_${stamp}`],
    );
    recipeId = recipe.rows[0]!.id;
    await pool.query(
      `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit) VALUES ($1,$2,100,'g')`,
      [recipeId, productA],
    );

    const v1 = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "servingWeightGrams", "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 1, 'PUBLISHED',
         '{"title":"v1"}'::jsonb,
         $2::jsonb,
         '[{"stepIndex":0,"instruction":"Cook","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
         '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"per_recipe_servings","source":"test"}'::jsonb,
         '{"allergens":[],"dietaryTags":[]}'::jsonb,
         1, 100, 'LEGACY_BACKFILL', now(), $3, 'OWNER_PUBLISH'
       ) RETURNING id`,
      [
        recipeId,
        JSON.stringify([
          {
            productId: productA,
            canonicalProductId: productA,
            displayName: 'Ingredient A',
            amount: 100,
            unit: 'g',
            ordering: 1,
          },
        ]),
        `hist_v1_${stamp}`,
      ],
    );
    version1 = v1.rows[0]!.id;
    await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [recipeId, version1]);

    const plan1 = await pool.query<{ id: string }>(
      `INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, 1, true) RETURNING id`,
      [userId],
    );
    planV1 = plan1.rows[0]!.id;
    const day1 = await pool.query<{ id: string }>(
      `INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, 0) RETURNING id`,
      [planV1],
    );
    const meal1 = await pool.query<{ id: string }>(
      `INSERT INTO "Meal" ("planDayId", name, "mealType") VALUES ($1, 'Historical Dish', 'lunch') RETURNING id`,
      [day1.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO "MealItem" ("mealId", "recipeId", "recipeVersionId", servings, "portionGrams", "contentProvenance")
       VALUES ($1,$2,$3,1,100,'RECIPE_VERSION')`,
      [meal1.rows[0]!.id, recipeId, version1],
    );

    // Mutable recipe changes to B; publish v2 with B.
    await pool.query(`DELETE FROM "RecipeIngredient" WHERE "recipeId" = $1`, [recipeId]);
    await pool.query(
      `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit) VALUES ($1,$2,120,'g')`,
      [recipeId, productB],
    );
    const v2 = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "servingWeightGrams", "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 2, 'PUBLISHED',
         '{"title":"v2"}'::jsonb,
         $2::jsonb,
         '[{"stepIndex":0,"instruction":"Cook v2","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
         '{"calories":120,"proteinG":12,"fatG":1,"carbsG":6,"basis":"per_recipe_servings","source":"test"}'::jsonb,
         '{"allergens":[],"dietaryTags":[]}'::jsonb,
         1, 120, 'CONTENT_UPDATE', now(), $3, 'OWNER_PUBLISH'
       ) RETURNING id`,
      [
        recipeId,
        JSON.stringify([
          {
            productId: productB,
            canonicalProductId: productB,
            displayName: 'Ingredient B',
            amount: 120,
            unit: 'g',
            ordering: 1,
          },
        ]),
        `hist_v2_${stamp}`,
      ],
    );
    version2 = v2.rows[0]!.id;
    await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [recipeId, version2]);

    const plan2 = await pool.query<{ id: string }>(
      `INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, 2, true) RETURNING id`,
      [userId],
    );
    planV2 = plan2.rows[0]!.id;
    const day2 = await pool.query<{ id: string }>(
      `INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, 0) RETURNING id`,
      [planV2],
    );
    const meal2 = await pool.query<{ id: string }>(
      `INSERT INTO "Meal" ("planDayId", name, "mealType") VALUES ($1, 'Historical Dish', 'lunch') RETURNING id`,
      [day2.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO "MealItem" ("mealId", "recipeId", "recipeVersionId", servings, "portionGrams", "contentProvenance")
       VALUES ($1,$2,$3,1,120,'RECIPE_VERSION')`,
      [meal2.rows[0]!.id, recipeId, version2],
    );
  });

  afterAll(async () => {
    if (userId) {
      await pool.query(
        `DELETE FROM "ShoppingItem" WHERE "shoppingListId" IN (SELECT id FROM "ShoppingList" WHERE "userId" = $1)`,
        [userId],
      );
      await pool.query(`DELETE FROM "ShoppingList" WHERE "userId" = $1`, [userId]);
      await pool.query(`DELETE FROM "Plan" WHERE "userId" = $1`, [userId]);
      await pool.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    }
    await pool.end();
  });

  it('old plan shopping stays on Ingredient A after mutable recipe + v2 publish', async () => {
    const listV1 = await shopping.rebuildFromPlanId(userId, planV1, 1);
    expect(listV1.items.some((item) => item.productId === productA)).toBe(true);
    expect(listV1.items.some((item) => item.productId === productB)).toBe(false);

    // Mutable recipe changes again to C — must not affect old plan shopping.
    await pool.query(`DELETE FROM "RecipeIngredient" WHERE "recipeId" = $1`, [recipeId]);
    await pool.query(
      `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit) VALUES ($1,$2,80,'g')`,
      [recipeId, productC],
    );

    const listV1Again = await shopping.rebuildFromPlanId(userId, planV1, 1);
    expect(listV1Again.items.some((item) => item.productId === productA)).toBe(true);
    expect(listV1Again.items.some((item) => item.productId === productC)).toBe(false);

    const pinned = await pool.query<{ productId: string }>(
      `SELECT (ing->>'productId') AS "productId"
       FROM "MealItem" mi
       JOIN "RecipeVersion" v ON v.id = mi."recipeVersionId",
       LATERAL jsonb_array_elements(v."ingredientsSnapshotJson") AS ing
       WHERE mi."recipeVersionId" = $1
       LIMIT 1`,
      [version1],
    );
    expect(pinned.rows[0]?.productId).toBe(productA);
  });

  it('new plan shopping uses Ingredient B from RecipeVersion v2', async () => {
    const listV2 = await shopping.rebuildFromPlanId(userId, planV2, 2);
    expect(listV2.items.some((item) => item.productId === productB)).toBe(true);
    expect(listV2.items.some((item) => item.productId === productA)).toBe(false);
  });
});
