import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  PreferredDuration,
  TrainingLevel,
  TrainingPlace,
  WorkoutPlanDayDetail,
  WorkoutPlanDayOverride,
  WorkoutProfile,
  WorkoutProfilePatch,
  WorkoutReplacementType,
} from '../domain/workout-engine.types';

type ProfileRow = {
  userId: string;
  trainingLevel: TrainingLevel;
  trainingPlace: TrainingPlace;
  workoutsPerWeek: number;
  preferredDuration: PreferredDuration;
  availableDaysJson: unknown;
  workoutEquipmentJson: unknown;
  preferredActivityTypesJson: unknown;
  excludedExerciseKeysJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type OverrideRow = {
  id: string;
  userId: string;
  workoutPlanId: string;
  dayIndex: number;
  replacementType: WorkoutReplacementType;
  replacementDayTitle: string | null;
  replacementSnapshotJson: unknown;
  moveTargetDayIndex: number | null;
  reason: string | null;
  source: 'user' | 'system';
  status: 'active' | 'reverted';
  createdAt: Date;
  revertedAt: Date | null;
};

function arrayOf<T extends string | number>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapProfile(row: ProfileRow): WorkoutProfile {
  return {
    userId: row.userId,
    trainingLevel: row.trainingLevel,
    trainingPlace: row.trainingPlace,
    workoutsPerWeek: row.workoutsPerWeek,
    preferredDuration: row.preferredDuration,
    availableDays: arrayOf<number>(row.availableDaysJson),
    workoutEquipment: arrayOf(row.workoutEquipmentJson),
    preferredActivityTypes: arrayOf(row.preferredActivityTypesJson),
    excludedExerciseKeys: arrayOf(row.excludedExerciseKeysJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapOverride(row: OverrideRow): WorkoutPlanDayOverride {
  return {
    id: row.id,
    userId: row.userId,
    workoutPlanId: row.workoutPlanId,
    dayIndex: row.dayIndex,
    replacementType: row.replacementType,
    replacementDayTitle: row.replacementDayTitle,
    replacementSnapshot: row.replacementSnapshotJson as WorkoutPlanDayDetail,
    moveTargetDayIndex: row.moveTargetDayIndex,
    reason: row.reason,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
    revertedAt: row.revertedAt,
  };
}

@Injectable()
export class WorkoutProfileRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async findByUserId(userId: string): Promise<WorkoutProfile | null> {
    const result = await this.db.query<ProfileRow>(
      `SELECT * FROM "WorkoutProfile" WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async createDefaults(
    userId: string,
    seed: { trainingLevel: TrainingLevel; workoutsPerWeek: number },
  ): Promise<WorkoutProfile> {
    const result = await this.db.query<ProfileRow>(
      `INSERT INTO "WorkoutProfile" ("userId", "trainingLevel", "workoutsPerWeek")
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId") DO UPDATE SET "userId" = EXCLUDED."userId"
       RETURNING *`,
      [userId, seed.trainingLevel, seed.workoutsPerWeek],
    );
    return mapProfile(result.rows[0]!);
  }

  async update(userId: string, patch: WorkoutProfilePatch): Promise<WorkoutProfile> {
    const current = await this.findByUserId(userId);
    if (!current) throw new Error('WORKOUT_PROFILE_NOT_FOUND');
    const next = { ...current, ...patch };
    const result = await this.db.query<ProfileRow>(
      `UPDATE "WorkoutProfile" SET
         "trainingLevel" = $2, "trainingPlace" = $3, "workoutsPerWeek" = $4,
         "preferredDuration" = $5, "availableDaysJson" = $6::jsonb,
         "workoutEquipmentJson" = $7::jsonb, "preferredActivityTypesJson" = $8::jsonb,
         "excludedExerciseKeysJson" = $9::jsonb, "updatedAt" = now()
       WHERE "userId" = $1 RETURNING *`,
      [
        userId,
        next.trainingLevel,
        next.trainingPlace,
        next.workoutsPerWeek,
        next.preferredDuration,
        JSON.stringify(next.availableDays),
        JSON.stringify(next.workoutEquipment),
        JSON.stringify(next.preferredActivityTypes),
        JSON.stringify(next.excludedExerciseKeys),
      ],
    );
    return mapProfile(result.rows[0]!);
  }

  async listActiveOverrides(workoutPlanId: string): Promise<WorkoutPlanDayOverride[]> {
    const result = await this.db.query<OverrideRow>(
      `SELECT * FROM "WorkoutPlanDayOverride"
       WHERE "workoutPlanId" = $1 AND status = 'active'
       ORDER BY "dayIndex", "createdAt" DESC`,
      [workoutPlanId],
    );
    return result.rows.map(mapOverride);
  }

  async findActiveOverride(
    workoutPlanId: string,
    dayIndex: number,
  ): Promise<WorkoutPlanDayOverride | null> {
    const result = await this.db.query<OverrideRow>(
      `SELECT * FROM "WorkoutPlanDayOverride"
       WHERE "workoutPlanId" = $1 AND "dayIndex" = $2 AND status = 'active'
       LIMIT 1`,
      [workoutPlanId, dayIndex],
    );
    return result.rows[0] ? mapOverride(result.rows[0]) : null;
  }

  async replaceActiveOverride(input: {
    userId: string;
    workoutPlanId: string;
    dayIndex: number;
    replacementType: WorkoutReplacementType;
    replacementDayTitle: string | null;
    replacementSnapshot: WorkoutPlanDayDetail;
    moveTargetDayIndex?: number | null;
    reason?: string | null;
  }): Promise<WorkoutPlanDayOverride> {
    return this.db.withTransaction(async (query) => {
      await query(
        `UPDATE "WorkoutPlanDayOverride" SET status = 'reverted', "revertedAt" = now()
         WHERE "workoutPlanId" = $1 AND "dayIndex" = $2 AND status = 'active'`,
        [input.workoutPlanId, input.dayIndex],
      );
      const result = await query<OverrideRow>(
        `INSERT INTO "WorkoutPlanDayOverride" (
           "userId", "workoutPlanId", "dayIndex", "replacementType",
           "replacementDayTitle", "replacementSnapshotJson", "moveTargetDayIndex", reason
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [
          input.userId,
          input.workoutPlanId,
          input.dayIndex,
          input.replacementType,
          input.replacementDayTitle,
          JSON.stringify(input.replacementSnapshot),
          input.moveTargetDayIndex ?? null,
          input.reason ?? null,
        ],
      );
      return mapOverride(result.rows[0]!);
    });
  }

  async revert(userId: string, overrideId: string): Promise<WorkoutPlanDayOverride | null> {
    const result = await this.db.query<OverrideRow>(
      `UPDATE "WorkoutPlanDayOverride"
       SET status = 'reverted', "revertedAt" = COALESCE("revertedAt", now())
       WHERE id = $1 AND "userId" = $2
       RETURNING *`,
      [overrideId, userId],
    );
    if (result.rows[0]) return mapOverride(result.rows[0]);
    const existing = await this.db.query<OverrideRow>(
      `SELECT * FROM "WorkoutPlanDayOverride" WHERE id = $1 AND "userId" = $2`,
      [overrideId, userId],
    );
    return existing.rows[0] ? mapOverride(existing.rows[0]) : null;
  }

  async getExerciseDetail(key: string) {
    const exercise = await this.db.query<Record<string, unknown>>(
      `SELECT id, key, name, "nameRu", "nameEn", "displayNameRu", "displayNameEn",
              "techniqueSummaryRu", "techniqueSummaryEn", "commonMistakeRu", "commonMistakeEn",
              "easierVariantKey", "estimatedMinutes", "riskLevel", "movementPattern", difficulty,
              "equipmentCodesJson", "muscleGroupsJson"
       FROM "Exercise" WHERE key = $1 AND "isActive" = true LIMIT 1`,
      [key],
    );
    if (!exercise.rows[0]) return null;
    const media = await this.db.query<Record<string, unknown>>(
      `SELECT id, "mediaType", role, "mimeType", width, height, "altText", "sortOrder"
       FROM "ExerciseMedia"
       WHERE "exerciseId" = $1
         AND status = 'APPROVED'
         AND role IN ('START_POSITION', 'END_POSITION', 'MUSCLE_MAP')
       ORDER BY CASE role
         WHEN 'START_POSITION' THEN 0
         WHEN 'END_POSITION' THEN 1
         WHEN 'MUSCLE_MAP' THEN 2
         ELSE 99
       END, "sortOrder" ASC`,
      [exercise.rows[0].id],
    );
    return { ...exercise.rows[0], media: media.rows };
  }
}
