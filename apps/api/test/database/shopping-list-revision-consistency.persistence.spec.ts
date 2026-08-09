import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type QueryResultRow } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { setShoppingTxFailMode } from '../../src/modules/shopping-list/domain/shopping-tx-fail.hook';
import { buildWeeklyPlan } from '../../src/modules/meal-plan/domain/meal-plan.builder';
import { validatePlan } from '../../src/modules/meal-plan/domain/meal-plan.policy';
import {
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../src/modules/product-catalog/application/product-foundation.resolvers';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
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

async function ensureMigration170() {
  const hasCol = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ShoppingList' AND column_name = 'sourcePlanVersion'
    ) AS exists`,
  );
  if (!hasCol.rows[0]?.exists) {
    await pool.query(
      readFileSync(resolve(process.cwd(), 'prisma/migrations/170_shopping-list-plan-version/migration.sql'), 'utf8'),
    );
  }
}

async function lunchMealItemId(planId: string): Promise<string> {
  const itemRow = await pool.query<{ id: string }>(
    `SELECT mi.id
     FROM "MealItem" mi
     JOIN "Meal" m ON m.id = mi."mealId"
     JOIN "PlanDay" pd ON pd.id = m."planDayId"
     WHERE pd."planId" = $1 AND m."mealType" = 'lunch'
     LIMIT 1`,
    [planId],
  );
  const id = itemRow.rows[0]?.id;
  if (!id) throw new Error('TEST_LUNCH_ITEM_MISSING');
  return id;
}

describe('STEP_093 shopping list ↔ plan revision atomic consistency', () => {
  const db = createDb();
  const catalog = new MealDishCatalogRepository(db);
  const plans = new MealPlanRepository(db);
  const mealPlanService = new MealPlanService(plans, undefined, undefined, catalog);
  const shoppingRepo = new ShoppingListRepository(db);
  const shopping = new ShoppingListService(shoppingRepo, mealPlanService, db);
  const revisionService = new RevisionEngineService(new RevisionEngineRepository(db), undefined, shopping);
  const substitutionService = new MealSubstitutionService(
    db,
    catalog,
    revisionService,
    undefined,
    undefined,
    new ProductNutritionResolver(db),
    new ProductRestrictionResolver(db),
  );

  const userId = randomUUID();
  let baselineListId: string | null = null;
  let baselineItemCount = 0;
  let baselineVersion = 1;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await ensureMigration170();
    await pool.query('INSERT INTO "User" (id, email) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [
      userId,
      `step093-shop-${Date.now()}@test.local`,
    ]);
    await catalog.ensureCatalog();
    const plan = validatePlan(buildWeeklyPlan(userId, [], { version: 1 }));
    await plans.save(plan);
    const list = await shopping.generateFromMealPlan(userId);
    baselineListId = list.id;
    baselineItemCount = list.items.length;
    baselineVersion = list.sourcePlanVersion ?? 1;
    expect(list.generationStatus).toBe('CURRENT');
    expect(list.syncStatus).toBe('current');
  }, 120_000);

  afterEach(() => {
    setShoppingTxFailMode(null);
  });

  afterAll(async () => {
    setShoppingTxFailMode(null);
    await pool.end();
  });

  async function previewDishReplace() {
    const plan = await mealPlanService.getActivePlan(userId);
    const mealItemId = await lunchMealItemId(plan.planId!);
    const list = await substitutionService.listCandidates(userId, mealItemId, 'REPLACE_DISH');
    const pick =
      list.candidates.find((c) => c.name === 'rice_turkey') ??
      list.candidates.find((c) => c.classification === 'EQUIVALENT') ??
      list.candidates[0]!;
    const preview = await substitutionService.preview(userId, mealItemId, { candidateId: pick.candidateId });
    return { plan, pick, preview };
  }

  it('1. failure before shopping list creation rolls back plan + revision; old list intact', async () => {
    const { plan, preview } = await previewDishReplace();
    const beforePlans = await pool.query<{ max: number }>(
      'SELECT COALESCE(MAX(version),0)::int AS max FROM "Plan" WHERE "userId" = $1',
      [userId],
    );
    const beforeRevisions = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "userId" = $1',
      [userId],
    );
    const beforeList = await shopping.getLatest(userId);

    setShoppingTxFailMode('before_list');
    await expect(
      revisionService.confirm({
        userId,
        planId: preview.revisionPlanId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: `fail-before-${Date.now()}`,
      }),
    ).rejects.toThrow(/SHOPPING_TX_INJECTED_FAILURE:before_list/);

    const afterPlans = await pool.query<{ max: number }>(
      'SELECT COALESCE(MAX(version),0)::int AS max FROM "Plan" WHERE "userId" = $1',
      [userId],
    );
    const afterRevisions = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "userId" = $1',
      [userId],
    );
    expect(afterPlans.rows[0]?.max).toBe(beforePlans.rows[0]?.max);
    expect(afterRevisions.rows[0]?.count).toBe(beforeRevisions.rows[0]?.count);

    const active = await mealPlanService.getActivePlan(userId);
    expect(active.planId).toBe(plan.planId);
    expect(active.version).toBe(plan.version);

    const afterList = await shopping.getLatest(userId);
    expect(afterList?.id).toBe(beforeList?.id);
    expect(afterList?.sourcePlanVersion).toBe(beforeList?.sourcePlanVersion);
    expect(afterList?.items.length).toBe(beforeList?.items.length);
    expect(afterList?.generationStatus).toBe('CURRENT');
  });

  it('2. failure mid shopping regeneration leaves no partial list / no version mix', async () => {
    const { preview } = await previewDishReplace();
    const beforePlans = await pool.query<{ max: number }>(
      'SELECT COALESCE(MAX(version),0)::int AS max FROM "Plan" WHERE "userId" = $1',
      [userId],
    );
    const listsBefore = await pool.query<{ id: string; generationStatus: string; sourcePlanVersion: number | null }>(
      `SELECT id, "generationStatus", "sourcePlanVersion" FROM "ShoppingList" WHERE "userId" = $1`,
      [userId],
    );

    setShoppingTxFailMode('mid_items');
    await expect(
      revisionService.confirm({
        userId,
        planId: preview.revisionPlanId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: `fail-mid-${Date.now()}`,
      }),
    ).rejects.toThrow(/SHOPPING_TX_INJECTED_FAILURE:mid_items/);

    const afterPlans = await pool.query<{ max: number }>(
      'SELECT COALESCE(MAX(version),0)::int AS max FROM "Plan" WHERE "userId" = $1',
      [userId],
    );
    expect(afterPlans.rows[0]?.max).toBe(beforePlans.rows[0]?.max);

    const listsAfter = await pool.query<{ id: string; generationStatus: string; sourcePlanVersion: number | null }>(
      `SELECT id, "generationStatus", "sourcePlanVersion" FROM "ShoppingList" WHERE "userId" = $1`,
      [userId],
    );
    expect(listsAfter.rows.map((r) => r.id).sort()).toEqual(listsBefore.rows.map((r) => r.id).sort());

    const current = listsAfter.rows.filter((r) => r.generationStatus === 'CURRENT');
    expect(current).toHaveLength(1);
    expect(current[0]?.sourcePlanVersion).toBe(baselineVersion);

    const neg = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ShoppingItem" si
       JOIN "ShoppingList" sl ON sl.id = si."shoppingListId"
       WHERE sl."userId" = $1 AND si.quantity < 0`,
      [userId],
    );
    expect(neg.rows[0]?.count).toBe('0');
  });

  it('3. successful confirm activates new plan version and CURRENT shopping for that version', async () => {
    const { plan, pick, preview } = await previewDishReplace();
    const confirm = await revisionService.confirm({
      userId,
      planId: preview.revisionPlanId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: `ok-${Date.now()}`,
    });
    expect(confirm.activeVersion).toBeGreaterThan(plan.version);

    const active = await mealPlanService.getActivePlan(userId);
    expect(active.version).toBe(confirm.activeVersion);
    expect(active.days.some((d) => d.meals.some((m) => m.name === pick.name))).toBe(true);

    const list = await shopping.getLatest(userId);
    expect(list?.sourcePlanVersion).toBe(confirm.activeVersion);
    expect(list?.sourcePlanId).toBe(confirm.activePlanId);
    expect(list?.generationStatus).toBe('CURRENT');
    expect(list?.syncStatus).toBe('current');
    expect(list?.items.some((i) => /turkey|rice|индей|рис/i.test(i.name))).toBe(true);
    expect(list?.id).not.toBe(baselineListId);

    const stale = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ShoppingList"
       WHERE "userId" = $1 AND id = $2 AND "generationStatus" = 'STALE'`,
      [userId, baselineListId],
    );
    expect(stale.rows[0]?.count).toBe('1');

    baselineListId = list!.id;
    baselineItemCount = list!.items.length;
    baselineVersion = confirm.activeVersion;
  });

  it('4. idempotent replay keeps one revision, one plan version, one logical shopping list', async () => {
    const { preview } = await previewDishReplace();
    const key = `idem-${Date.now()}`;
    const first = await revisionService.confirm({
      userId,
      planId: preview.revisionPlanId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: key,
    });
    const listAfterFirst = await shopping.getLatest(userId);
    const qtySum = (items: { name: string; quantity: number }[]) =>
      items.reduce((acc, item) => acc + Number(item.quantity), 0);

    const replay = await revisionService.confirm({
      userId,
      planId: preview.revisionPlanId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: key,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.revision.id).toBe(first.revision.id);
    expect(replay.activeVersion).toBe(first.activeVersion);

    const revisions = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "userId" = $1 AND "idempotencyKey" = $2',
      [userId, key],
    );
    expect(revisions.rows[0]?.count).toBe('1');

    const plansAtVersion = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "Plan" WHERE "userId" = $1 AND version = $2',
      [userId, first.activeVersion],
    );
    expect(plansAtVersion.rows[0]?.count).toBe('1');

    const shoppingAtVersion = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ShoppingList"
       WHERE "userId" = $1 AND "sourcePlanVersion" = $2`,
      [userId, first.activeVersion],
    );
    expect(shoppingAtVersion.rows[0]?.count).toBe('1');

    const listAfterReplay = await shopping.getLatest(userId);
    expect(listAfterReplay?.id).toBe(listAfterFirst?.id);
    expect(listAfterReplay?.items.length).toBe(listAfterFirst?.items.length);
    expect(qtySum(listAfterReplay!.items)).toBe(qtySum(listAfterFirst!.items));

    // Same-version rebuild is a no-op (does not double quantities).
    const rebuilt = await shopping.rebuildFromMealDays(
      userId,
      (await mealPlanService.getActivePlan(userId)).days.map((day) => ({
        dayIndex: day.dayIndex,
        meals: day.meals.map((meal) => ({ name: meal.name })),
      })),
      { sourcePlanId: first.activePlanId, sourcePlanVersion: first.activeVersion },
    );
    expect(rebuilt.id).toBe(listAfterFirst?.id);
    expect(qtySum(rebuilt.items)).toBe(qtySum(listAfterFirst!.items));

    baselineListId = listAfterReplay!.id;
    baselineItemCount = listAfterReplay!.items.length;
    baselineVersion = first.activeVersion;
  });

  it(
    '5. concurrent confirmation does not create two CURRENT lists for one plan version',
    async () => {
    const { preview } = await previewDishReplace();
    const keyA = `conc-a-${Date.now()}`;
    const keyB = `conc-b-${Date.now()}`;

    const results = await Promise.allSettled([
      revisionService.confirm({
        userId,
        planId: preview.revisionPlanId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: keyA,
      }),
      revisionService.confirm({
        userId,
        planId: preview.revisionPlanId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: keyB,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winner = (fulfilled[0] as PromiseFulfilledResult<{ activeVersion: number; activePlanId: string }>).value;
    const currentLists = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ShoppingList"
       WHERE "userId" = $1 AND "generationStatus" = 'CURRENT'`,
      [userId],
    );
    expect(currentLists.rows[0]?.count).toBe('1');

    const forVersion = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ShoppingList"
       WHERE "userId" = $1 AND "sourcePlanVersion" = $2`,
      [userId, winner.activeVersion],
    );
    expect(forVersion.rows[0]?.count).toBe('1');

    const list = await shopping.getLatest(userId);
    expect(list?.sourcePlanVersion).toBe(winner.activeVersion);
    expect(list?.syncStatus).toBe('current');
    expect(list?.items.length).toBeGreaterThan(0);
    void baselineItemCount;
  },
  60_000,
  );

  it('6. atomic model restart: data already fully consistent (no outbox recovery needed)', async () => {
    const active = await mealPlanService.getActivePlan(userId);
    const list = await shopping.getLatest(userId);
    expect(list?.sourcePlanVersion).toBe(active.version);
    expect(list?.generationStatus).toBe('CURRENT');
    expect(list?.syncStatus).toBe('current');

    const rebuilding = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ShoppingList"
       WHERE "userId" = $1 AND "generationStatus" IN ('REBUILDING', 'FAILED')`,
      [userId],
    );
    expect(rebuilding.rows[0]?.count).toBe('0');
  });
});
