import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type {
  CreatePlanRevisionInput,
  PlanKind,
  PlanRevision,
  RevisionSnapshot,
  RevisionStatus,
} from '../domain/revision-engine.types';
import type { RevisionEngineRepositoryPort } from './revision-engine.repository.port';

type PlanRevisionRow = {
  id: string;
  userId: string;
  planId: string;
  planKind: PlanKind;
  version: number;
  reason: string;
  status: RevisionStatus;
  snapshot: RevisionSnapshot;
  idempotencyKey: string | null;
  requestHash: string | null;
  createdAt: Date;
};

@Injectable()
export class RevisionEngineRepository implements RevisionEngineRepositoryPort {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async create(input: CreatePlanRevisionInput): Promise<PlanRevision> {
    if (input.status !== 'confirmed') throw new Error('REVISION_CONFIRMATION_REQUIRED');
    try {
      return await this.db.withTransaction(async (query) => this.createInTransaction(query, input));
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('REVISION_VERSION_CONFLICT');
      throw error;
    }
  }

  async createInTransaction(query: SqlQuery, input: CreatePlanRevisionInput): Promise<PlanRevision> {
    if (input.status !== 'confirmed') throw new Error('REVISION_CONFIRMATION_REQUIRED');
    await this.assertPlanOwnership(query, input.userId, input.planId, input.planKind);
    await query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      `${input.userId}:${input.planKind}`,
      input.planId,
    ]);

    const versionResult = await query<{ nextVersion: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS "nextVersion"
       FROM "PlanRevision"
       WHERE "planId" = $1 AND "planKind" = $2`,
      [input.planId, input.planKind],
    );
    const version = input.version > 0 ? input.version : versionResult.rows[0]?.nextVersion ?? 1;

    const insertResult = await query<PlanRevisionRow>(
      `INSERT INTO "PlanRevision"
        ("userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING id, "userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash", "createdAt"`,
      [
        input.userId,
        input.planId,
        input.planKind,
        version,
        input.reason,
        input.status,
        JSON.stringify(input.snapshot),
        input.idempotencyKey ?? null,
        input.requestHash ?? null,
      ],
    );
    const row = insertResult.rows[0];
    if (!row) throw new Error('REVISION_SAVE_FAILED');
    return mapRow(row);
  }

  async findByIdempotency(userId: string, idempotencyKey: string): Promise<PlanRevision | null> {
    const result = await this.db.query<PlanRevisionRow>(
      `SELECT id, "userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash", "createdAt"
       FROM "PlanRevision"
       WHERE "userId" = $1 AND "idempotencyKey" = $2`,
      [userId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByIdempotencyInTransaction(
    query: SqlQuery,
    userId: string,
    idempotencyKey: string,
  ): Promise<PlanRevision | null> {
    const result = await query<PlanRevisionRow>(
      `SELECT id, "userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash", "createdAt"
       FROM "PlanRevision"
       WHERE "userId" = $1 AND "idempotencyKey" = $2`,
      [userId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findById(userId: string, revisionId: string): Promise<PlanRevision | null> {
    const result = await this.db.query<PlanRevisionRow>(
      `SELECT id, "userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash", "createdAt"
       FROM "PlanRevision"
       WHERE id = $1 AND "userId" = $2`,
      [revisionId, userId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async listByPlan(userId: string, planId: string, planKind: PlanKind): Promise<PlanRevision[]> {
    const result = await this.db.query<PlanRevisionRow>(
      `SELECT id, "userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash", "createdAt"
       FROM "PlanRevision"
       WHERE "userId" = $1 AND "planId" = $2 AND "planKind" = $3
       ORDER BY version ASC`,
      [userId, planId, planKind],
    );
    return result.rows.map(mapRow);
  }

  async findLatestByPlan(userId: string, planId: string, planKind: PlanKind): Promise<PlanRevision | null> {
    const result = await this.db.query<PlanRevisionRow>(
      `SELECT id, "userId", "planId", "planKind", version, reason, status, snapshot, "idempotencyKey", "requestHash", "createdAt"
       FROM "PlanRevision"
       WHERE "userId" = $1 AND "planId" = $2 AND "planKind" = $3
       ORDER BY version DESC
       LIMIT 1`,
      [userId, planId, planKind],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async loadMealPlan(userId: string, planId: string) {
    const planResult = await this.db.query<{ id: string; version: number; userId: string }>(
      'SELECT id, version, "userId" FROM "Plan" WHERE id = $1',
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan || plan.userId !== userId) return null;
    const dayRows = await this.db.query<{
      dayIndex: number;
      mealName: string;
      recipeId: string | null;
      recipeVersionId: string | null;
      mealItemId: string | null;
      mealType: string | null;
      plannedTime: string | null;
      portionGrams: string | null;
      customizationSnapshotJson: unknown;
      contentProvenance: string | null;
    }>(
      `SELECT pd."dayIndex", m.name AS "mealName", mi."recipeId", mi."recipeVersionId",
              mi.id AS "mealItemId", m."mealType", m."plannedTime",
              mi."portionGrams"::text AS "portionGrams",
              mi."customizationSnapshotJson",
              mi."contentProvenance"
       FROM "PlanDay" pd
       JOIN "Meal" m ON m."planDayId" = pd.id
       LEFT JOIN "MealItem" mi ON mi."mealId" = m.id
       WHERE pd."planId" = $1
       ORDER BY pd."dayIndex", m."plannedTime" NULLS LAST, m.name`,
      [planId],
    );
    const grouped = new Map<
      number,
      {
        name: string;
        recipeId?: string;
        recipeVersionId?: string;
        mealItemId?: string;
        mealType?: string;
        plannedTime?: string;
        portionGrams?: number;
        customizationSnapshotJson?: unknown;
        contentProvenance?: string;
      }[]
    >();
    for (const row of dayRows.rows) {
      const bucket = grouped.get(row.dayIndex) ?? [];
      bucket.push({
        name: row.mealName,
        recipeId: row.recipeId ?? undefined,
        recipeVersionId: row.recipeVersionId ?? undefined,
        mealItemId: row.mealItemId ?? undefined,
        mealType: row.mealType ?? undefined,
        plannedTime: row.plannedTime ?? undefined,
        portionGrams: row.portionGrams != null ? Number(row.portionGrams) : undefined,
        customizationSnapshotJson: row.customizationSnapshotJson ?? undefined,
        contentProvenance: row.contentProvenance ?? undefined,
      });
      grouped.set(row.dayIndex, bucket);
    }
    return {
      planId: plan.id,
      version: plan.version,
      days: [...grouped.entries()]
        .sort(([a], [b]) => a - b)
        .map(([dayIndex, meals]) => ({ dayIndex, meals })),
    };
  }

  async loadWorkoutPlan(userId: string, planId: string) {
    const planResult = await this.db.query<{ id: string; version: number; userId: string }>(
      'SELECT id, version, "userId" FROM "WorkoutPlan" WHERE id = $1',
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan || plan.userId !== userId) return null;
    const dayRows = await this.db.query<{ dayIndex: number; exerciseName: string; riskLevel: string }>(
      `SELECT "dayIndex", "exerciseName", "riskLevel"
       FROM "WorkoutPlanDay"
       WHERE "workoutPlanId" = $1
       ORDER BY "dayIndex"`,
      [planId],
    );
    return {
      planId: plan.id,
      version: plan.version,
      days: dayRows.rows.map((row) => ({
        dayIndex: row.dayIndex,
        exercises: [{ name: row.exerciseName, riskLevel: row.riskLevel as 'low' | 'medium' | 'high' }],
      })),
    };
  }

  async findActivePlanMeta(
    query: SqlQuery,
    userId: string,
    planKind: PlanKind,
  ): Promise<{ id: string; version: number } | null> {
    const table = planKind === 'meal' ? 'Plan' : 'WorkoutPlan';
    const result = await query<{ id: string; version: number }>(
      `SELECT id, version FROM "${table}" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async nextPlanVersion(query: SqlQuery, userId: string, planKind: PlanKind): Promise<number> {
    const table = planKind === 'meal' ? 'Plan' : 'WorkoutPlan';
    const result = await query<{ nextVersion: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS "nextVersion" FROM "${table}" WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0]?.nextVersion ?? 1;
  }

  async applyMealSnapshot(
    query: SqlQuery,
    userId: string,
    version: number,
    days: {
      dayIndex: number;
      meals: {
        name: string;
        recipeId?: string;
        recipeVersionId?: string;
        mealType?: string;
        plannedTime?: string;
        portionGrams?: number;
        customizationSnapshotJson?: unknown;
        contentProvenance?: string;
      }[];
    }[],
  ): Promise<string> {
    const planResult = await query<{ id: string }>(
      'INSERT INTO "Plan" ("userId", version, immutable) VALUES ($1, $2, true) RETURNING id',
      [userId, version],
    );
    const planId = planResult.rows[0]?.id;
    if (!planId) throw new Error('REVISION_APPLY_FAILED');
    for (const day of days) {
      const dayResult = await query<{ id: string }>(
        'INSERT INTO "PlanDay" ("planId", "dayIndex") VALUES ($1, $2) RETURNING id',
        [planId, day.dayIndex],
      );
      const dayId = dayResult.rows[0]?.id;
      if (!dayId) throw new Error('REVISION_APPLY_FAILED');
      for (const meal of day.meals) {
        const mealResult = await query<{ id: string }>(
          `INSERT INTO "Meal" ("planDayId", name, "mealType", "plannedTime")
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [dayId, meal.name, meal.mealType ?? null, meal.plannedTime ?? null],
        );
        const mealId = mealResult.rows[0]?.id;
        if (!mealId) throw new Error('REVISION_APPLY_FAILED');
        if (meal.recipeId && /^[0-9a-f-]{36}$/i.test(meal.recipeId)) {
          let recipeVersionId = meal.recipeVersionId;
          if (!recipeVersionId) {
            const current = await query<{ id: string }>(
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
          if (!recipeVersionId) throw new Error('MEAL_ITEM_RECIPE_VERSION_REQUIRED');
          await query(
            `INSERT INTO "MealItem" (
               "mealId", "recipeId", "recipeVersionId", servings, "portionGrams",
               "contentProvenance", "customizationSnapshotJson"
             )
             VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb)`,
            [
              mealId,
              meal.recipeId,
              recipeVersionId,
              meal.portionGrams ?? null,
              meal.contentProvenance ?? 'RECIPE_VERSION',
              meal.customizationSnapshotJson != null
                ? JSON.stringify(meal.customizationSnapshotJson)
                : null,
            ],
          );
        }
      }
    }
    return planId;
  }

  async applyWorkoutSnapshot(
    query: SqlQuery,
    userId: string,
    version: number,
    days: { dayIndex: number; exercises: { name: string; riskLevel: string }[] }[],
  ): Promise<string> {
    const planResult = await query<{ id: string }>(
      'INSERT INTO "WorkoutPlan" ("userId", version) VALUES ($1, $2) RETURNING id',
      [userId, version],
    );
    const planId = planResult.rows[0]?.id;
    if (!planId) throw new Error('REVISION_APPLY_FAILED');
    for (const day of days) {
      const exercise = day.exercises[0];
      if (!exercise) continue;
      await query(
        'INSERT INTO "WorkoutPlanDay" ("workoutPlanId", "dayIndex", "exerciseName", "riskLevel") VALUES ($1, $2, $3, $4)',
        [planId, day.dayIndex, exercise.name, exercise.riskLevel],
      );
    }
    return planId;
  }

  withTransaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    return this.db.withTransaction(fn);
  }

  private async assertPlanOwnership(
    query: SqlQuery,
    userId: string,
    planId: string,
    planKind: PlanKind,
  ): Promise<void> {
    const table = planKind === 'meal' ? 'Plan' : 'WorkoutPlan';
    const result = await query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM "${table}" WHERE id = $1 AND "userId" = $2) AS ok`,
      [planId, userId],
    );
    if (!result.rows[0]?.ok) throw new Error('REVISION_PLAN_FORBIDDEN');
  }
}

function mapRow(row: PlanRevisionRow): PlanRevision {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    planKind: row.planKind,
    version: row.version,
    reason: row.reason,
    status: row.status,
    snapshot: row.snapshot,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export { isUniqueViolation };
