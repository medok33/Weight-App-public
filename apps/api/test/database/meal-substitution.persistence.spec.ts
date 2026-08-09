import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { MealDishCatalogRepository } from '../../src/modules/meal-plan/infrastructure/meal-dish-catalog.repository';
import { MealPlanRepository } from '../../src/modules/meal-plan/infrastructure/meal-plan.repository';
import { MealPlanService } from '../../src/modules/meal-plan/application/meal-plan.service';
import { MealSubstitutionService } from '../../src/modules/meal-plan/application/meal-substitution.service';
import { RevisionEngineRepository } from '../../src/modules/revision-engine/infrastructure/revision-engine.repository';
import { RevisionEngineService } from '../../src/modules/revision-engine/application/revision-engine.service';
import { ShoppingListRepository } from '../../src/modules/shopping-list/infrastructure/shopping-list.repository';
import { ShoppingListService } from '../../src/modules/shopping-list/application/shopping-list.service';
import { buildWeeklyPlan } from '../../src/modules/meal-plan/domain/meal-plan.builder';
import { validatePlan } from '../../src/modules/meal-plan/domain/meal-plan.policy';
import {
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../src/modules/product-catalog/application/product-foundation.resolvers';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
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

describe('STEP_093 substitution persistence', () => {
  const db = createDb();
  const catalog = new MealDishCatalogRepository(db);
  const plans = new MealPlanRepository(db);
  const mealPlanService = new MealPlanService(plans, undefined, undefined, catalog);
  const shopping = new ShoppingListService(new ShoppingListRepository(db), mealPlanService, db);
  const revisionRepo = new RevisionEngineRepository(db);
  const revisionService = new RevisionEngineService(revisionRepo, undefined, shopping);
  const nutrition = new ProductNutritionResolver(db);
  const restrictions = new ProductRestrictionResolver(db);
  const substitutionService = new MealSubstitutionService(
    db,
    catalog,
    revisionService,
    undefined,
    undefined,
    nutrition,
    restrictions,
  );

  const userId = randomUUID();
  const otherUserId = randomUUID();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await pool.query('INSERT INTO "User" (id, email) VALUES ($1,$2),($3,$4) ON CONFLICT (id) DO NOTHING', [
      userId,
      `step093-a-${Date.now()}@test.local`,
      otherUserId,
      `step093-b-${Date.now()}@test.local`,
    ]);
    await catalog.ensureCatalog();
    const plan = validatePlan(buildWeeklyPlan(userId, [], { version: 1 }));
    await plans.save(plan);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it(
    'preview does not persist; confirm creates immutable version; IDOR denied',
    async () => {
    const plan = await mealPlanService.getActivePlan(userId);
    const versionBefore = plan.version;

    const itemRow = await pool.query<{ id: string; name: string }>(
      `SELECT mi.id, m.name
       FROM "MealItem" mi
       JOIN "Meal" m ON m.id = mi."mealId"
       JOIN "PlanDay" pd ON pd.id = m."planDayId"
       WHERE pd."planId" = $1 AND m."mealType" = 'lunch'
       LIMIT 1`,
      [plan.planId],
    );
    const mealItemId = itemRow.rows[0]?.id;
    expect(mealItemId).toBeTruthy();

    const list = await substitutionService.listCandidates(userId, mealItemId!, 'REPLACE_DISH');
    expect(list.candidates.length).toBeGreaterThan(0);
    // peanut stays available unless profile has peanut allergen — not blocked by default
    expect(list.candidates.some((c) => c.classification === 'BLOCKED')).toBe(false);

    const pick =
      list.candidates.find((c) => c.name === 'rice_turkey') ??
      list.candidates.find((c) => c.classification === 'EQUIVALENT') ??
      list.candidates[0]!;

    const preview = await substitutionService.preview(userId, mealItemId!, { candidateId: pick.candidateId });
    expect(preview.confirmationToken.length).toBeGreaterThan(10);
    const afterPreview = await mealPlanService.getActivePlan(userId);
    expect(afterPreview.version).toBe(versionBefore);
    expect(afterPreview.planId).toBe(plan.planId);

    const confirm = await revisionService.confirm({
      userId,
      planId: preview.revisionPlanId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: `step093-${Date.now()}`,
    });
    expect(confirm.activeVersion).toBeGreaterThan(versionBefore);

    const active = await mealPlanService.getActivePlan(userId);
    expect(active.version).toBe(confirm.activeVersion);
    expect(active.days.some((d) => d.meals.some((m) => m.name === pick.name))).toBe(true);

    const old = await pool.query('SELECT id FROM "Plan" WHERE id = $1', [plan.planId]);
    expect(old.rowCount).toBe(1);

    await expect(substitutionService.listCandidates(otherUserId, mealItemId!, 'REPLACE_DISH')).rejects.toThrow(
      /FORBIDDEN/,
    );

    const replay = await revisionService.confirm({
      userId,
      planId: preview.revisionPlanId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: confirm.revision.idempotencyKey!,
    });
    expect(replay.idempotentReplay).toBe(true);
  },
  60_000,
  );
});
