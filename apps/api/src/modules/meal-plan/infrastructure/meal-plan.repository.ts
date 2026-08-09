import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { MealPlan } from '../domain/meal-plan.types';

type PlanDayRow = {
  dayId: string;
  dayIndex: number;
  mealId: string;
  mealName: string;
  recipeId: string | null;
  mealType: string | null;
  plannedTime: string | null;
  mealItemId: string | null;
  portionGrams: string | null;
};

@Injectable()
export class MealPlanRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async save(plan: MealPlan): Promise<MealPlan> {
    const planResult = await this.db.query<{ id: string }>(
      'INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, $2, true) RETURNING id',
      [plan.userId, plan.version],
    );
    const planId = planResult.rows[0]?.id;
    if (!planId) throw new Error('MEAL_PLAN_SAVE_FAILED');

    const days: MealPlan['days'] = [];
    for (const day of plan.days) {
      const dayResult = await this.db.query<{ id: string }>(
        'INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, $2) RETURNING id',
        [planId, day.dayIndex],
      );
      const dayId = dayResult.rows[0]?.id;
      if (!dayId) throw new Error('MEAL_PLAN_DAY_SAVE_FAILED');

      const meals: MealPlan['days'][number]['meals'] = [];
      for (const meal of day.meals) {
        const mealResult = await this.db.query<{ id: string }>(
          `INSERT INTO "Meal" ("planDayId", name, "mealType", "plannedTime")
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [dayId, meal.name, meal.mealType ?? null, meal.plannedTime ?? null],
        );
        const mealId = mealResult.rows[0]?.id;
        if (!mealId) throw new Error('MEAL_PLAN_MEAL_SAVE_FAILED');
        meals.push({
          id: mealId,
          name: meal.name,
          recipeId: meal.recipeId,
          mealType: meal.mealType,
          plannedTime: meal.plannedTime,
          portionGrams: meal.portionGrams,
        });

        if (meal.recipeId && /^[0-9a-f-]{36}$/i.test(meal.recipeId)) {
          let recipeVersionId = meal.recipeVersionId;
          if (!recipeVersionId) {
            const current = await this.db.query<{ id: string }>(
              `SELECT COALESCE(r."currentVersionId", (
                 SELECT v.id FROM "RecipeVersion" v
                 WHERE v."recipeId" = r.id AND v."publishedAt" IS NOT NULL
                 ORDER BY v."versionNumber" DESC LIMIT 1
               )) AS id
               FROM "Recipe" r WHERE r.id = $1`,
              [meal.recipeId],
            );
            recipeVersionId = current.rows[0]?.id;
          }
          if (!recipeVersionId) {
            throw new Error('MEAL_ITEM_RECIPE_VERSION_REQUIRED');
          }
          await this.db.query(
            `INSERT INTO "MealItem" (
               "mealId", "recipeId", "recipeVersionId", servings, "portionGrams",
               "contentProvenance", "customizationSnapshotJson"
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
              mealId,
              meal.recipeId,
              recipeVersionId,
              meal.servings ?? 1,
              meal.portionGrams ?? null,
              meal.contentProvenance ?? 'RECIPE_VERSION',
              meal.customizationSnapshotJson != null
                ? JSON.stringify(meal.customizationSnapshotJson)
                : null,
            ],
          );
        }
      }
      days.push({ dayIndex: day.dayIndex, dayId, meals });
    }

    return { ...plan, planId, days };
  }

  async findLatestByUserId(userId: string): Promise<MealPlan | null> {
    const planResult = await this.db.query<{ id: string; version: number }>(
      'SELECT id, version FROM "Plan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1',
      [userId],
    );
    const planRow = planResult.rows[0];
    if (!planRow) return null;
    return this.findByIdForUser(userId, planRow.id);
  }

  async findByIdForUser(userId: string, planId: string): Promise<MealPlan | null> {
    const planResult = await this.db.query<{ id: string; version: number }>(
      'SELECT id, version FROM "Plan" WHERE id = $1 AND "userId" = $2',
      [planId, userId],
    );
    const planRow = planResult.rows[0];
    if (!planRow) return null;

    const dayRows = await this.db.query<PlanDayRow>(
      `SELECT
         pd.id AS "dayId",
         pd."dayIndex",
         m.id AS "mealId",
         m.name AS "mealName",
         m."mealType",
         m."plannedTime",
         mi."recipeId",
         mi.id AS "mealItemId",
         mi."portionGrams"::text AS "portionGrams"
       FROM "PlanDay" pd
       JOIN "Meal" m ON m."planDayId" = pd.id
       LEFT JOIN "MealItem" mi ON mi."mealId" = m.id
       WHERE pd."planId" = $1
       ORDER BY pd."dayIndex", m."plannedTime" NULLS LAST, m.name`,
      [planRow.id],
    );

    const grouped = new Map<number, { dayId: string; meals: PlanDayRow[] }>();
    for (const row of dayRows.rows) {
      const bucket = grouped.get(row.dayIndex) ?? { dayId: row.dayId, meals: [] };
      bucket.meals.push(row);
      grouped.set(row.dayIndex, bucket);
    }

    return {
      userId,
      version: planRow.version,
      planId: planRow.id,
      days: [...grouped.entries()]
        .sort(([left], [right]) => left - right)
        .map(([dayIndex, bucket]) => ({
          dayIndex,
          dayId: bucket.dayId,
          meals: bucket.meals.map((meal) => ({
            id: meal.mealId,
            name: meal.mealName,
            recipeId: meal.recipeId ?? undefined,
            mealType: meal.mealType ?? undefined,
            plannedTime: meal.plannedTime ?? undefined,
            portionGrams: meal.portionGrams != null ? Number(meal.portionGrams) : undefined,
          })),
        })),
    };
  }

  async findMealOwnership(mealId: string): Promise<{ userId: string; planId: string; dayIndex: number; mealName: string } | null> {
    const result = await this.db.query<{ userId: string; planId: string; dayIndex: number; mealName: string }>(
      `SELECT p."userId", p.id AS "planId", pd."dayIndex", m.name AS "mealName"
       FROM "Meal" m
       JOIN "PlanDay" pd ON pd.id = m."planDayId"
       JOIN "Plan" p ON p.id = pd."planId"
       WHERE m.id = $1`,
      [mealId],
    );
    return result.rows[0] ?? null;
  }

  async all(userId: string): Promise<MealPlan[]> {
    const plans = await this.db.query<{ id: string }>(
      'SELECT id FROM "Plan" WHERE "userId" = $1 ORDER BY version',
      [userId],
    );
    const result: MealPlan[] = [];
    for (const row of plans.rows) {
      const plan = await this.findByIdForUser(userId, row.id);
      if (plan) result.push(plan);
    }
    return result;
  }
}
