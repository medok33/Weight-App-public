import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  CatalogExercise,
  MovementPattern,
  RiskLevel,
  TrainingLevel,
  WorkoutPlanDetail,
  WorkoutPlanSaveMeta,
} from '../domain/workout-engine.types';
import { normalizeWorkoutKey } from '../domain/workout-keys';

type PlanRow = {
  id: string;
  version: number;
  status: string | null;
  algorithmVersion: string | null;
};

type DayRow = {
  id: string;
  dayIndex: number;
  exerciseOrder: number;
  exerciseName: string;
  riskLevel: string;
  dayTitle: string | null;
  isRestDay: boolean;
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  restSeconds: number | null;
  prescriptionMode: 'REPS' | 'DURATION' | null;
  durationSecondsPerSet: number | null;
  exerciseId: string | null;
  exerciseKey: string | null;
};

type ExerciseRow = {
  id: string;
  key: string | null;
  name: string;
  nameRu: string | null;
  nameEn: string | null;
  displayNameRu: string | null;
  displayNameEn: string | null;
  techniqueSummaryRu: string | null;
  techniqueSummaryEn: string | null;
  commonMistakeRu: string | null;
  commonMistakeEn: string | null;
  easierVariantKey: string | null;
  estimatedMinutes: number | null;
  riskLevel: string;
  movementPattern: string | null;
  difficulty: string | null;
  equipmentCodesJson: unknown;
  muscleGroupsJson: unknown;
  isActive: boolean;
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      return [];
    }
  }
  return [];
}

@Injectable()
export class WorkoutEngineRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async nextVersion(userId: string): Promise<number> {
    const result = await this.db.query<{ nextVersion: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS "nextVersion" FROM "WorkoutPlan" WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0]?.nextVersion ?? 1;
  }

  async listActiveExercises(): Promise<CatalogExercise[]> {
    const result = await this.db.query<ExerciseRow>(
      `SELECT id, key, name, "nameRu", "nameEn", "displayNameRu", "displayNameEn",
              "techniqueSummaryRu", "techniqueSummaryEn", "commonMistakeRu", "commonMistakeEn",
              "easierVariantKey", "estimatedMinutes", "riskLevel", "movementPattern", difficulty,
              "equipmentCodesJson", "muscleGroupsJson", "isActive"
       FROM "Exercise"
       WHERE "isActive" = true AND key IS NOT NULL
       ORDER BY key ASC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      key: row.key!,
      name: row.name,
      nameRu: row.nameRu,
      nameEn: row.nameEn,
      displayNameRu: row.displayNameRu,
      displayNameEn: row.displayNameEn,
      techniqueSummaryRu: row.techniqueSummaryRu,
      techniqueSummaryEn: row.techniqueSummaryEn,
      commonMistakeRu: row.commonMistakeRu,
      commonMistakeEn: row.commonMistakeEn,
      easierVariantKey: row.easierVariantKey,
      estimatedMinutes: row.estimatedMinutes,
      riskLevel: (row.riskLevel as RiskLevel) || 'low',
      movementPattern: (row.movementPattern as MovementPattern) || 'cardio',
      difficulty: (row.difficulty as TrainingLevel) || 'BEGINNER',
      equipmentCodes: asStringArray(row.equipmentCodesJson),
      muscleGroups: asStringArray(row.muscleGroupsJson),
      isActive: row.isActive,
    }));
  }

  /** @deprecated Prefer savePlan — kept for legacy callers. */
  async save(
    userId: string,
    version: number,
    plan: { days: { dayIndex: number; exercises: { name: string; riskLevel: string }[] }[] },
  ) {
    const detail: WorkoutPlanDetail = {
      days: plan.days.map((day) => ({
        dayIndex: day.dayIndex,
        isRestDay: false,
        dayTitle: null,
        exercises: (day.exercises ?? []).map((ex, order) => ({
          exerciseOrder: order,
          exerciseName: ex.name,
          riskLevel: ex.riskLevel as RiskLevel,
        })),
      })),
    };
    await this.savePlan(userId, version, detail, {
      algorithmVersion: 'legacy',
      inputSnapshotJson: null,
      status: 'active',
    });
    return plan;
  }

  async savePlan(
    userId: string,
    version: number,
    plan: WorkoutPlanDetail,
    meta: WorkoutPlanSaveMeta,
  ): Promise<{ id: string; version: number }> {
    // Plan insert + supersede + day rows must commit atomically so a mid-write
    // failure never leaves the prior active plan superseded with an incomplete new plan.
    return this.db.withTransaction(async (query) => {
      const planResult = await query<{ id: string }>(
        `INSERT INTO "WorkoutPlan" (
           "userId", version, status, "algorithmVersion", "inputSnapshotJson", "generatedAt",
           "workoutCatalogReleaseId", "workoutCatalogReleaseCode", "timeZone"
         ) VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()), $7, $8, $9)
         RETURNING id`,
        [
          userId,
          version,
          meta.status ?? 'active',
          meta.algorithmVersion,
          meta.inputSnapshotJson != null ? JSON.stringify(meta.inputSnapshotJson) : null,
          meta.generatedAt?.toISOString() ?? null,
          meta.workoutCatalogReleaseId ?? null,
          meta.workoutCatalogReleaseCode ?? null,
          meta.timeZone ?? null,
        ],
      );
      const planId = planResult.rows[0]?.id;
      if (!planId) throw new Error('WORKOUT_PLAN_SAVE_FAILED');

      // Keep prior versions; only demote previous active rows after the new plan exists.
      if ((meta.status ?? 'active') === 'active') {
        await query(
          `UPDATE "WorkoutPlan"
           SET status = 'superseded'
           WHERE "userId" = $1 AND id <> $2 AND status = 'active'`,
          [userId, planId],
        );
      }

      for (const day of plan.days) {
        const rows =
          day.isRestDay && day.exercises.length === 0
            ? [
                {
                  exerciseOrder: 0,
                  exerciseName: 'rest',
                  riskLevel: 'low' as RiskLevel,
                  sets: null,
                  repsMin: null,
                  repsMax: null,
                  restSeconds: null,
                  prescriptionMode: null,
                  durationSecondsPerSet: null,
                  exerciseId: null,
                  exerciseKey: 'rest',
                },
              ]
            : day.exercises;

        for (const ex of rows) {
          await query(
            `INSERT INTO "WorkoutPlanDay" (
               "workoutPlanId", "dayIndex", "exerciseOrder", "exerciseName", "riskLevel",
               "dayTitle", "isRestDay", sets, "repsMin", "repsMax", "restSeconds",
               "prescriptionMode", "durationSecondsPerSet", "exerciseId"
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              planId,
              day.dayIndex,
              ex.exerciseOrder,
              ex.exerciseName,
              ex.riskLevel,
              day.dayTitle ?? null,
              day.isRestDay,
              ex.sets ?? null,
              ex.repsMin ?? null,
              ex.repsMax ?? null,
              ex.restSeconds ?? null,
              ex.prescriptionMode ?? null,
              ex.durationSecondsPerSet ?? null,
              ex.exerciseId ?? null,
            ],
          );
        }
      }

      return { id: planId, version };
    });
  }

  async findLatestByUserId(userId: string): Promise<{
    id: string;
    version: number;
    status?: string;
    algorithmVersion?: string;
    plan: WorkoutPlanDetail;
  } | null> {
    const planResult = await this.db.query<PlanRow>(
      `SELECT id, version, status, "algorithmVersion"
       FROM "WorkoutPlan"
       WHERE "userId" = $1
       ORDER BY version DESC
       LIMIT 1`,
      [userId],
    );
    const planRow = planResult.rows[0];
    if (!planRow) return null;

    const dayRows = await this.db.query<DayRow>(
      `SELECT d.id, d."dayIndex", d."exerciseOrder", d."exerciseName", d."riskLevel",
              d."dayTitle", d."isRestDay", d.sets, d."repsMin", d."repsMax", d."restSeconds",
              d."prescriptionMode", d."durationSecondsPerSet",
              d."exerciseId", e.key AS "exerciseKey"
       FROM "WorkoutPlanDay" d
       LEFT JOIN "Exercise" e ON e.id = d."exerciseId"
       WHERE d."workoutPlanId" = $1
       ORDER BY d."dayIndex", d."exerciseOrder"`,
      [planRow.id],
    );

    const byDay = new Map<number, WorkoutPlanDetail['days'][number]>();
    for (const row of dayRows.rows) {
      let day = byDay.get(row.dayIndex);
      if (!day) {
        day = {
          dayIndex: row.dayIndex,
          dayTitle: row.dayTitle,
          isRestDay: Boolean(row.isRestDay),
          trainingPlace: row.dayTitle?.includes('зале')
            ? 'GYM'
            : row.isRestDay
              ? undefined
              : 'HOME',
          exercises: [],
        };
        byDay.set(row.dayIndex, day);
      }
      day.exercises.push({
        exerciseOrder: row.exerciseOrder,
        exerciseName: normalizeWorkoutKey(row.exerciseName),
        exerciseKey: row.exerciseKey ?? normalizeWorkoutKey(row.exerciseName),
        exerciseId: row.exerciseId,
        planDayRowId: row.id,
        riskLevel: row.riskLevel as RiskLevel,
        sets: row.sets,
        repsMin: row.repsMin,
        repsMax: row.repsMax,
        restSeconds: row.restSeconds,
        prescriptionMode: row.prescriptionMode,
        durationSecondsPerSet: row.durationSecondsPerSet,
      });
    }

    return {
      id: planRow.id,
      version: planRow.version,
      status: planRow.status ?? undefined,
      algorithmVersion: planRow.algorithmVersion ?? undefined,
      plan: {
        days: [...byDay.values()].sort((a, b) => a.dayIndex - b.dayIndex),
      },
    };
  }
}
