import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { MealDishCatalogRepository } from '../../src/modules/meal-plan/infrastructure/meal-dish-catalog.repository';
import { MealDishDetailService } from '../../src/modules/meal-plan/application/meal-dish-detail.service';
import { MealPlanRepository } from '../../src/modules/meal-plan/infrastructure/meal-plan.repository';
import { buildWeeklyPlan } from '../../src/modules/meal-plan/domain/meal-plan.builder';
import { validatePlan } from '../../src/modules/meal-plan/domain/meal-plan.policy';
import {
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../src/modules/product-catalog/application/product-foundation.resolvers';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });
const userA = 'a092a092-a092-4a92-8a92-a092a092a092';
const userB = 'b092b092-b092-4b92-8b92-b092b092b092';

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return { query, withTransaction: async (fn) => fn(query) } as PrismaService;
}

describe('STEP_092 meal dish detail persistence', () => {
  const db = createDb();
  const catalog = new MealDishCatalogRepository(db);
  const plans = new MealPlanRepository(db);
  const nutrition = new ProductNutritionResolver(db);
  const restrictions = new ProductRestrictionResolver(db);
  const details = new MealDishDetailService(db, catalog, nutrition, restrictions);

  beforeAll(async () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/169_meal-dish-detail/migration.sql'), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO "User" (id, email) VALUES ($1,$2),($3,$4) ON CONFLICT (id) DO NOTHING', [
      userA,
      'step092-a@test.local',
      userB,
      'step092-b@test.local',
    ]);
    await catalog.ensureCatalog();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('persists structured plan and returns day/item details with ownership', async () => {
    const version = Date.now() % 100000;
    const plan = await plans.save(validatePlan(buildWeeklyPlan(userA, [], { version })));
    expect(plan.days[0]?.meals.length).toBeGreaterThanOrEqual(4);

    const day = await details.getDayDetail(userA, 0, {
      targetKcal: 2500,
      proteinG: 120,
      fatG: 80,
      carbsG: 280,
      tdeeKcal: 2700,
      bmrKcal: 1700,
    });
    expect(day.items.length).toBeGreaterThanOrEqual(4);
    expect(day.items[0]?.substitutionReady.ingredientProductIds.length).toBeGreaterThan(0);

    const itemId = day.items.find((item) => item.dishName.includes('oatmeal') || item.recipeId)?.mealItemId
      ?? day.items[0].mealItemId;
    const detail = await details.getItemDetails(userA, itemId, {
      targetKcal: 2500,
      proteinG: 120,
      fatG: 80,
      carbsG: 280,
      tdeeKcal: 2700,
      bmrKcal: 1700,
    });
    expect(detail.steps.length).toBeGreaterThan(0);
    expect(detail.ingredients.length).toBeGreaterThan(0);
    expect(detail.calories).toBeGreaterThan(0);
    expect(['confirmed', 'partial', 'missing']).toContain(detail.cost.status);

    await expect(details.getItemDetails(userB, itemId, null)).rejects.toThrow('MEAL_PLAN_ITEM_FORBIDDEN');
  });
});
