import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { BadRequestException, HttpException } from "@nestjs/common";
import { PrismaService, type SqlQuery } from "../../src/infrastructure/database/prisma.service";
import { WorkoutCatalogReleaseService } from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { WorkoutEngineService } from "../../src/modules/workout-engine/application/workout-engine.service";
import { WorkoutEngineRepository } from "../../src/modules/workout-engine/infrastructure/workout-engine.repository";
import { WorkoutProfileRepository } from "../../src/modules/workout-engine/infrastructure/workout-profile.repository";
import { WorkoutSessionRepository } from "../../src/modules/workout-engine/infrastructure/workout-session.repository";
import { WorkoutSessionService } from "../../src/modules/workout-engine/application/workout-session.service";
import {
  WorkoutEngineController,
  mapWorkoutError,
} from "../../src/modules/workout-engine/controllers/workout-engine.controller";
import { ALGORITHM_VERSION } from "../../src/modules/workout-engine/domain/workout-plan-generator";
import {
  BOOTSTRAP_RELEASE_CODE,
  CANONICAL_RELEASE_CODE,
} from "../../src/modules/workout-engine/catalog/catalog-enums";
import { loadCanonicalContent01b } from "../../src/modules/workout-engine/catalog/canonical-content-01b.validation";
import { assertCanonicalPublished } from "./helpers/disposable-catalog-db";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://weight_app:weight_app_local@localhost:5432/weight_app";
const pool = new Pool({ connectionString });

function createDb(clientPool: Pool = pool): PrismaService {
  const query: SqlQuery = (text, values = []) => clientPool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(key1: number, key2Text: string, fn: () => Promise<unknown>) {
      const client = await clientPool.connect();
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
      const client = await clientPool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
      try {
        await client.query("BEGIN");
        const result = await fn(txQuery);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
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

async function ensureFullCatalogPublished(): Promise<{ code: string; id: string }> {
  const current = await new WorkoutCatalogReleaseService(
    createDb(),
  ).resolveCurrentPublishedRelease();
  if (current?.code === CANONICAL_RELEASE_CODE) {
    const eligible = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       JOIN "Exercise" e ON e.id = i."exerciseId"
       WHERE i."releaseId" = $1
         AND i."enabledForGenerator" = true
         AND r.status = 'APPROVED'
         AND e."isActive" = true
         AND e.key IS NOT NULL`,
      [current.id],
    );
    if (Number(eligible.rows[0]?.c) === 84) {
      return { code: current.code, id: current.id };
    }
  }

  throw new Error(
    "WORKOUT_CATALOG_CANONICAL_NOT_PUBLISHED: migration must leave workout-catalog-canonical-01b PUBLISHED with 84 eligible items",
  );
}

describe("WORKOUT-CATALOG-01B persistence", () => {
  const sot = loadCanonicalContent01b();
  let publishedCode = CANONICAL_RELEASE_CODE;

  beforeAll(async () => {
    await pool.query("SELECT 1");
    const ensured = await ensureFullCatalogPublished();
    publishedCode = ensured.code;
  });

  afterAll(async () => {
    try {
      await assertCanonicalPublished(pool);
    } finally {
      await pool.end();
    }
  });

  it("canonical release pins 84 eligible items with safety and sources", async () => {
    const publishedCount = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
    );
    expect(Number(publishedCount.rows[0]?.c)).toBe(1);

    const items = await pool.query<{
      items: string;
      enabled: string;
      approved: string;
      safety: string;
      sourced: string;
      mismatches: string;
    }>(
      `SELECT
         COUNT(i.id)::text AS items,
         COUNT(i.id) FILTER (WHERE i."enabledForGenerator")::text AS enabled,
         COUNT(i.id) FILTER (WHERE r.status = 'APPROVED')::text AS approved,
         COUNT(i.id) FILTER (WHERE sp."exerciseRevisionId" IS NOT NULL)::text AS safety,
         COUNT(i.id) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM "ExerciseSourceReference" sr WHERE sr."exerciseRevisionId" = r.id
           )
         )::text AS sourced,
         COUNT(i.id) FILTER (
           WHERE r."exerciseId" IS DISTINCT FROM i."exerciseId"
              OR e."familyId" IS DISTINCT FROM i."familyId"
         )::text AS mismatches
       FROM "WorkoutCatalogRelease" rel
       JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
       JOIN "Exercise" e ON e.id = i."exerciseId"
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       LEFT JOIN "ExerciseSafetyProfile" sp ON sp."exerciseRevisionId" = r.id
       WHERE rel.code = $1`,
      [CANONICAL_RELEASE_CODE],
    );
    expect(Number(items.rows[0]?.items)).toBe(84);
    expect(Number(items.rows[0]?.enabled)).toBe(84);
    expect(Number(items.rows[0]?.approved)).toBe(84);
    expect(Number(items.rows[0]?.safety)).toBe(84);
    expect(Number(items.rows[0]?.sourced)).toBe(84);
    expect(Number(items.rows[0]?.mismatches)).toBe(0);
  });

  it("retires bootstrap and preserves historical revision 1 for the original 20", async () => {
    const bootstrap = await pool.query<{ status: string }>(
      `SELECT status FROM "WorkoutCatalogRelease" WHERE code = $1`,
      [BOOTSTRAP_RELEASE_CODE],
    );
    expect(bootstrap.rows[0]?.status).toBe("RETIRED");

    const hist = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "ExerciseRevision" r
       JOIN "Exercise" e ON e.id = r."exerciseId"
       WHERE r."revisionNumber" = 1
         AND r.status = 'APPROVED'
         AND r."createdBy" = 'system:workout-catalog-01a'
         AND e.key = ANY($1::text[])`,
      [sot.exercises.filter((e) => e.isExistingApproved).map((e) => e.key)],
    );
    expect(Number(hist.rows[0]?.c)).toBe(20);

    const canonicalPinned = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       JOIN "Exercise" e ON e.id = i."exerciseId"
       WHERE rel.code = $1
         AND e.key = ANY($2::text[])
         AND r."revisionNumber" = 2
         AND r."createdBy" = 'system:workout-catalog-01b'`,
      [CANONICAL_RELEASE_CODE, sot.exercises.filter((e) => e.isExistingApproved).map((e) => e.key)],
    );
    expect(Number(canonicalPinned.rows[0]?.c)).toBe(20);
  });

  it("rejects mutation of frozen 01A revision content", async () => {
    await expect(
      pool.query(
        `UPDATE "ExerciseRevision"
         SET "techniqueRu" = 'mutated-by-01b-test'
         WHERE "revisionNumber" = 1
           AND "createdBy" = 'system:workout-catalog-01a'
           AND status = 'APPROVED'`,
      ),
    ).rejects.toThrow(/EXERCISE_REVISION/);
  });

  it("has 36 families, 84 unique keys, no candidate self-edges", async () => {
    const families = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "ExerciseFamily"`,
    );
    expect(Number(families.rows[0]?.c)).toBe(36);

    const keys = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "Exercise" WHERE key IS NOT NULL AND "isActive" = true`,
    );
    expect(Number(keys.rows[0]?.c)).toBe(84);

    const self = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "ExerciseVariantRelation"
       WHERE "fromExerciseId" = "toExerciseId"`,
    );
    expect(Number(self.rows[0]?.c)).toBe(0);
  });

  it("generator selection returns 84 eligible exercises from the published catalog", async () => {
    const db = createDb();
    const releaseService = new WorkoutCatalogReleaseService(db);
    const { release, exercises } = await releaseService.listGeneratorEligibleExercises();
    expect(release.code).toBe(publishedCode);
    expect(exercises.length).toBe(84);
    expect(new Set(exercises.map((e) => e.key)).size).toBe(84);
  });

  it("engine can generate a home weekly plan from the published catalog", async () => {
    const db = createDb();
    const repo = new WorkoutEngineRepository(db);
    const profiles = new WorkoutProfileRepository(db);
    const releases = new WorkoutCatalogReleaseService(db);
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
    const engine = new WorkoutEngineService(repo, profileStub as never, db, profiles, releases);

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id, email) VALUES (gen_random_uuid(), $1) RETURNING id`,
      [`01b-gen-${Date.now()}@example.com`],
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

    const plan = await engine.generatePlan(userId);
    expect(plan.algorithmVersion).toBe(ALGORITHM_VERSION);
    const persisted = await pool.query<{
      workoutCatalogReleaseCode: string | null;
      version: number;
    }>(
      `SELECT "workoutCatalogReleaseCode", version
       FROM "WorkoutPlan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1`,
      [userId],
    );
    expect(persisted.rows[0]?.workoutCatalogReleaseCode).toBe(publishedCode);
    const days = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "WorkoutPlanDay" d
       JOIN "WorkoutPlan" p ON p.id = d."workoutPlanId"
       WHERE p."userId" = $1 AND p.version = $2 AND d."isRestDay" = false`,
      [userId, persisted.rows[0]!.version],
    );
    expect(Number(days.rows[0]?.c)).toBeGreaterThanOrEqual(3);
  });

  it("generator and detail read pinned revision content, not polluted hub", async () => {
    const db = createDb();
    const catalog = new WorkoutCatalogReleaseService(db);
    const sampleKey = "bodyweight_squats";
    const before = await catalog.getPublishedExerciseDetail(sampleKey);
    const pinnedTechnique = String(before.techniqueSummaryRu);
    const hubMarker = `HUB_OLD_${randomUUID()}`;
    const rev1Marker = `REV1_OLD_${randomUUID()}`;

    await pool.query(
      `UPDATE "Exercise" SET "techniqueSummaryRu" = $2, "nameRu" = $2 WHERE key = $1`,
      [sampleKey, hubMarker],
    );
    await expect(
      pool.query(
        `UPDATE "ExerciseRevision" r
         SET "techniqueRu" = $2
         FROM "Exercise" e
         WHERE e.id = r."exerciseId" AND e.key = $1 AND r."revisionNumber" = 1`,
        [sampleKey, rev1Marker],
      ),
    ).rejects.toThrow(/EXERCISE_REVISION/);

    const detail = await catalog.getPublishedExerciseDetail(sampleKey);
    expect(detail.techniqueSummaryRu).toBe(pinnedTechnique);
    expect(String(detail.techniqueSummaryRu)).not.toContain("HUB_OLD_");
    expect(String(detail.techniqueSummaryRu)).not.toContain("REV1_OLD_");
    expect(String(detail.easierVariantRu)).not.toMatch(/^Ягодичный мост$/);

    const { exercises } = await catalog.listGeneratorEligibleExercises();
    const row = exercises.find((e) => e.key === sampleKey);
    expect(row?.techniqueSummaryRu).toBe(pinnedTechnique);
    expect(row?.techniqueSummaryRu).not.toContain("HUB_OLD_");
    expect(row?.breathingRu).toBeTruthy();
    expect(row?.stopConditionsRu).toBeTruthy();
    expect(row?.easierVariantRu).toBeTruthy();

    // Restore hub display text from pinned revision for shared DB hygiene.
    await pool.query(
      `UPDATE "Exercise" e
       SET "techniqueSummaryRu" = r."techniqueRu",
           "nameRu" = r."nameRu",
           "displayNameRu" = r."nameRu"
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       WHERE e.id = i."exerciseId"
         AND e.key = $1
         AND rel.status = 'PUBLISHED'`,
      [sampleKey],
    );
  });

  it("all 20 historical exercises expose rev2 content on generator path", async () => {
    const db = createDb();
    const catalog = new WorkoutCatalogReleaseService(db);
    const existing = sot.exercises.filter((e) => e.isExistingApproved).map((e) => e.key);
    expect(existing).toHaveLength(20);
    const { exercises } = await catalog.listGeneratorEligibleExercises();
    for (const key of existing) {
      const gen = exercises.find((e) => e.key === key);
      const sotRow = sot.exercises.find((e) => e.key === key)!;
      expect(gen?.techniqueSummaryRu).toBe(sotRow.techniqueRu);
      expect(gen?.commonMistakeRu).toBe(sotRow.commonMistakeRu);
      expect(gen?.easierVariantRu).toBe(sotRow.easierVariantRu);
      expect(gen?.breathingRu).toBe(sotRow.breathingRu);
      expect(gen?.stopConditionsRu).toBe(sotRow.stopConditionsRu);
      expect(gen?.nameRu).toBe(sotRow.nameRu);
    }
  });

  it("HTTP exercise detail resolves published revision and maps integrity errors", async () => {
    const db = createDb();
    const catalog = new WorkoutCatalogReleaseService(db);
    const engine = new WorkoutEngineService(
      new WorkoutEngineRepository(db),
      undefined,
      db,
      new WorkoutProfileRepository(db),
      catalog,
    );
    const controller = new WorkoutEngineController(engine, {} as never);
    const user = { id: "http-detail-user" } as never;
    const body = await controller.exercise(user, "glute_bridge");
    expect(body.techniqueSummaryRu).toBeTruthy();
    expect(body.breathingRu).toBeTruthy();
    expect(body.stopConditionsRu).toBeTruthy();
    expect(String(body.easierVariantRu)).not.toMatch(/^Приседания/);

    const missing = await controller
      .exercise(user, "not_in_catalog_ever")
      .catch((e: HttpException) => e);
    expect(missing).toBeInstanceOf(BadRequestException);
    expect((missing as HttpException).getResponse()).toEqual(
      expect.objectContaining({ message: "WORKOUT_EXERCISE_NOT_AVAILABLE" }),
    );

    const mapped = mapWorkoutError(new Error("WORKOUT_CATALOG_INTEGRITY_ERROR"));
    expect(mapped).toBeInstanceOf(BadRequestException);
  });

  it("preferred candidates are never HARDER and spot-check overrides", async () => {
    const preferred = await pool.query<{
      fromKey: string;
      toKey: string;
      relationType: string;
      priority: number;
    }>(
      `SELECT f.key AS "fromKey", t.key AS "toKey", vr."relationType", vr.priority
       FROM "ExerciseVariantRelation" vr
       JOIN "Exercise" f ON f.id = vr."fromExerciseId"
       JOIN "Exercise" t ON t.id = vr."toExerciseId"
       WHERE vr.active = true AND vr.priority = 0`,
    );
    expect(preferred.rows.length).toBeGreaterThan(0);
    for (const row of preferred.rows) {
      expect(row.relationType).not.toBe("HARDER");
      expect(["EASIER", "SAME_LEVEL"]).toContain(row.relationType);
    }
    const hip = preferred.rows.find((r) => r.fromKey === "bodyweight_hip_thrust");
    expect(hip?.toKey).toBe("glute_bridge");
    const lunge = preferred.rows.find((r) => r.fromKey === "supported_reverse_lunge");
    expect(lunge?.toKey).toBe("bodyweight_squats");

    for (const edge of [
      { from: "barbell_romanian_deadlift", to: "glute_bridge" },
      { from: "dumbbell_row", to: "band_row" },
      { from: "goblet_squat", to: "bodyweight_squats" },
      { from: "light_jog", to: "morning_walk" },
    ] as const) {
      const row = preferred.rows.find((r) => r.fromKey === edge.from && r.toKey === edge.to);
      expect(row?.priority).toBe(0);
    }
  });

  it("new session snapshots pinned revision guidance and stays immutable after hub mutation", async () => {
    const db = createDb();
    const repo = new WorkoutEngineRepository(db);
    const profiles = new WorkoutProfileRepository(db);
    const releases = new WorkoutCatalogReleaseService(db);
    const sessionsRepo = new WorkoutSessionRepository(db);
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
    const engine = new WorkoutEngineService(repo, profileStub as never, db, profiles, releases);
    const sessions = new WorkoutSessionService(sessionsRepo, engine, db, releases);

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id, email) VALUES (gen_random_uuid(), $1) RETURNING id`,
      [`01b-sess-${randomUUID()}@example.com`],
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

    const today = await engine.getTodayView(userId);
    const workoutDay = today.days.find((d) => !d.isRestDay && (d.exercises?.length ?? 0) > 0);
    expect(workoutDay).toBeTruthy();

    const session = await sessions.start(userId, { dayIndex: workoutDay!.dayIndex });
    const first = session.exercises[0]!;
    expect(first.techniqueSummaryRu).toBeTruthy();
    expect(first.easierVariantRu).toBeTruthy();
    expect(first.breathingRu).toBeTruthy();
    expect(first.stopConditionsRu).toBeTruthy();
    const otherNames = new Set(sot.exercises.map((e) => e.nameRu));
    expect(otherNames.has(String(first.easierVariantRu))).toBe(false);

    const snapTechnique = first.techniqueSummaryRu;
    const snapEasier = first.easierVariantRu;
    if (first.exerciseKey) {
      await pool.query(
        `UPDATE "Exercise" SET "techniqueSummaryRu" = 'HUB_AFTER_SESSION', "nameRu" = 'HUB_AFTER_SESSION'
         WHERE key = $1`,
        [first.exerciseKey],
      );
    }
    const reloaded = await sessions.getById(userId, session.id);
    const same = reloaded.exercises.find((e) => e.id === first.id)!;
    expect(same.techniqueSummaryRu).toBe(snapTechnique);
    expect(same.easierVariantRu).toBe(snapEasier);

    await sessions.abandon(userId, session.id).catch(() => undefined);
  });
});
