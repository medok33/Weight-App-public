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

describe('personal customization shopping isolation (RP2-02A)', () => {
  const db = createDb();
  const shopping = new ShoppingListService(new ShoppingListRepository(db), undefined, db);

  let userA = '';
  let userB = '';
  let recipeId = '';
  let productA = '';
  let productB = '';
  let versionId = '';
  let planOriginal = '';
  let planCustom = '';

  beforeAll(async () => {
    const stamp = Date.now();
    const u1 = await pool.query<{ id: string }>(`INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`);
    const u2 = await pool.query<{ id: string }>(`INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`);
    userA = u1.rows[0]!.id;
    userB = u2.rows[0]!.id;

    const pA = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", "packageSize")
       VALUES (gen_random_uuid(), $1, $1, 'g', 100, 10, 1, 5, 500) RETURNING id`,
      [`cust_a_${stamp}`],
    );
    const pB = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", "packageSize")
       VALUES (gen_random_uuid(), $1, $1, 'g', 90, 9, 1, 4, 500) RETURNING id`,
      [`cust_b_${stamp}`],
    );
    productA = pA.rows[0]!.id;
    productB = pB.rows[0]!.id;

    const recipe = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass") VALUES (gen_random_uuid(), $1, 1, $2, 'TEST_ONLY') RETURNING id`,
      [`Cust Dish ${stamp}`, `cust_dish_${stamp}`],
    );
    recipeId = recipe.rows[0]!.id;
    await pool.query(
      `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit) VALUES ($1,$2,100,'g')`,
      [recipeId, productA],
    );

    const version = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "servingWeightGrams", "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 1, 'PUBLISHED',
         '{"title":"base"}'::jsonb,
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
            displayName: 'Product A',
            amount: 100,
            unit: 'g',
            ordering: 1,
          },
        ]),
        `cust_v1_${stamp}`,
      ],
    );
    versionId = version.rows[0]!.id;
    await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [recipeId, versionId]);

    async function seedPlan(userId: string, version: number, customization: unknown | null) {
      const plan = await pool.query<{ id: string }>(
        `INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, $2, true) RETURNING id`,
        [userId, version],
      );
      const day = await pool.query<{ id: string }>(
        `INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, 0) RETURNING id`,
        [plan.rows[0]!.id],
      );
      const meal = await pool.query<{ id: string }>(
        `INSERT INTO "Meal" ("planDayId", name, "mealType") VALUES ($1, 'Cust Dish', 'lunch') RETURNING id`,
        [day.rows[0]!.id],
      );
      await pool.query(
        `INSERT INTO "MealItem" (
           "mealId", "recipeId", "recipeVersionId", servings, "portionGrams",
           "contentProvenance", "customizationSnapshotJson"
         ) VALUES ($1,$2,$3,1,100,$4,$5::jsonb)`,
        [
          meal.rows[0]!.id,
          recipeId,
          versionId,
          customization ? 'MEAL_ITEM_CUSTOMIZATION' : 'RECIPE_VERSION',
          customization ? JSON.stringify(customization) : null,
        ],
      );
      return plan.rows[0]!.id;
    }

    planOriginal = await seedPlan(userA, 1, null);
    planCustom = await seedPlan(userA, 2, {
      ingredients: [
        {
          productId: productB,
          canonicalProductId: productB,
          displayName: 'Product B',
          amount: 100,
          unit: 'g',
          ordering: 1,
        },
      ],
      replacedFromProductId: productA,
      replacedToProductId: productB,
    });
    await seedPlan(userB, 1, null);
  });

  afterAll(async () => {
    for (const userId of [userA, userB]) {
      if (!userId) continue;
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

  it('customization overlay replaces Product A→B without mutating canonical RecipeVersion', async () => {
    const before = await pool.query<{ snap: unknown }>(
      `SELECT "ingredientsSnapshotJson" AS snap FROM "RecipeVersion" WHERE id = $1`,
      [versionId],
    );
    const listCustom = await shopping.rebuildFromPlanId(userA, planCustom, 2);
    expect(listCustom.items.some((item) => item.productId === productB)).toBe(true);
    expect(listCustom.items.some((item) => item.productId === productA)).toBe(false);

    const after = await pool.query<{ snap: unknown }>(
      `SELECT "ingredientsSnapshotJson" AS snap FROM "RecipeVersion" WHERE id = $1`,
      [versionId],
    );
    expect(JSON.stringify(after.rows[0]?.snap)).toBe(JSON.stringify(before.rows[0]?.snap));
    const snapProducts = (before.rows[0]?.snap as Array<{ productId: string }>) ?? [];
    expect(snapProducts[0]?.productId).toBe(productA);
  });

  it('original plan version shopping still contains Product A', async () => {
    const listOriginal = await shopping.rebuildFromPlanId(userA, planOriginal, 1);
    expect(listOriginal.items.some((item) => item.productId === productA)).toBe(true);
    expect(listOriginal.items.some((item) => item.productId === productB)).toBe(false);
  });

  it('other user without customization sees Product A', async () => {
    const otherPlan = await pool.query<{ id: string; version: string }>(
      `SELECT id, version::text AS version FROM "Plan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1`,
      [userB],
    );
    const list = await shopping.rebuildFromPlanId(userB, otherPlan.rows[0]!.id, Number(otherPlan.rows[0]!.version));
    expect(list.items.some((item) => item.productId === productA)).toBe(true);
    expect(list.items.some((item) => item.productId === productB)).toBe(false);
  });

  it('replay rebuild for same plan version does not duplicate quantities', async () => {
    const first = await shopping.rebuildFromPlanId(userA, planCustom, 2);
    const qty = first.items.reduce((sum, item) => sum + Number(item.quantity), 0);
    const second = await shopping.rebuildFromPlanId(userA, planCustom, 2);
    const qty2 = second.items.reduce((sum, item) => sum + Number(item.quantity), 0);
    expect(second.id).toBe(first.id);
    expect(qty2).toBe(qty);
    expect(second.items.length).toBe(first.items.length);
  });
});
