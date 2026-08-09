import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type QueryResultRow } from 'pg';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { WorkoutSessionService } from '../../src/modules/workout-engine/application/workout-session.service';
import type { WorkoutPlanDayDetail } from '../../src/modules/workout-engine/domain/workout-engine.types';
import {
  WorkoutActiveSessionConflictError,
  WorkoutSessionIncompleteError,
} from '../../src/modules/workout-engine/domain/workout-session.types';
import { WorkoutSessionRepository } from '../../src/modules/workout-engine/infrastructure/workout-session.repository';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = <T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values);

  return {
    query,
    async withSessionAdvisoryLock(key1: number, key2Text: string, fn: () => Promise<unknown>) {
      const client = await pool.connect();
      try {
        const got = await client.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
          [key1, key2Text],
        );
        if (!got.rows[0]?.locked) return { acquired: false };
        try {
          const result = await fn();
          return { acquired: true, result };
        } finally {
          await client.query(`SELECT pg_advisory_unlock($1, hashtext($2))`, [key1, key2Text]);
        }
      } finally {
        client.release();
      }
    },
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

/** Retry only lock contention so Promise.all peers can serialize without sleep. */
async function startUntilReady(
  service: WorkoutSessionService,
  userId: string,
  input: { dayIndex?: number; date?: string } = {},
) {
  for (;;) {
    try {
      return await service.start(userId, input);
    } catch (error) {
      if (String((error as Error)?.message ?? error) === 'WORKOUT_SESSION_START_IN_PROGRESS') {
        continue;
      }
      throw error;
    }
  }
}

function makeDay(
  dayIndex: number,
  overrides: Partial<WorkoutPlanDayDetail> & {
    exerciseKey?: string;
    planDayRowId?: string | null;
    sourceDayIndex?: number;
  } = {},
): WorkoutPlanDayDetail {
  const exerciseKey = overrides.exerciseKey ?? 'bodyweight_squats';
  return {
    dayIndex,
    sourceDayIndex: overrides.sourceDayIndex,
    dayTitle: overrides.dayTitle ?? `Day ${dayIndex}`,
    isRestDay: overrides.isRestDay ?? false,
    estimatedMinutes: overrides.estimatedMinutes ?? 30,
    exercises:
      overrides.exercises ??
      [
        {
          exerciseOrder: 0,
          exerciseName: exerciseKey,
          exerciseKey,
          exerciseId: null,
          planDayRowId: overrides.planDayRowId ?? null,
          riskLevel: 'low',
          sets: 2,
          repsMin: 8,
          repsMax: 12,
          restSeconds: 60,
        },
      ],
  };
}

class FakeWorkoutEngine {
  planId: string | null = null;
  dayIndex = 0;
  days: WorkoutPlanDayDetail[] = [];

  async getTodayView(userId: string, date?: string) {
    void date;
    const day = this.days.find((item) => item.dayIndex === this.dayIndex) ?? this.days[0] ?? null;
    return {
      userId,
      version: 1,
      planId: this.planId,
      dayIndex: this.dayIndex,
      day,
      days: this.days,
    };
  }
}

class FakeCatalogReleases {
  async getPublishedExerciseDetail(key: string) {
    return {
      id: null,
      key,
      name: key,
      displayNameRu: `RU:${key}`,
      displayNameEn: `EN:${key}`,
      techniqueSummaryRu: 'Техника snapshot',
      techniqueSummaryEn: 'Technique snapshot',
      commonMistakeRu: 'Ошибка',
      commonMistakeEn: 'Mistake',
      easierVariantRu: 'Сократите амплитуду и сохраняйте опору.',
      easierVariantEn: 'Reduce range and keep support.',
      breathingRu: 'Выдыхайте на усилии.',
      breathingEn: 'Exhale on effort.',
      stopConditionsRu: 'Остановитесь при острой боли или головокружении.',
      stopConditionsEn: 'Stop on sharp pain or dizziness.',
      easierVariantKey: null,
      media: [],
    };
  }
}

function createStack(engine: FakeWorkoutEngine, db = createDb()) {
  const sessions = new WorkoutSessionRepository(db);
  const catalog = new FakeCatalogReleases();
  const service = new WorkoutSessionService(sessions, engine as never, db, catalog as never);
  return { db, sessions, service, engine };
}

async function ensureSessionMigration() {
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'WorkoutSession'
    ) AS exists`,
  );
  if (exists.rows[0]?.exists) return;
  const path = resolve(process.cwd(), 'prisma/migrations/209_workout-v2-01c-session-execution/migration.sql');
  if (!existsSync(path)) {
    throw new Error('WorkoutSession table missing and migration 209 not found — run migrations first');
  }
  await pool.query(readFileSync(path, 'utf8'));
}

async function insertUser(userId: string, email: string) {
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    userId,
    email,
  ]);
}

async function insertPlanWithDay(input: {
  planId: string;
  userId: string;
  version: number;
  dayIndex: number;
  exerciseName: string;
  dayTitle?: string;
  planDayId?: string;
  exerciseId?: string | null;
}): Promise<string> {
  await pool.query(
    `INSERT INTO "WorkoutPlan" (
       id, "userId", version, status, "algorithmVersion", "inputSnapshotJson", "generatedAt"
     ) VALUES ($1, $2, $3, 'active', 'test-01c', '{}'::jsonb, now())
     ON CONFLICT (id) DO NOTHING`,
    [input.planId, input.userId, input.version],
  );
  const planDayId = input.planDayId ?? randomUUID();
  await pool.query(
    `INSERT INTO "WorkoutPlanDay" (
       id, "workoutPlanId", "dayIndex", "exerciseOrder", "exerciseName", "riskLevel",
       "dayTitle", "isRestDay", sets, "repsMin", "repsMax", "restSeconds", "exerciseId"
     ) VALUES ($1, $2, $3, 0, $4, 'low', $5, false, 2, 8, 12, 60, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      planDayId,
      input.planId,
      input.dayIndex,
      input.exerciseName,
      input.dayTitle ?? `Day ${input.dayIndex}`,
      input.exerciseId ?? null,
    ],
  );
  return planDayId;
}

async function countActive(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "WorkoutSession" WHERE "userId" = $1 AND status = 'ACTIVE'`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function cleanupUsers(userIds: string[]) {
  if (userIds.length === 0) return;
  await pool.query(`DELETE FROM "WorkoutSession" WHERE "userId" = ANY($1::uuid[])`, [userIds]);
  await pool.query(
    `DELETE FROM "WorkoutPlanDay" WHERE "workoutPlanId" IN (
       SELECT id FROM "WorkoutPlan" WHERE "userId" = ANY($1::uuid[])
     )`,
    [userIds],
  );
  await pool.query(`DELETE FROM "WorkoutPlan" WHERE "userId" = ANY($1::uuid[])`, [userIds]);
  await pool.query(`DELETE FROM "User" WHERE id = ANY($1::uuid[])`, [userIds]);
}

describe('WORKOUT-V2-01C workout session persistence', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const userC = randomUUID();
  const userD = randomUUID();
  const userE = randomUUID();
  const userF = randomUUID();
  const userG = randomUUID();
  const userH = randomUUID();
  const userI = randomUUID();
  const allUsers = [userA, userB, userC, userD, userE, userF, userG, userH, userI];

  const planA = randomUUID();
  const planB = randomUUID();
  const planC = randomUUID();
  const planD = randomUUID();
  const planE = randomUUID();
  const planF = randomUUID();
  const planG = randomUUID();
  const planH = randomUUID();
  const planI = randomUUID();

  const exerciseCatalogId = randomUUID();
  let planDayForFk: string;
  let planDayForCatalog: string;

  beforeAll(async () => {
    await ensureSessionMigration();

    for (const [id, email] of [
      [userA, `ws-01c-a-${userA}@test.local`],
      [userB, `ws-01c-b-${userB}@test.local`],
      [userC, `ws-01c-c-${userC}@test.local`],
      [userD, `ws-01c-d-${userD}@test.local`],
      [userE, `ws-01c-e-${userE}@test.local`],
      [userF, `ws-01c-f-${userF}@test.local`],
      [userG, `ws-01c-g-${userG}@test.local`],
      [userH, `ws-01c-h-${userH}@test.local`],
      [userI, `ws-01c-i-${userI}@test.local`],
    ] as const) {
      await insertUser(id, email);
    }

    await insertPlanWithDay({
      planId: planA,
      userId: userA,
      version: 1,
      dayIndex: 0,
      exerciseName: 'bodyweight_squats',
    });
    await insertPlanWithDay({
      planId: planA,
      userId: userA,
      version: 1,
      dayIndex: 2,
      exerciseName: 'push_ups',
      dayTitle: 'Day 2',
    });

    await insertPlanWithDay({
      planId: planB,
      userId: userB,
      version: 1,
      dayIndex: 0,
      exerciseName: 'bodyweight_squats',
    });
    await insertPlanWithDay({
      planId: planC,
      userId: userC,
      version: 1,
      dayIndex: 0,
      exerciseName: 'push_ups',
    });
    await insertPlanWithDay({
      planId: planD,
      userId: userD,
      version: 1,
      dayIndex: 1,
      exerciseName: 'bodyweight_squats',
    });
    await insertPlanWithDay({
      planId: planE,
      userId: userE,
      version: 1,
      dayIndex: 0,
      exerciseName: 'plank',
    });

    planDayForFk = await insertPlanWithDay({
      planId: planF,
      userId: userF,
      version: 1,
      dayIndex: 0,
      exerciseName: 'lunges',
    });

    await pool.query(
      `INSERT INTO "Exercise" (
         id, name, key, "displayNameRu", "displayNameEn",
         "techniqueSummaryRu", "techniqueSummaryEn", "riskLevel"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'low')
       ON CONFLICT (id) DO NOTHING`,
      [
        exerciseCatalogId,
        'catalog_squat',
        'catalog_squat',
        'Присед каталог',
        'Catalog squat',
        'Техника каталога',
        'Catalog technique',
      ],
    );
    planDayForCatalog = await insertPlanWithDay({
      planId: planG,
      userId: userG,
      version: 1,
      dayIndex: 0,
      exerciseName: 'catalog_squat',
      exerciseId: exerciseCatalogId,
    });

    await insertPlanWithDay({
      planId: planH,
      userId: userH,
      version: 1,
      dayIndex: 3,
      exerciseName: 'rows',
      dayTitle: 'Moved day',
    });
    await insertPlanWithDay({
      planId: planI,
      userId: userI,
      version: 1,
      dayIndex: 0,
      exerciseName: 'skip_target',
    });
  }, 60_000);

  afterAll(async () => {
    await cleanupUsers(allUsers);
    await pool.query(`DELETE FROM "Exercise" WHERE id = $1`, [exerciseCatalogId]);
    await pool.end();
  });

  it('01C parallel start same day yields one ACTIVE session', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planA;
    engine.dayIndex = 0;
    engine.days = [makeDay(0), makeDay(2, { exerciseKey: 'push_ups' })];

    const dbA = createDb();
    const dbB = createDb();
    const stackA = createStack(engine, dbA);
    const stackB = createStack(engine, dbB);

    const [first, second] = await Promise.all([
      startUntilReady(stackA.service, userA, { dayIndex: 0 }),
      startUntilReady(stackB.service, userA, { dayIndex: 0 }),
    ]);

    expect(first.id).toBe(second.id);
    expect(first.status).toBe('ACTIVE');
    expect(await countActive(userA)).toBe(1);
  });

  it('01C parallel start different days: one ACTIVE + conflict', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planA;
    engine.dayIndex = 0;
    engine.days = [makeDay(0), makeDay(2, { exerciseKey: 'push_ups' })];

    // Ensure clean slate for this user (prior test may have left ACTIVE).
    await pool.query(`DELETE FROM "WorkoutSession" WHERE "userId" = $1`, [userA]);

    const stackA = createStack(engine, createDb());
    const stackB = createStack(engine, createDb());

    const settled = await Promise.allSettled([
      startUntilReady(stackA.service, userA, { dayIndex: 0 }),
      startUntilReady(stackB.service, userA, { dayIndex: 2 }),
    ]);

    const fulfilled = settled.filter((item) => item.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<WorkoutSessionService['start']>>
    >[];
    const rejected = settled.filter((item) => item.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]!.value.status).toBe('ACTIVE');
    expect(rejected[0]!.reason).toBeInstanceOf(WorkoutActiveSessionConflictError);
    expect((rejected[0]!.reason as WorkoutActiveSessionConflictError).activeSessionId).toBe(
      fulfilled[0]!.value.id,
    );
    expect(await countActive(userA)).toBe(1);
  });

  it('01C parallel start two users both succeed', async () => {
    const engineA = new FakeWorkoutEngine();
    engineA.planId = planB;
    engineA.dayIndex = 0;
    engineA.days = [makeDay(0)];

    const engineB = new FakeWorkoutEngine();
    engineB.planId = planC;
    engineB.dayIndex = 0;
    engineB.days = [makeDay(0, { exerciseKey: 'push_ups' })];

    const stackA = createStack(engineA, createDb());
    const stackB = createStack(engineB, createDb());

    const [sessionA, sessionB] = await Promise.all([
      startUntilReady(stackA.service, userB, { dayIndex: 0 }),
      startUntilReady(stackB.service, userC, { dayIndex: 0 }),
    ]);

    expect(sessionA.status).toBe('ACTIVE');
    expect(sessionB.status).toBe('ACTIVE');
    expect(sessionA.id).not.toBe(sessionB.id);
    expect(await countActive(userB)).toBe(1);
    expect(await countActive(userC)).toBe(1);
  });

  it('01C network retry start returns existing session', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planD;
    engine.dayIndex = 1;
    engine.days = [makeDay(1)];

    const { service } = createStack(engine, createDb());
    const first = await service.start(userD, { dayIndex: 1 });
    const second = await service.start(userD, { dayIndex: 1 });

    expect(second.id).toBe(first.id);
    expect(await countActive(userD)).toBe(1);
  });

  it('01C concurrent complete and abandon produce single terminal', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planE;
    engine.dayIndex = 0;
    engine.days = [makeDay(0, { exerciseKey: 'plank' })];

    const dbA = createDb();
    const dbB = createDb();
    const stackA = createStack(engine, dbA);
    const stackB = createStack(engine, dbB);

    const session = await stackA.service.start(userE, { dayIndex: 0 });
    await expect(stackA.service.complete(userE, session.id)).rejects.toBeInstanceOf(
      WorkoutSessionIncompleteError,
    );

    const settled = await Promise.allSettled([
      stackA.service.complete(userE, session.id, { confirmIncomplete: true }),
      stackB.service.abandon(userE, session.id),
    ]);
    expect(settled).toHaveLength(2);

    const row = await pool.query<{
      status: string;
      completedAt: Date | null;
      abandonedAt: Date | null;
    }>(`SELECT status, "completedAt", "abandonedAt" FROM "WorkoutSession" WHERE id = $1`, [session.id]);
    const final = row.rows[0]!;
    expect(['COMPLETED', 'ABANDONED']).toContain(final.status);
    expect(final.status).not.toBe('ACTIVE');
    expect(!(final.completedAt != null && final.abandonedAt != null)).toBe(true);

    const hydrated = await stackA.sessions.findByIdForUser(userE, session.id);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.exercises.length).toBeGreaterThan(0);
    expect(hydrated!.exercises[0]!.sets.length).toBeGreaterThan(0);
  });

  it('01C snapshot survives plan regeneration mutation', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planF;
    engine.dayIndex = 0;
    engine.days = [
      makeDay(0, {
        exerciseKey: 'lunges',
        planDayRowId: planDayForFk,
      }),
    ];

    const { service, sessions } = createStack(engine, createDb());
    const session = await service.start(userF, { dayIndex: 0 });
    const originalRu = session.exercises[0]!.displayNameRu;
    const originalTechnique = session.exercises[0]!.techniqueSummaryRu;
    expect(originalRu).toBe('RU:lunges');
    expect(originalTechnique).toBe('Техника snapshot');

    await pool.query(
      `UPDATE "WorkoutPlanDay" SET "exerciseName" = 'mutated_name', "dayTitle" = 'Mutated'
       WHERE "workoutPlanId" = $1`,
      [planF],
    );
    await pool.query(`DELETE FROM "WorkoutPlanDay" WHERE "workoutPlanId" = $1`, [planF]);
    const newPlanId = randomUUID();
    await insertPlanWithDay({
      planId: newPlanId,
      userId: userF,
      version: 2,
      dayIndex: 0,
      exerciseName: 'brand_new_exercise',
      dayTitle: 'Regenerated',
    });
    await pool.query(`UPDATE "WorkoutPlan" SET status = 'superseded' WHERE id = $1`, [planF]);

    const reloaded = await sessions.findByIdForUser(userF, session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.exercises[0]!.displayNameRu).toBe(originalRu);
    expect(reloaded!.exercises[0]!.techniqueSummaryRu).toBe(originalTechnique);
    expect(reloaded!.exercises[0]!.displayNameRu).not.toBe('RU:brand_new_exercise');
  });

  it('01C snapshot survives Exercise catalog edit', async () => {
    const db = createDb();
    const sessions = new WorkoutSessionRepository(db);

    const created = await sessions.createSnapshotSession({
      userId: userG,
      workoutPlanId: planG,
      sourceDayIndex: 0,
      effectiveDayIndex: 0,
      effectiveDate: new Date().toISOString().slice(0, 10),
      dayTitle: 'Catalog day',
      estimatedMinutes: 25,
      exercises: [
        {
          sourceExerciseId: exerciseCatalogId,
          sourcePlanDayRowId: planDayForCatalog,
          exerciseKey: 'catalog_squat',
          orderIndex: 0,
          displayNameRu: 'Снимок присед',
          displayNameEn: 'Snapshot squat',
          targetSets: 1,
          targetRepsMin: 10,
          targetRepsMax: 10,
          targetDurationSeconds: null,
          restSeconds: 45,
          techniqueSummaryRu: 'Снимок техника',
          techniqueSummaryEn: 'Snapshot technique',
          commonMistakeRu: 'Снимок ошибка',
          commonMistakeEn: 'Snapshot mistake',
          easierVariantRu: null,
          easierVariantEn: null,
          media: [],
        },
      ],
    });

    await pool.query(
      `UPDATE "Exercise"
       SET "displayNameRu" = 'ИЗМЕНЕНО',
           "displayNameEn" = 'CHANGED',
           "techniqueSummaryRu" = 'новая техника',
           "techniqueSummaryEn" = 'new technique'
       WHERE id = $1`,
      [exerciseCatalogId],
    );

    const reloaded = await sessions.findByIdForUser(userG, created.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.exercises[0]!.displayNameRu).toBe('Снимок присед');
    expect(reloaded!.exercises[0]!.techniqueSummaryRu).toBe('Снимок техника');
    expect(reloaded!.exercises[0]!.displayNameEn).toBe('Snapshot squat');
  });

  it('01C snapshot survives plan day FK nulling', async () => {
    const db = createDb();
    const sessions = new WorkoutSessionRepository(db);
    const planDayId = randomUUID();
    const planId = randomUUID();
    await insertPlanWithDay({
      planId,
      userId: userH,
      version: 9,
      dayIndex: 0,
      exerciseName: 'fk_null_probe',
      planDayId,
    });

    const created = await sessions.createSnapshotSession({
      userId: userH,
      workoutPlanId: planId,
      sourceDayIndex: 0,
      effectiveDayIndex: 0,
      effectiveDate: new Date().toISOString().slice(0, 10),
      dayTitle: 'FK day',
      estimatedMinutes: 20,
      exercises: [
        {
          sourceExerciseId: null,
          sourcePlanDayRowId: planDayId,
          exerciseKey: 'fk_null_probe',
          orderIndex: 0,
          displayNameRu: 'FK снимок',
          displayNameEn: 'FK snapshot',
          targetSets: 1,
          targetRepsMin: 5,
          targetRepsMax: 5,
          targetDurationSeconds: null,
          restSeconds: 30,
          techniqueSummaryRu: 'FK техника',
          techniqueSummaryEn: 'FK technique',
          commonMistakeRu: null,
          commonMistakeEn: null,
          easierVariantRu: null,
          easierVariantEn: null,
          media: [],
        },
      ],
    });

    await pool.query(`DELETE FROM "WorkoutPlanDay" WHERE id = $1`, [planDayId]);

    const fkRow = await pool.query<{ sourcePlanDayRowId: string | null }>(
      `SELECT "sourcePlanDayRowId" FROM "WorkoutSessionExercise" WHERE "sessionId" = $1`,
      [created.id],
    );
    expect(fkRow.rows[0]?.sourcePlanDayRowId).toBeNull();

    const reloaded = await sessions.findByIdForUser(userH, created.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.exercises[0]!.displayNameRu).toBe('FK снимок');
    expect(reloaded!.exercises[0]!.techniqueSummaryRu).toBe('FK техника');
  });

  it('01C MOVE_DAY provenance sourceDayIndex differs from effective', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planH;
    engine.dayIndex = 3;
    engine.days = [
      makeDay(3, {
        exerciseKey: 'rows',
        sourceDayIndex: 1,
        dayTitle: 'Moved strength',
      }),
    ];

    const { service } = createStack(engine, createDb());
    // Clear any sessions from FK test on same user.
    await pool.query(`DELETE FROM "WorkoutSession" WHERE "userId" = $1`, [userH]);

    const session = await service.start(userH, { dayIndex: 3 });
    expect(session.sourceDayIndex).toBe(1);
    expect(session.effectiveDayIndex).toBe(3);
  });

  it('01C skipped exercise rejects set mutation with WORKOUT_EXERCISE_SKIPPED', async () => {
    const engine = new FakeWorkoutEngine();
    engine.planId = planI;
    engine.dayIndex = 0;
    engine.days = [makeDay(0, { exerciseKey: 'skip_target' })];

    const { service } = createStack(engine, createDb());
    const session = await service.start(userI, { dayIndex: 0 });
    const exercise = session.exercises[0]!;

    await service.skipExercise(userI, session.id, exercise.id);
    await expect(
      service.updateSet(userI, session.id, exercise.id, 1, { completed: true, actualReps: 8 }),
    ).rejects.toThrow(/WORKOUT_EXERCISE_SKIPPED/);
  });
});
