import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MealPlanRepository } from '../../src/modules/meal-plan/infrastructure/meal-plan.repository';
import { WorkoutEngineRepository } from '../../src/modules/workout-engine/infrastructure/workout-engine.repository';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { buildWeeklyPlan } from '../../src/modules/meal-plan/domain/meal-plan.policy';
import { buildWorkoutPlan } from '../../src/modules/workout-engine/domain/workout-engine.policy';
import { DEFAULT_EXERCISES } from '../../src/modules/workout-engine/domain/workout-engine.mapper';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });
const db = {
  query: <T>(text: string, values: unknown[] = []) => pool.query<T>(text, values),
  async withTransaction<T>(fn: (query: typeof pool.query) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const query = <R>(text: string, values: unknown[] = []) => client.query<R>(text, values);
      const result = await fn(query as typeof pool.query);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
} as PrismaService;
const userId = '11111111-1111-4111-8111-111111111111';
const cabinetRecipes = [
  ['b0920001-0000-4000-8000-000000000005', 'protein_power_bowl'],
  ['b0920001-0000-4000-8000-000000000002', 'greek_yogurt'],
  ['b0930001-0000-4000-8000-000000000001', 'buckwheat_chicken'],
  ['b0920001-0000-4000-8000-000000000001', 'oatmeal_bowl'],
  ['b0920001-0000-4000-8000-000000000004', 'baked_fish'],
] as const;
const recipeVersionIds = new Map<string, string>();

describe('cabinet vertical persistence', () => {
  beforeAll(async () => {
    const exists = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'WorkoutPlan'
      ) AS exists`,
    );
    if (!exists.rows[0]?.exists) {
      const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/094_workout-plan/migration.sql'), 'utf8');
      await pool.query(migration);
    }
    await pool.query('INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [userId, 'cabinet-flow@test.local']);
    for (const [recipeId, recipeKey] of cabinetRecipes) {
      await pool.query(
        `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
         VALUES ($1, $2, 1, $3, 'TEST_ONLY')
         ON CONFLICT (id) DO NOTHING`,
        [recipeId, recipeKey, `cabinet_flow_${recipeKey}`],
      );
      const version = await pool.query<{ id: string }>(
        `INSERT INTO "RecipeVersion" (
           "recipeId", "versionNumber", status,
           "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
           "nutritionSnapshotJson", "restrictionSnapshotJson", servings,
           "changeType", "publishedAt", checksum, provenance
         ) VALUES (
           $1, 1, 'PUBLISHED',
           $2::jsonb, '[]'::jsonb, '[]'::jsonb, $3::jsonb, $4::jsonb,
           1, 'FIXTURE', now(), $5, 'FIXTURE'
         )
         ON CONFLICT ("recipeId", "versionNumber") DO NOTHING
         RETURNING id`,
        [
          recipeId,
          JSON.stringify({ title: recipeKey, source: 'cabinet-flow-test' }),
          JSON.stringify({ calories: 200, proteinG: 10, fatG: 5, carbsG: 20 }),
          JSON.stringify({ allergens: [], dietaryTags: [] }),
          `cabinet_flow_${recipeKey}_v1`,
        ],
      );
      const existingVersion = version.rows[0]
        ? version.rows[0]
        : (await pool.query<{ id: string }>(
            `SELECT id FROM "RecipeVersion" WHERE "recipeId" = $1 AND "versionNumber" = 1`,
            [recipeId],
          )).rows[0];
      const versionId = existingVersion?.id;
      if (!versionId) throw new Error(`missing fixture RecipeVersion for ${recipeKey}`);
      recipeVersionIds.set(recipeId, versionId);
      await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [recipeId, versionId]);
    }
    await pool.query('DELETE FROM "MealItem" WHERE "mealId" IN (SELECT m.id FROM "Meal" m JOIN "PlanDay" pd ON pd.id = m."planDayId" JOIN "Plan" p ON p.id = pd."planId" WHERE p."userId" = $1)', [userId]);
    await pool.query('DELETE FROM "Meal" WHERE "planDayId" IN (SELECT pd.id FROM "PlanDay" pd JOIN "Plan" p ON p.id = pd."planId" WHERE p."userId" = $1)', [userId]);
    await pool.query('DELETE FROM "PlanDay" WHERE "planId" IN (SELECT id FROM "Plan" WHERE "userId" = $1)', [userId]);
    await pool.query('DELETE FROM "Plan" WHERE "userId" = $1', [userId]);
    await pool.query('DELETE FROM "WorkoutPlanDay" WHERE "workoutPlanId" IN (SELECT id FROM "WorkoutPlan" WHERE "userId" = $1)', [userId]);
    await pool.query('DELETE FROM "WorkoutPlan" WHERE "userId" = $1', [userId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it(
    'persists meal and workout plans and reloads them',
    async () => {
    const mealRepository = new MealPlanRepository(db);
    const workoutRepository = new WorkoutEngineRepository(db);
    const mealPlan = buildWeeklyPlan(userId, [
      { id: 'r1', name: 'Oats', calories: 300 },
      { id: 'r2', name: 'Salad', calories: 200 },
    ]);
    for (const day of mealPlan.days) {
      for (const meal of day.meals) {
        if (meal.recipeId) meal.recipeVersionId = recipeVersionIds.get(meal.recipeId);
      }
    }
    await mealRepository.save(mealPlan);
    const reloadedMeal = await mealRepository.findLatestByUserId(userId);
    expect(reloadedMeal?.days).toHaveLength(7);
    expect(reloadedMeal?.days[0]?.meals.length).toBeGreaterThanOrEqual(4);

    const workoutPlan = buildWorkoutPlan(DEFAULT_EXERCISES.slice(0, 2));
    await workoutRepository.save(userId, 1, workoutPlan);
    const reloadedWorkout = await workoutRepository.findLatestByUserId(userId);
    expect(reloadedWorkout?.plan.days).toHaveLength(2);
  },
  30_000,
  );
});
