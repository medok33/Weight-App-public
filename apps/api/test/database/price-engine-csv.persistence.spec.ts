import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { PriceIntelligenceRepository } from '../../src/modules/price-intelligence/infrastructure/price-intelligence.repository';
import { PriceIntelligenceEngine } from '../../src/modules/price-intelligence/application/price-intelligence.engine';
import { ShoppingListService } from '../../src/modules/shopping-list/application/shopping-list.service';
import { ShoppingListRepository } from '../../src/modules/shopping-list/infrastructure/shopping-list.repository';

describe('price intelligence CSV → shopping → dashboard cost', () => {
  it('syncs catalog CSV into Product + PriceObservation and surfaces on shopping list', async () => {
    for (const file of ['139_price-observation-sources', '140_retailer-type-key', '141_price-intelligence-engine']) {
      const sql = readFileSync(resolve(process.cwd(), `prisma/migrations/${file}/migration.sql`), 'utf8');
      const db = new PrismaService();
      await db.onModuleInit();
      await db.query(sql);
      await db.onModuleDestroy();
    }

    const db = new PrismaService();
    await db.onModuleInit();
    const priceRepo = new PriceIntelligenceRepository(db);
    const engine = new PriceIntelligenceEngine(priceRepo);

    const sync = await engine.syncCsvCatalog(
      'product_key,name,category,weight,price,retailer,retailer_code\nchicken_breast,Куриная грудка,protein,500g,299,Магнит,MAGNIT\noats,Овсянка,grains,500g,95,Магнит,MAGNIT',
      { sourceName: 'Импорт CSV' },
    );
    expect(sync.sourceType).toBe('CSV');
    expect(sync.pricesImported).toBe(2);

    const product = await db.query<{ id: string; productKey: string | null; name: string | null }>(
      'SELECT id, "productKey", name FROM "Product" WHERE "productKey" = $1 OR "canonicalName" = $1',
      ['chicken_breast'],
    );
    expect(product.rows[0]?.productKey ?? product.rows[0]?.id).toBeTruthy();

    const quote = await priceRepo.latestForProduct(product.rows[0]!.id);
    expect(quote?.price).toBe(299);
    expect(quote?.sourceType).toBe('CSV');
    expect(quote?.retailerCode).toBe('MAGNIT');

    const user = await db.query<{ id: string }>(
      `INSERT INTO "User" (id, email) VALUES (gen_random_uuid(), $1) RETURNING id`,
      [`price-engine-csv-${Date.now()}@test.local`],
    );
    const userId = user.rows[0]!.id;

    const shoppingRepo = new ShoppingListRepository(db);
    const stamp = Date.now() % 1_000_000_000;
    const plan = await db.query<{ id: string }>(
      `INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, $2, true) RETURNING id`,
      [userId, stamp],
    );
    const day = await db.query<{ id: string }>(
      `INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, 0) RETURNING id`,
      [plan.rows[0]!.id],
    );
    const meal = await db.query<{ id: string }>(
      `INSERT INTO "Meal" ("planDayId", name, "mealType") VALUES ($1, 'CSV priced meal', 'lunch') RETURNING id`,
      [day.rows[0]!.id],
    );
    const recipe = await db.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 1, $2, 'TEST_ONLY') RETURNING id`,
      [`csv_price_dish_${stamp}`, `csv_price_dish_${stamp}`],
    );
    const version = await db.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "servingWeightGrams", "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 1, 'PUBLISHED',
         '{"title":"csv"}'::jsonb,
         $2::jsonb,
         '[{"stepIndex":0,"instruction":"Cook","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
         '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"per_recipe_servings","source":"test"}'::jsonb,
         '{"allergens":[],"dietaryTags":[]}'::jsonb,
         1, 100, 'LEGACY_BACKFILL', now(), $3, 'OWNER_PUBLISH'
       ) RETURNING id`,
      [
        recipe.rows[0]!.id,
        JSON.stringify([
          {
            productId: product.rows[0]!.id,
            canonicalProductId: product.rows[0]!.id,
            displayName: 'Куриная грудка',
            amount: 200,
            unit: 'g',
            ordering: 1,
          },
        ]),
        `csv_price_v1_${stamp}`,
      ],
    );
    await db.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [
      recipe.rows[0]!.id,
      version.rows[0]!.id,
    ]);
    await db.query(
      `INSERT INTO "MealItem" ("mealId", "recipeId", "recipeVersionId", servings, "portionGrams", "contentProvenance")
       VALUES ($1,$2,$3,1,200,'RECIPE_VERSION')`,
      [meal.rows[0]!.id, recipe.rows[0]!.id, version.rows[0]!.id],
    );

    const mealPlanStub = {
      async getActivePlan() {
        return {
          userId: userId!,
          planId: plan.rows[0]!.id,
          version: stamp,
          personalized: true,
          days: [{ dayIndex: 0, meals: [{ name: 'CSV priced meal' }] }],
        };
      },
    };
    const shopping = new ShoppingListService(shoppingRepo, mealPlanStub as never, db);
    const list = await shopping.generateFromMealPlan(userId!);
    expect(list.items.length).toBeGreaterThan(0);
    const chicken = list.items.find(
      (item) => item.name === 'chicken_breast' || item.productId === product.rows[0]!.id || /курин/i.test(item.name),
    );
    expect(chicken).toBeTruthy();
    const withSource = list.items.find((item) => item.priceSourceName);
    expect(withSource?.priceSourceName).toBeTruthy();

    const budget = await shopping.getBudget(userId!);
    expect(budget.weekCost).toBeGreaterThan(0);
    expect(budget.currency).toBe('RUB');

    await db.onModuleDestroy();
  }, 60_000);
});
