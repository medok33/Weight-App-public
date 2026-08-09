import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.cwd(), 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require('../api/node_modules/pg') as {
  Pool: new (opts: { connectionString: string }) => {
    query: <T = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: T[] }>;
    end: () => Promise<void>;
  };
};
const { Pool } = pg;

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const password = 'WorkoutEnergy01bPass1!';
const databaseUrl = process.env.DATABASE_URL;

type SessionSet = {
  setIndex: number;
  targetReps: number | null;
  targetDurationSeconds: number | null;
};

type SessionExercise = {
  id: string;
  exerciseKey?: string | null;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSeconds: number | null;
  sets: SessionSet[];
};

type SessionResponse = {
  id: string;
  exercises: SessionExercise[];
};

async function register(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${api}/auth/register`, {
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

function todayDayIndex(now = new Date()): number {
  return (now.getDay() + 6) % 7;
}

async function ensureWorkoutReady(request: APIRequestContext): Promise<void> {
  const today = todayDayIndex();
  const extras = [0, 2, 4, 1, 3, 5, 6].filter((day) => day !== today).slice(0, 2);
  const availableDays = [today, ...extras];

  const userProfile = await request.put(`${api}/profile`, {
    data: {
      displayName: 'Workout Energy HTTP',
      ageYears: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: 'moderate',
      locale: 'ru',
    },
  });
  expect(userProfile.ok(), await userProfile.text()).toBeTruthy();

  const goal = await request.put(`${api}/goal`, {
    data: { kind: 'lose_weight', target: 72, unit: 'kg' },
  });
  expect(goal.ok(), await goal.text()).toBeTruthy();

  const profile = await request.put(`${api}/workout-plan/profile`, {
    data: {
      trainingLevel: 'BEGINNER',
      trainingPlace: 'HOME',
      workoutsPerWeek: availableDays.length,
      preferredDuration: 'STANDARD',
      availableDays,
      workoutEquipment: ['BODYWEIGHT'],
      preferredActivityTypes: [],
      excludedExerciseKeys: [],
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();

  const generate = await request.post(`${api}/workout-plan/generate`, {
    data: {},
  });
  expect(generate.ok(), await generate.text()).toBeTruthy();
}

function plannedTargets(session: SessionResponse) {
  return session.exercises.map((exercise) => ({
    exerciseId: exercise.id,
    sets: exercise.sets.map((set) => ({
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetDurationSeconds: set.targetDurationSeconds,
    })),
  }));
}

test.describe('WORKOUT-ENERGY-01B session snapshot HTTP contract', () => {
  test('planned volume is coherent, idempotent, immutable, and tenant-isolated', async ({
    playwright,
  }) => {
    expect(databaseUrl, 'DATABASE_URL required for snapshot column assertions').toBeTruthy();
    expect(process.env.WEIGHT_APP_DISPOSABLE_MODE).toMatch(/^(1|true)$/);

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const owner = await playwright.request.newContext();
    const otherUser = await playwright.request.newContext();
    const pool = new Pool({ connectionString: databaseUrl });

    try {
      await register(owner, `workout-energy-01b-owner-${stamp}@example.com`);
      await register(otherUser, `workout-energy-01b-other-${stamp}@example.com`);
      await ensureWorkoutReady(owner);

      const start = await owner.post(`${api}/workout-plan/sessions`, { data: {} });
      expect(start.ok(), await start.text()).toBeTruthy();
      const session = (await start.json()) as SessionResponse;
      expect(session.exercises.length).toBeGreaterThan(0);

      for (const exercise of session.exercises) {
        expect(exercise.sets.length).toBeGreaterThan(0);
        for (const set of exercise.sets) {
          const hasReps = set.targetReps != null;
          const hasDuration = set.targetDurationSeconds != null;
          expect(
            hasReps !== hasDuration,
            `exercise ${exercise.id} set ${set.setIndex} must have exactly one target kind`,
          ).toBe(true);
          if (hasReps) expect(set.targetReps).toBeGreaterThan(0);
          if (hasDuration) expect(set.targetDurationSeconds).toBeGreaterThan(0);
        }
        if (exercise.targetDurationSeconds != null) {
          expect(exercise.targetSets).toBe(1);
          expect(exercise.sets).toHaveLength(1);
          expect(exercise.sets[0]?.targetDurationSeconds).toBe(exercise.targetDurationSeconds);
        }
        if (exercise.targetRepsMin != null || exercise.targetRepsMax != null) {
          const exact = exercise.targetRepsMax ?? exercise.targetRepsMin;
          for (const set of exercise.sets) {
            expect(set.targetReps).toBe(exact);
          }
        }
      }
      const originalTargets = plannedTargets(session);

      const energyRows = await pool.query<{
        orderIndex: number;
        status: string | null;
        gross: string | null;
        resting: string | null;
        incremental: string | null;
        weight: string | null;
        activeSeconds: string | null;
        profileId: string | null;
        calculatedAt: Date | null;
      }>(
        `SELECT "orderIndex",
                "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "exerciseEnergyProfileId"::text AS "profileId",
                "energyCalculatedAt" AS "calculatedAt"
         FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid
         ORDER BY "orderIndex"`,
        [session.id],
      );
      expect(energyRows.rows.length).toBe(session.exercises.length);
      for (const row of energyRows.rows) {
        expect(row.status).toBeTruthy();
        if (row.status === 'AVAILABLE') {
          expect(row.gross).toBeTruthy();
          expect(row.resting).toBeTruthy();
          expect(row.incremental).toBeTruthy();
          expect(row.weight).toBeTruthy();
          expect(row.activeSeconds).toBeTruthy();
          expect(row.profileId).toBeTruthy();
          expect(row.calculatedAt).toBeTruthy();
          expect(Number(row.activeSeconds)).toBeGreaterThan(0);
        } else {
          expect(row.gross).toBeNull();
          expect(row.resting).toBeNull();
          expect(row.incremental).toBeNull();
        }
      }
      const durationExercise = session.exercises.find((exercise) => exercise.targetDurationSeconds != null);
      if (durationExercise) {
        const matched = energyRows.rows[session.exercises.indexOf(durationExercise)];
        if (matched?.activeSeconds != null) {
          expect(Number(matched.activeSeconds)).toBe(durationExercise.targetDurationSeconds);
        }
      }

      const startAgain = await owner.post(`${api}/workout-plan/sessions`, { data: {} });
      expect(startAgain.ok(), await startAgain.text()).toBeTruthy();
      const idempotentSession = (await startAgain.json()) as SessionResponse;
      expect(idempotentSession.id).toBe(session.id);

      const beforeWeight = energyRows.rows.map((row) => ({ ...row }));
      const weightUpdate = await owner.post(`${api}/progress`, {
        data: {
          weightKg: 93,
          measuredAt: new Date().toISOString(),
        },
      });
      expect(weightUpdate.ok(), await weightUpdate.text()).toBeTruthy();

      const getAfterWeightUpdate = await owner.get(
        `${api}/workout-plan/sessions/${session.id}`,
      );
      expect(getAfterWeightUpdate.ok(), await getAfterWeightUpdate.text()).toBeTruthy();
      const unchangedSession = (await getAfterWeightUpdate.json()) as SessionResponse;
      expect(plannedTargets(unchangedSession)).toEqual(originalTargets);

      const afterWeight = await pool.query<(typeof energyRows.rows)[number]>(
        `SELECT "orderIndex",
                "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "exerciseEnergyProfileId"::text AS "profileId",
                "energyCalculatedAt" AS "calculatedAt"
         FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid
         ORDER BY "orderIndex"`,
        [session.id],
      );
      expect(afterWeight.rows).toEqual(beforeWeight);

      const crossTenantRead = await otherUser.get(
        `${api}/workout-plan/sessions/${session.id}`,
      );
      expect(crossTenantRead.status()).toBe(404);
    } finally {
      await owner.dispose();
      await otherUser.dispose();
      await pool.end();
    }
  });
});
