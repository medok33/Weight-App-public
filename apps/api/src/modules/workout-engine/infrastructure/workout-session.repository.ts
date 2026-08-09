import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type {
  WorkoutSessionExerciseStatus,
  WorkoutSessionExerciseView,
  WorkoutSessionMediaSnapshot,
  WorkoutSessionSetPatch,
  WorkoutSessionSetView,
  WorkoutSessionStatus,
  WorkoutSessionView,
} from '../domain/workout-session.types';
import type { AdaptationSessionSnapshot } from '../domain/workout-adaptation.types';
import type { SessionEnergySnapshotFields } from '../energy/workout-energy.types';

type SessionRow = {
  id: string;
  userId: string;
  workoutPlanId: string | null;
  sourceDayIndex: number;
  effectiveDayIndex: number;
  effectiveDate: Date | string;
  dayTitle: string | null;
  estimatedMinutes: number | null;
  version: number;
  status: WorkoutSessionStatus;
  startedAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  abandonedAt: Date | null;
  durationSeconds: number | null;
  totalExercises: number;
  completedExercises: number;
  createdAt: Date;
  updatedAt: Date;
};

type ExerciseRow = {
  id: string;
  sessionId: string;
  sourceExerciseId: string | null;
  exerciseRevisionId: string | null;
  catalogReleaseId: string | null;
  sourcePlanDayRowId: string | null;
  exerciseKey: string | null;
  orderIndex: number;
  displayNameRu: string;
  displayNameEn: string;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  techniqueSummaryRu: string | null;
  techniqueSummaryEn: string | null;
  commonMistakeRu: string | null;
  commonMistakeEn: string | null;
  easierVariantRu: string | null;
  easierVariantEn: string | null;
  breathingRu: string | null;
  breathingEn: string | null;
  stopConditionsRu: string | null;
  stopConditionsEn: string | null;
  mediaSnapshotJson: unknown;
  status: WorkoutSessionExerciseStatus;
  skippedAt: Date | null;
  completedAt: Date | null;
};

type SetRow = {
  id: string;
  sessionExerciseId: string;
  setIndex: number;
  targetReps: number | null;
  targetDurationSeconds: number | null;
  actualReps: number | null;
  actualDurationSeconds: number | null;
  weightKg: string | number | null;
  completedAt: Date | null;
};

export type SessionExerciseSeed = {
  sourceExerciseId: string | null;
  exerciseRevisionId?: string | null;
  catalogReleaseId?: string | null;
  sourcePlanDayRowId: string | null;
  exerciseKey: string | null;
  orderIndex: number;
  displayNameRu: string;
  displayNameEn: string;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  techniqueSummaryRu: string | null;
  techniqueSummaryEn: string | null;
  commonMistakeRu: string | null;
  commonMistakeEn: string | null;
  easierVariantRu: string | null;
  easierVariantEn: string | null;
  breathingRu: string | null;
  breathingEn: string | null;
  stopConditionsRu: string | null;
  stopConditionsEn: string | null;
  media: WorkoutSessionMediaSnapshot[];
  energySnapshot?: SessionEnergySnapshotFields;
};

function asDateIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function asDateOnly(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  // pg returns DATE columns as Date objects at local midnight (not UTC midnight).
  // Using local date components ensures we recover the original YYYY-MM-DD calendar date
  // regardless of the server process timezone offset.
  const d = value instanceof Date ? value : new Date(value);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function asMedia(value: unknown): WorkoutSessionMediaSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id ?? ''),
      mediaType: String(row.mediaType ?? 'image'),
      role: String(row.role ?? 'cover'),
      locale: row.locale == null ? null : String(row.locale),
      altText: String(row.altText ?? ''),
      sortOrder: Number(row.sortOrder ?? 0),
    };
  });
}

function mapSet(row: SetRow): WorkoutSessionSetView {
  return {
    id: row.id,
    setIndex: row.setIndex,
    targetReps: row.targetReps,
    targetDurationSeconds: row.targetDurationSeconds,
    actualReps: row.actualReps,
    actualDurationSeconds: row.actualDurationSeconds,
    weightKg: row.weightKg == null ? null : Number(row.weightKg),
    completedAt: row.completedAt ? asDateIso(row.completedAt) : null,
  };
}

function mapExercise(row: ExerciseRow, sets: WorkoutSessionSetView[]): WorkoutSessionExerciseView {
  return {
    id: row.id,
    orderIndex: row.orderIndex,
    exerciseKey: row.exerciseKey,
    sourceExerciseId: row.sourceExerciseId,
    exerciseRevisionId: row.exerciseRevisionId,
    catalogReleaseId: row.catalogReleaseId,
    displayNameRu: row.displayNameRu,
    displayNameEn: row.displayNameEn,
    targetSets: row.targetSets,
    targetRepsMin: row.targetRepsMin,
    targetRepsMax: row.targetRepsMax,
    targetDurationSeconds: row.targetDurationSeconds,
    restSeconds: row.restSeconds,
    techniqueSummaryRu: row.techniqueSummaryRu,
    techniqueSummaryEn: row.techniqueSummaryEn,
    commonMistakeRu: row.commonMistakeRu,
    commonMistakeEn: row.commonMistakeEn,
    easierVariantRu: row.easierVariantRu,
    easierVariantEn: row.easierVariantEn,
    breathingRu: row.breathingRu ?? null,
    breathingEn: row.breathingEn ?? null,
    stopConditionsRu: row.stopConditionsRu ?? null,
    stopConditionsEn: row.stopConditionsEn ?? null,
    media: asMedia(row.mediaSnapshotJson),
    status: row.status,
    skippedAt: row.skippedAt ? asDateIso(row.skippedAt) : null,
    completedAt: row.completedAt ? asDateIso(row.completedAt) : null,
    sets,
  };
}

function mapSession(row: SessionRow, exercises: WorkoutSessionExerciseView[]): WorkoutSessionView {
  return {
    id: row.id,
    userId: row.userId,
    workoutPlanId: row.workoutPlanId,
    sourceDayIndex: row.sourceDayIndex,
    effectiveDayIndex: row.effectiveDayIndex,
    effectiveDate: asDateOnly(row.effectiveDate),
    dayTitle: row.dayTitle,
    estimatedMinutes: row.estimatedMinutes,
    version: row.version ?? 1,
    status: row.status,
    startedAt: asDateIso(row.startedAt),
    lastActivityAt: asDateIso(row.lastActivityAt),
    completedAt: row.completedAt ? asDateIso(row.completedAt) : null,
    abandonedAt: row.abandonedAt ? asDateIso(row.abandonedAt) : null,
    durationSeconds: row.durationSeconds,
    totalExercises: row.totalExercises,
    completedExercises: row.completedExercises,
    exercises,
  };
}

@Injectable()
export class WorkoutSessionRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async findActiveByUserId(userId: string): Promise<WorkoutSessionView | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT * FROM "WorkoutSession" WHERE "userId" = $1 AND status = 'ACTIVE' LIMIT 1`,
      [userId],
    );
    if (!result.rows[0]) return null;
    return this.hydrate(result.rows[0]);
  }

  /** Latest session for a calendar date (ACTIVE preferred over COMPLETED/ABANDONED). Additive read for hub UX. */
  async findLatestByUserAndEffectiveDate(
    userId: string,
    effectiveDate: string,
  ): Promise<WorkoutSessionView | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT * FROM "WorkoutSession"
       WHERE "userId" = $1 AND "effectiveDate" = $2::date
       ORDER BY CASE status
         WHEN 'ACTIVE' THEN 0
         WHEN 'COMPLETED' THEN 1
         ELSE 2
       END,
       "startedAt" DESC
       LIMIT 1`,
      [userId, effectiveDate],
    );
    if (!result.rows[0]) return null;
    return this.hydrate(result.rows[0]);
  }

  async findByIdForUser(userId: string, sessionId: string): Promise<WorkoutSessionView | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT * FROM "WorkoutSession" WHERE id = $1 AND "userId" = $2 LIMIT 1`,
      [sessionId, userId],
    );
    if (!result.rows[0]) return null;
    return this.hydrate(result.rows[0]);
  }

  async createSnapshotSession(input: {
    userId: string;
    workoutPlanId: string;
    sourceDayIndex: number;
    effectiveDayIndex: number;
    effectiveDate: string;
    dayTitle: string | null;
    estimatedMinutes: number | null;
    exercises: SessionExerciseSeed[];
    startedAt?: Date;
  }): Promise<WorkoutSessionView> {
    const startedAt = input.startedAt ?? new Date();
    return this.db.withTransaction(async (query) => {
      const sessionResult = await query<SessionRow>(
        `INSERT INTO "WorkoutSession" (
           "userId", "workoutPlanId", "sourceDayIndex", "effectiveDayIndex", "effectiveDate",
           "dayTitle", "estimatedMinutes", status, "totalExercises", "completedExercises",
           "startedAt", "lastActivityAt"
         ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,'ACTIVE',$8,0,$9,$9)
         RETURNING *`,
        [
          input.userId,
          input.workoutPlanId,
          input.sourceDayIndex,
          input.effectiveDayIndex,
          input.effectiveDate,
          input.dayTitle,
          input.estimatedMinutes,
          input.exercises.length,
          startedAt,
        ],
      );
      const session = sessionResult.rows[0]!;
      for (const exercise of input.exercises) {
        const exerciseResult = await query<ExerciseRow>(
          `INSERT INTO "WorkoutSessionExercise" (
             "sessionId", "sourceExerciseId", "exerciseRevisionId", "catalogReleaseId", "sourcePlanDayRowId", "exerciseKey", "orderIndex",
             "displayNameRu", "displayNameEn", "targetSets", "targetRepsMin", "targetRepsMax",
             "targetDurationSeconds", "restSeconds", "techniqueSummaryRu", "techniqueSummaryEn",
             "commonMistakeRu", "commonMistakeEn", "easierVariantRu", "easierVariantEn",
             "breathingRu", "breathingEn", "stopConditionsRu", "stopConditionsEn",
             "mediaSnapshotJson", status,
             "energyEstimateStatus", "plannedGrossEstimatedKcal",
             "plannedRestingEstimatedKcal", "plannedIncrementalEstimatedKcal",
             "energyWeightKgUsed", "energyWeightSource", "energyWeightSourceRecordedAt",
             "energyActiveSecondsUsed", "exerciseEnergyProfileId",
             "exerciseEnergyTimingProfileId", "energyCalculationMethod",
             "energyPopulationType", "energyPolicyVersion", "energySourceVersion",
             "energyCalculatedAt"
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25::jsonb,'PENDING',$26,$27,$28,$29,$30,$31,$32,$33,$34,
             $35,$36,$37,$38,$39,$40
           ) RETURNING *`,
          [
            session.id,
            exercise.sourceExerciseId,
            exercise.exerciseRevisionId ?? null,
            exercise.catalogReleaseId ?? null,
            exercise.sourcePlanDayRowId,
            exercise.exerciseKey,
            exercise.orderIndex,
            exercise.displayNameRu,
            exercise.displayNameEn,
            exercise.targetSets,
            exercise.targetRepsMin,
            exercise.targetRepsMax,
            exercise.targetDurationSeconds,
            exercise.restSeconds,
            exercise.techniqueSummaryRu,
            exercise.techniqueSummaryEn,
            exercise.commonMistakeRu,
            exercise.commonMistakeEn,
            exercise.easierVariantRu,
            exercise.easierVariantEn,
            exercise.breathingRu,
            exercise.breathingEn,
            exercise.stopConditionsRu,
            exercise.stopConditionsEn,
            JSON.stringify(exercise.media),
            exercise.energySnapshot?.energyEstimateStatus ?? null,
            exercise.energySnapshot?.plannedGrossEstimatedKcal ?? null,
            exercise.energySnapshot?.plannedRestingEstimatedKcal ?? null,
            exercise.energySnapshot?.plannedIncrementalEstimatedKcal ?? null,
            exercise.energySnapshot?.energyWeightKgUsed ?? null,
            exercise.energySnapshot?.energyWeightSource ?? null,
            exercise.energySnapshot?.energyWeightSourceRecordedAt ?? null,
            exercise.energySnapshot?.energyActiveSecondsUsed ?? null,
            exercise.energySnapshot?.exerciseEnergyProfileId ?? null,
            exercise.energySnapshot?.exerciseEnergyTimingProfileId ?? null,
            exercise.energySnapshot?.energyCalculationMethod ?? null,
            exercise.energySnapshot?.energyPopulationType ?? null,
            exercise.energySnapshot?.energyPolicyVersion ?? null,
            exercise.energySnapshot?.energySourceVersion ?? null,
            exercise.energySnapshot?.energyCalculatedAt ?? null,
          ],
        );
        const created = exerciseResult.rows[0]!;
        for (let setIndex = 1; setIndex <= exercise.targetSets; setIndex += 1) {
          const targetReps =
            exercise.targetRepsMax ?? exercise.targetRepsMin ?? null;
          await query(
            `INSERT INTO "WorkoutSessionSet" (
               "sessionExerciseId", "setIndex", "targetReps", "targetDurationSeconds"
             ) VALUES ($1,$2,$3,$4)`,
            [created.id, setIndex, targetReps, exercise.targetDurationSeconds],
          );
        }
      }
      return (await this.hydrateWithQuery(query, session))!;
    });
  }

  async updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setIndex: number,
    patch: WorkoutSessionSetPatch,
  ): Promise<WorkoutSessionView> {
    return this.db.withTransaction(async (query) => {
      const session = await this.requireActiveSession(query, userId, sessionId);
      const exercise = await this.requireExercise(query, session.id, exerciseId);
      if (exercise.status === 'SKIPPED') throw new Error('WORKOUT_EXERCISE_SKIPPED');
      const setResult = await query<SetRow>(
        `SELECT * FROM "WorkoutSessionSet" WHERE "sessionExerciseId" = $1 AND "setIndex" = $2`,
        [exercise.id, setIndex],
      );
      if (!setResult.rows[0]) throw new Error('WORKOUT_SESSION_SET_NOT_FOUND');

      const completed = patch.completed === true;
      const cleared = patch.completed === false;
      const actualReps =
        patch.actualReps === undefined
          ? setResult.rows[0].actualReps
          : patch.actualReps;
      const actualDurationSeconds =
        patch.actualDurationSeconds === undefined
          ? setResult.rows[0].actualDurationSeconds
          : patch.actualDurationSeconds;
      const weightKg =
        patch.weightKg === undefined ? setResult.rows[0].weightKg : patch.weightKg;

      await query(
        `UPDATE "WorkoutSessionSet"
         SET "actualReps" = $3,
             "actualDurationSeconds" = $4,
             "weightKg" = $5,
             "completedAt" = CASE
               WHEN $6::boolean THEN COALESCE("completedAt", now())
               WHEN $7::boolean THEN NULL
               ELSE "completedAt"
             END,
             "updatedAt" = now()
         WHERE "sessionExerciseId" = $1 AND "setIndex" = $2`,
        [
          exercise.id,
          setIndex,
          actualReps,
          actualDurationSeconds,
          weightKg,
          completed,
          cleared,
        ],
      );

      await this.refreshExerciseStatus(query, exercise.id);
      const touched = await this.touchSession(query, session.id);
      return (await this.hydrateWithQuery(query, touched))!;
    });
  }

  async skipExercise(userId: string, sessionId: string, exerciseId: string): Promise<WorkoutSessionView> {
    return this.db.withTransaction(async (query) => {
      const session = await this.requireActiveSession(query, userId, sessionId);
      await this.requireExercise(query, session.id, exerciseId);
      await query(
        `UPDATE "WorkoutSessionExercise"
         SET status = 'SKIPPED',
             "skippedAt" = COALESCE("skippedAt", now()),
             "completedAt" = NULL,
             "updatedAt" = now()
         WHERE id = $1`,
        [exerciseId],
      );
      const touched = await this.touchSession(query, session.id);
      return (await this.hydrateWithQuery(query, touched))!;
    });
  }

  async unskipExercise(userId: string, sessionId: string, exerciseId: string): Promise<WorkoutSessionView> {
    return this.db.withTransaction(async (query) => {
      const session = await this.requireActiveSession(query, userId, sessionId);
      await this.requireExercise(query, session.id, exerciseId);
      await query(
        `UPDATE "WorkoutSessionExercise"
         SET status = 'PENDING',
             "skippedAt" = NULL,
             "completedAt" = NULL,
             "updatedAt" = now()
         WHERE id = $1`,
        [exerciseId],
      );
      await this.refreshExerciseStatus(query, exerciseId);
      const touched = await this.touchSession(query, session.id);
      return (await this.hydrateWithQuery(query, touched))!;
    });
  }

  async complete(userId: string, sessionId: string): Promise<WorkoutSessionView> {
    return this.db.withTransaction(async (query) => {
      const existing = await query<SessionRow>(
        `SELECT * FROM "WorkoutSession" WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [sessionId, userId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('WORKOUT_SESSION_NOT_FOUND');
      if (row.status === 'ABANDONED') throw new Error('WORKOUT_SESSION_ABANDONED');
      if (row.status === 'COMPLETED') return (await this.hydrateWithQuery(query, row))!;

      const completedCount = await this.countHandledExercises(query, row.id);
      const completedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.floor((completedAt.getTime() - new Date(row.startedAt).getTime()) / 1000),
      );
      const updated = await query<SessionRow>(
        `UPDATE "WorkoutSession"
         SET status = 'COMPLETED',
             "completedAt" = $2,
             "durationSeconds" = $3,
             "completedExercises" = $4,
             "lastActivityAt" = $2,
             "updatedAt" = now()
         WHERE id = $1
         RETURNING *`,
        [row.id, completedAt.toISOString(), durationSeconds, completedCount],
      );
      return (await this.hydrateWithQuery(query, updated.rows[0]!))!;
    });
  }

  async abandon(userId: string, sessionId: string): Promise<WorkoutSessionView> {
    return this.db.withTransaction(async (query) => {
      const existing = await query<SessionRow>(
        `SELECT * FROM "WorkoutSession" WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [sessionId, userId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('WORKOUT_SESSION_NOT_FOUND');
      if (row.status === 'COMPLETED') throw new Error('WORKOUT_SESSION_COMPLETED');
      if (row.status === 'ABANDONED') return (await this.hydrateWithQuery(query, row))!;

      const abandonedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.floor((abandonedAt.getTime() - new Date(row.startedAt).getTime()) / 1000),
      );
      const completedCount = await this.countHandledExercises(query, row.id);
      const updated = await query<SessionRow>(
        `UPDATE "WorkoutSession"
         SET status = 'ABANDONED',
             "abandonedAt" = $2,
             "durationSeconds" = $3,
             "completedExercises" = $4,
             "lastActivityAt" = $2,
             "updatedAt" = now()
         WHERE id = $1
         RETURNING *`,
        [row.id, abandonedAt.toISOString(), durationSeconds, completedCount],
      );
      return (await this.hydrateWithQuery(query, updated.rows[0]!))!;
    });
  }

  async replaceSessionContent(
    query: SqlQuery,
    userId: string,
    sessionId: string,
    expectedVersion: number,
    snapshot: AdaptationSessionSnapshot,
  ): Promise<WorkoutSessionView> {
    const updated = await query<SessionRow>(
      `UPDATE "WorkoutSession"
       SET "effectiveDayIndex" = $3,
           "effectiveDate" = $4::date,
           "dayTitle" = $5,
           "estimatedMinutes" = $6,
           version = version + 1,
           "totalExercises" = $7,
           "completedExercises" = 0,
           "lastActivityAt" = now(),
           "updatedAt" = now()
       WHERE id = $1 AND "userId" = $2 AND status = 'ACTIVE' AND version = $8
       RETURNING *`,
      [
        sessionId,
        userId,
        snapshot.effectiveDayIndex,
        snapshot.effectiveDate,
        snapshot.dayTitle,
        snapshot.estimatedMinutes,
        snapshot.exercises.length,
        expectedVersion,
      ],
    );
    const session = updated.rows[0];
    if (!session) throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');

    await query(`DELETE FROM "WorkoutSessionExercise" WHERE "sessionId" = $1`, [sessionId]);
    for (const exercise of snapshot.exercises) {
      const created = await query<ExerciseRow>(
        `INSERT INTO "WorkoutSessionExercise" (
           "sessionId", "sourceExerciseId", "exerciseRevisionId", "catalogReleaseId", "exerciseKey", "orderIndex",
           "displayNameRu", "displayNameEn", "targetSets", "targetRepsMin", "targetRepsMax",
           "targetDurationSeconds", "restSeconds", "techniqueSummaryRu", "techniqueSummaryEn",
           "commonMistakeRu", "commonMistakeEn", "easierVariantRu", "easierVariantEn",
           "breathingRu", "breathingEn", "stopConditionsRu", "stopConditionsEn", "mediaSnapshotJson", status,
           "energyEstimateStatus", "plannedGrossEstimatedKcal",
           "plannedRestingEstimatedKcal", "plannedIncrementalEstimatedKcal",
           "energyWeightKgUsed", "energyWeightSource", "energyWeightSourceRecordedAt",
           "energyActiveSecondsUsed", "exerciseEnergyProfileId",
           "exerciseEnergyTimingProfileId", "energyCalculationMethod",
           "energyPopulationType", "energyPolicyVersion", "energySourceVersion",
           "energyCalculatedAt"
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,'PENDING',
           $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
         ) RETURNING *`,
        [
          sessionId, exercise.sourceExerciseId, exercise.exerciseRevisionId, exercise.catalogReleaseId,
          exercise.exerciseKey, exercise.orderIndex, exercise.displayNameRu, exercise.displayNameEn,
          exercise.targetSets, exercise.targetRepsMin, exercise.targetRepsMax, exercise.targetDurationSeconds,
          exercise.restSeconds, exercise.techniqueSummaryRu, exercise.techniqueSummaryEn,
          exercise.commonMistakeRu, exercise.commonMistakeEn, exercise.easierVariantRu, exercise.easierVariantEn,
          exercise.breathingRu, exercise.breathingEn, exercise.stopConditionsRu, exercise.stopConditionsEn,
          JSON.stringify(exercise.media),
          exercise.energyEstimateStatus ?? null,
          exercise.plannedGrossEstimatedKcal ?? null,
          exercise.plannedRestingEstimatedKcal ?? null,
          exercise.plannedIncrementalEstimatedKcal ?? null,
          exercise.energyWeightKgUsed ?? null,
          exercise.energyWeightSource ?? null,
          exercise.energyWeightSourceRecordedAt ?? null,
          exercise.energyActiveSecondsUsed ?? null,
          exercise.exerciseEnergyProfileId ?? null,
          exercise.exerciseEnergyTimingProfileId ?? null,
          exercise.energyCalculationMethod ?? null,
          exercise.energyPopulationType ?? null,
          exercise.energyPolicyVersion ?? null,
          exercise.energySourceVersion ?? null,
          exercise.energyCalculatedAt ?? null,
        ],
      );
      for (let setIndex = 1; setIndex <= exercise.targetSets; setIndex += 1) {
        await query(
          `INSERT INTO "WorkoutSessionSet" ("sessionExerciseId", "setIndex", "targetReps", "targetDurationSeconds")
           VALUES ($1,$2,$3,$4)`,
          [created.rows[0]!.id, setIndex, exercise.targetRepsMax ?? exercise.targetRepsMin, exercise.targetDurationSeconds],
        );
      }
    }
    return (await this.hydrateWithQuery(query, session))!;
  }

  private async hydrate(session: SessionRow): Promise<WorkoutSessionView> {
    return this.hydrateWithQuery(this.db.query.bind(this.db) as SqlQuery, session);
  }

  private async hydrateWithQuery(query: SqlQuery, session: SessionRow): Promise<WorkoutSessionView> {
    const exercises = await query<ExerciseRow>(
      `SELECT * FROM "WorkoutSessionExercise" WHERE "sessionId" = $1 ORDER BY "orderIndex" ASC`,
      [session.id],
    );
    const sets = await query<SetRow>(
      `SELECT s.*
       FROM "WorkoutSessionSet" s
       INNER JOIN "WorkoutSessionExercise" e ON e.id = s."sessionExerciseId"
       WHERE e."sessionId" = $1
       ORDER BY e."orderIndex" ASC, s."setIndex" ASC`,
      [session.id],
    );
    const setsByExercise = new Map<string, WorkoutSessionSetView[]>();
    for (const row of sets.rows) {
      const list = setsByExercise.get(row.sessionExerciseId) ?? [];
      list.push(mapSet(row));
      setsByExercise.set(row.sessionExerciseId, list);
    }
    return mapSession(
      session,
      exercises.rows.map((exercise) => mapExercise(exercise, setsByExercise.get(exercise.id) ?? [])),
    );
  }

  private async requireActiveSession(query: SqlQuery, userId: string, sessionId: string): Promise<SessionRow> {
    const result = await query<SessionRow>(
      `SELECT * FROM "WorkoutSession" WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
      [sessionId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    if (row.status === 'COMPLETED') throw new Error('WORKOUT_SESSION_COMPLETED');
    if (row.status === 'ABANDONED') throw new Error('WORKOUT_SESSION_ABANDONED');
    return row;
  }

  private async requireExercise(query: SqlQuery, sessionId: string, exerciseId: string): Promise<ExerciseRow> {
    const result = await query<ExerciseRow>(
      `SELECT * FROM "WorkoutSessionExercise" WHERE id = $1 AND "sessionId" = $2`,
      [exerciseId, sessionId],
    );
    if (!result.rows[0]) throw new Error('WORKOUT_SESSION_EXERCISE_NOT_FOUND');
    return result.rows[0];
  }

  private async refreshExerciseStatus(query: SqlQuery, exerciseId: string): Promise<void> {
    const sets = await query<SetRow>(
      `SELECT * FROM "WorkoutSessionSet" WHERE "sessionExerciseId" = $1 ORDER BY "setIndex"`,
      [exerciseId],
    );
    const exercise = await query<ExerciseRow>(
      `SELECT * FROM "WorkoutSessionExercise" WHERE id = $1`,
      [exerciseId],
    );
    if (!exercise.rows[0] || exercise.rows[0].status === 'SKIPPED') return;
    const allDone = sets.rows.length > 0 && sets.rows.every((set) => set.completedAt != null);
    const anyDone = sets.rows.some((set) => set.completedAt != null);
    const status: WorkoutSessionExerciseStatus = allDone
      ? 'COMPLETED'
      : anyDone
        ? 'IN_PROGRESS'
        : 'PENDING';
    await query(
      `UPDATE "WorkoutSessionExercise"
       SET status = $2,
           "completedAt" = CASE WHEN $2 = 'COMPLETED' THEN COALESCE("completedAt", now()) ELSE NULL END,
           "updatedAt" = now()
       WHERE id = $1`,
      [exerciseId, status],
    );
  }

  private async touchSession(query: SqlQuery, sessionId: string): Promise<SessionRow> {
    const completedCount = await this.countHandledExercises(query, sessionId);
    const result = await query<SessionRow>(
      `UPDATE "WorkoutSession"
       SET "lastActivityAt" = now(),
           "completedExercises" = $2,
           "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [sessionId, completedCount],
    );
    const row = result.rows[0];
    if (!row) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    return row;
  }

  private async countHandledExercises(query: SqlQuery, sessionId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM "WorkoutSessionExercise"
       WHERE "sessionId" = $1 AND status IN ('COMPLETED', 'SKIPPED')`,
      [sessionId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
