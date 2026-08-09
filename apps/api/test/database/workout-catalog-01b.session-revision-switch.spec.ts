import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PrismaService, type SqlQuery } from "../../src/infrastructure/database/prisma.service";
import { WorkoutCatalogReleaseService } from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { WorkoutEngineService } from "../../src/modules/workout-engine/application/workout-engine.service";
import { WorkoutEngineRepository } from "../../src/modules/workout-engine/infrastructure/workout-engine.repository";
import { WorkoutProfileRepository } from "../../src/modules/workout-engine/infrastructure/workout-profile.repository";
import { WorkoutSessionRepository } from "../../src/modules/workout-engine/infrastructure/workout-session.repository";
import { WorkoutSessionService } from "../../src/modules/workout-engine/application/workout-session.service";
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from "./helpers/disposable-catalog-db";

const TARGET_KEY = "bodyweight_squats";

const A = {
  technique: "A_TECHNIQUE",
  mistake: "A_MISTAKE",
  easier: "A_EASIER",
  breathing: "A_BREATHING",
  stop: "A_STOP",
} as const;

const B = {
  technique: "B_TECHNIQUE",
  mistake: "B_MISTAKE",
  easier: "B_EASIER",
  breathing: "B_BREATHING",
  stop: "B_STOP",
} as const;

function createDb(pool: Pool): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
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
          return { acquired: true, result: await fn() };
        } finally {
          await client.query(`SELECT pg_advisory_unlock($1, hashtext($2))`, [key1, key2Text]);
        }
      } finally {
        client.release();
      }
    },
    async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
      try {
        await client.query("BEGIN");
        const result = await fn(txQuery);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

async function createApprovedRevision(
  pool: Pool,
  exerciseId: string,
  markers: typeof A,
): Promise<string> {
  const next = await pool.query<{ n: number }>(
    `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
     FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
    [exerciseId],
  );
  const created = await pool.query<{ id: string }>(
    `INSERT INTO "ExerciseRevision" (
       "exerciseId", "revisionNumber", status,
       "nameRu", "nameEn",
       "techniqueRu", "techniqueEn",
       "commonMistakeRu", "commonMistakeEn",
       "easierVariantRu", "easierVariantEn",
       "breathingRu", "breathingEn",
       "stopConditionsRu", "stopConditionsEn",
       "createdBy"
     ) VALUES (
       $1, $2, 'DRAFT',
       'Session switch squat', 'Session switch squat',
       $3, $3, $4, $4, $5, $5, $6, $6, $7, $7,
       'test:session-revision-switch'
     ) RETURNING id`,
    [
      exerciseId,
      next.rows[0]!.n,
      markers.technique,
      markers.mistake,
      markers.easier,
      markers.breathing,
      markers.stop,
    ],
  );
  const revisionId = created.rows[0]!.id;
  await pool.query(
    `INSERT INTO "ExerciseSafetyProfile" (
       "exerciseRevisionId", "kneeLoad", "shoulderLoad", "spineLoad", "impactLevel",
       "balanceRequirement", "floorRequired", "overheadMovement", "deepKneeFlexion",
       "singleLeg", "beginnerAllowed", "requiresSpotter", "internalSafetyNote"
     ) VALUES ($1, 'LOW', 'LOW', 'LOW', 'LOW', 'LOW', false, false, true, false, true, false, 'session-switch')`,
    [revisionId],
  );
  const source = await pool.query<{ id: string }>(
    `SELECT id FROM "ExerciseCatalogSource" WHERE active = true ORDER BY code LIMIT 1`,
  );
  await pool.query(
    `INSERT INTO "ExerciseSourceReference" (
       "exerciseRevisionId", "sourceId", "externalReference", "factualNotes", "accessedAt"
     ) VALUES ($1, $2, 'https://example.org/session-switch', 'session switch fixture', now())`,
    [revisionId, source.rows[0]!.id],
  );
  await pool.query(
    `UPDATE "ExerciseRevision"
     SET status = 'APPROVED', "reviewedAt" = now()
     WHERE id = $1`,
    [revisionId],
  );
  return revisionId;
}

async function createDraftRevision(
  pool: Pool,
  exerciseId: string,
  markers: typeof B,
): Promise<string> {
  const next = await pool.query<{ n: number }>(
    `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
     FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
    [exerciseId],
  );
  const created = await pool.query<{ id: string }>(
    `INSERT INTO "ExerciseRevision" (
       "exerciseId", "revisionNumber", status,
       "nameRu", "nameEn",
       "techniqueRu", "techniqueEn",
       "commonMistakeRu", "commonMistakeEn",
       "easierVariantRu", "easierVariantEn",
       "breathingRu", "breathingEn",
       "stopConditionsRu", "stopConditionsEn",
       "createdBy"
     ) VALUES (
       $1, $2, 'DRAFT',
       'Session switch squat B', 'Session switch squat B',
       $3, $3, $4, $4, $5, $5, $6, $6, $7, $7,
       'test:session-revision-switch'
     ) RETURNING id`,
    [
      exerciseId,
      next.rows[0]!.n,
      markers.technique,
      markers.mistake,
      markers.easier,
      markers.breathing,
      markers.stop,
    ],
  );
  const revisionId = created.rows[0]!.id;
  await pool.query(
    `INSERT INTO "ExerciseSafetyProfile" (
       "exerciseRevisionId", "kneeLoad", "shoulderLoad", "spineLoad", "impactLevel",
       "balanceRequirement", "floorRequired", "overheadMovement", "deepKneeFlexion",
       "singleLeg", "beginnerAllowed", "requiresSpotter", "internalSafetyNote"
     ) VALUES ($1, 'LOW', 'LOW', 'LOW', 'LOW', 'LOW', false, false, true, false, true, false, 'session-switch-b')`,
    [revisionId],
  );
  const source = await pool.query<{ id: string }>(
    `SELECT id FROM "ExerciseCatalogSource" WHERE active = true ORDER BY code LIMIT 1`,
  );
  await pool.query(
    `INSERT INTO "ExerciseSourceReference" (
       "exerciseRevisionId", "sourceId", "externalReference", "factualNotes", "accessedAt"
     ) VALUES ($1, $2, 'https://example.org/session-switch-b', 'session switch draft B', now())`,
    [revisionId, source.rows[0]!.id],
  );
  return revisionId;
}

async function publishReleasePinningRevision(
  pool: Pool,
  catalog: WorkoutCatalogReleaseService,
  code: string,
  exerciseId: string,
  revisionId: string,
): Promise<string> {
  const draft = await pool.query<{ id: string }>(
    `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
     VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:session-revision-switch')
     RETURNING id`,
    [code],
  );
  const releaseId = draft.rows[0]!.id;
  const items = await pool.query<{
    exerciseId: string;
    exerciseRevisionId: string;
    familyId: string;
    ordinal: number;
  }>(
    `SELECT i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
     WHERE rel.status = 'PUBLISHED'
     ORDER BY i.ordinal ASC`,
  );
  for (const item of items.rows) {
    const pinRevision = item.exerciseId === exerciseId ? revisionId : item.exerciseRevisionId;
    await pool.query(
      `INSERT INTO "WorkoutCatalogReleaseItem" (
         "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
       ) VALUES ($1, $2, $3, $4, $5, true)`,
      [releaseId, item.exerciseId, pinRevision, item.familyId, item.ordinal],
    );
  }
  await catalog.publishRelease(releaseId);
  return releaseId;
}

function expectMarkers(
  exercise: {
    techniqueSummaryRu: string | null;
    commonMistakeRu: string | null;
    easierVariantRu: string | null;
    breathingRu: string | null;
    stopConditionsRu: string | null;
  },
  markers: typeof A,
) {
  expect(exercise.techniqueSummaryRu).toBe(markers.technique);
  expect(exercise.commonMistakeRu).toBe(markers.mistake);
  expect(exercise.easierVariantRu).toBe(markers.easier);
  expect(exercise.breathingRu).toBe(markers.breathing);
  expect(exercise.stopConditionsRu).toBe(markers.stop);
}

describe("WORKOUT-CATALOG-01B session revision switch immutability", () => {
  it("keeps S1/S2 on A while DRAFT B unused; S3 uses published B", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);
      const db = createDb(pool);
      const catalog = new WorkoutCatalogReleaseService(db);
      const repo = new WorkoutEngineRepository(db);
      const profiles = new WorkoutProfileRepository(db);
      const profileStub = {
        async getProfile() {
          return {
            trainingLevel: "BEGINNER",
            workoutsPerWeek: 3,
            equipmentCodes: ["BODYWEIGHT", "NONE", "RESISTANCE_BAND", "DUMBBELL"],
          };
        },
        async getGoal() {
          return { kind: "lose_weight", target: 70, unit: "kg" };
        },
      };
      const engine = new WorkoutEngineService(repo, profileStub as never, db, profiles, catalog);
      const sessions = new WorkoutSessionService(
        new WorkoutSessionRepository(db),
        engine,
        db,
        catalog,
      );

      const exercise = await pool.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key = $1`,
        [TARGET_KEY],
      );
      const exerciseId = exercise.rows[0]!.id;
      const revisionA = await createApprovedRevision(pool, exerciseId, A);
      await publishReleasePinningRevision(
        pool,
        catalog,
        `rev-a-${randomUUID()}`,
        exerciseId,
        revisionA,
      );

      const detailA = await catalog.getPublishedExerciseDetail(TARGET_KEY);
      expect(detailA.techniqueSummaryRu).toBe(A.technique);

      async function startSessionOnTarget(emailSuffix: string) {
        const user = await pool.query<{ id: string }>(
          `INSERT INTO "User" (id, email) VALUES (gen_random_uuid(), $1) RETURNING id`,
          [`sess-switch-${emailSuffix}-${randomUUID()}@example.com`],
        );
        const userId = user.rows[0]!.id;
        await profiles.createDefaults(userId, { trainingLevel: "BEGINNER", workoutsPerWeek: 3 });
        await profiles.update(userId, {
          trainingLevel: "BEGINNER",
          trainingPlace: "HOME",
          workoutsPerWeek: 3,
          preferredDuration: "STANDARD",
          availableDays: [0, 2, 4],
          workoutEquipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
          preferredActivityTypes: ["strength", "walking", "mobility"],
          excludedExerciseKeys: [],
        });
        await engine.generatePlan(userId);
        const plan = await pool.query<{ id: string; version: number }>(
          `SELECT id, version FROM "WorkoutPlan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1`,
          [userId],
        );
        const day = await pool.query<{ dayIndex: number }>(
          `SELECT "dayIndex" FROM "WorkoutPlanDay"
           WHERE "workoutPlanId" = $1 AND "isRestDay" = false
           ORDER BY "dayIndex" ASC, "exerciseOrder" ASC LIMIT 1`,
          [plan.rows[0]!.id],
        );
        await pool.query(
          `DELETE FROM "WorkoutPlanDay"
           WHERE "workoutPlanId" = $1 AND "dayIndex" = $2`,
          [plan.rows[0]!.id, day.rows[0]!.dayIndex],
        );
        await pool.query(
          `INSERT INTO "WorkoutPlanDay" (
             "workoutPlanId", "dayIndex", "exerciseOrder", "exerciseName", "riskLevel",
             "dayTitle", "isRestDay", sets, "repsMin", "repsMax", "restSeconds", "exerciseId"
           ) VALUES ($1, $2, 0, $3, 'low', $4, false, 2, 8, 12, 60, $5)`,
          [
            plan.rows[0]!.id,
            day.rows[0]!.dayIndex,
            TARGET_KEY,
            `Day ${day.rows[0]!.dayIndex}`,
            exerciseId,
          ],
        );
        const session = await sessions.start(userId, { dayIndex: day.rows[0]!.dayIndex });
        return { userId, session };
      }

      const s1 = await startSessionOnTarget("s1");
      expectMarkers(s1.session.exercises[0]!, A);

      const draftB = await createDraftRevision(pool, exerciseId, B);
      const draftStatus = await pool.query<{ status: string }>(
        `SELECT status FROM "ExerciseRevision" WHERE id = $1`,
        [draftB],
      );
      expect(draftStatus.rows[0]?.status).toBe("DRAFT");

      const s2 = await startSessionOnTarget("s2");
      expectMarkers(s2.session.exercises[0]!, A);
      expect(s2.session.exercises[0]!.techniqueSummaryRu).not.toBe(B.technique);

      await pool.query(
        `UPDATE "ExerciseRevision"
         SET status = 'APPROVED', "reviewedAt" = now()
         WHERE id = $1`,
        [draftB],
      );
      await publishReleasePinningRevision(
        pool,
        catalog,
        `rev-b-${randomUUID()}`,
        exerciseId,
        draftB,
      );

      const s3 = await startSessionOnTarget("s3");
      expectMarkers(s3.session.exercises[0]!, B);

      const reloadS1 = await sessions.getById(s1.userId, s1.session.id);
      const reloadS2 = await sessions.getById(s2.userId, s2.session.id);
      expectMarkers(reloadS1.exercises[0]!, A);
      expectMarkers(reloadS2.exercises[0]!, A);
      expect(reloadS1.exercises[0]!.techniqueSummaryRu).not.toBe(B.technique);
      expect(reloadS2.exercises[0]!.breathingRu).not.toBe(B.breathing);

      await pool.query(
        `UPDATE "Exercise"
         SET "techniqueSummaryRu" = 'HUB_MUTATED', "nameRu" = 'HUB_MUTATED'
         WHERE id = $1`,
        [exerciseId],
      );
      const afterHub1 = await sessions.getById(s1.userId, s1.session.id);
      const afterHub2 = await sessions.getById(s2.userId, s2.session.id);
      const afterHub3 = await sessions.getById(s3.userId, s3.session.id);
      expectMarkers(afterHub1.exercises[0]!, A);
      expectMarkers(afterHub2.exercises[0]!, A);
      expectMarkers(afterHub3.exercises[0]!, B);

      // Historical nullable columns remain readable and do not fall back to live revision B.
      await pool.query(
        `UPDATE "WorkoutSessionExercise"
         SET "breathingRu" = NULL, "breathingEn" = NULL,
             "stopConditionsRu" = NULL, "stopConditionsEn" = NULL
         WHERE "sessionId" = $1`,
        [s1.session.id],
      );
      const nullable = await sessions.getById(s1.userId, s1.session.id);
      expect(nullable.exercises[0]!.breathingRu).toBeNull();
      expect(nullable.exercises[0]!.stopConditionsRu).toBeNull();
      expect(nullable.exercises[0]!.techniqueSummaryRu).toBe(A.technique);
      expect(nullable.exercises[0]!.techniqueSummaryRu).not.toBe(B.technique);
      expect(nullable.exercises[0]!.breathingRu).not.toBe(B.breathing);
    });
  }, 300_000);
});
