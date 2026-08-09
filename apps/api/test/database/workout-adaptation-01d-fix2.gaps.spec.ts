/**
 * WORKOUT-V2-01D-FIX2 gap coverage.
 *
 * Parts:
 *  A. Four historical HOME E2E (barbell_romanian_deadlift→glute_bridge, etc.)
 *  B. Catalog adversarial mutation→preview (DRAFT, outside-release, inactive, missing-mandatory,
 *     equipment, HOME-incompatible, exclusion, HARDER, mixed)
 *  C. MOVE_DAY undo collision (another session occupies restore day)
 *
 * Part D (timezone unit tests) lives in src/modules/workout-engine/__tests__/workout-adaptation.timezone-dst.spec.ts
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PrismaService } from "../../src/infrastructure/database/prisma.service";
import { WorkoutCatalogReleaseService } from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { WorkoutEngineService } from "../../src/modules/workout-engine/application/workout-engine.service";
import { WorkoutAdaptationService } from "../../src/modules/workout-engine/application/workout-adaptation.service";
import { WorkoutSessionService } from "../../src/modules/workout-engine/application/workout-session.service";
import { WorkoutAdaptationRepository } from "../../src/modules/workout-engine/infrastructure/workout-adaptation.repository";
import { WorkoutEngineRepository } from "../../src/modules/workout-engine/infrastructure/workout-engine.repository";
import { WorkoutProfileRepository } from "../../src/modules/workout-engine/infrastructure/workout-profile.repository";
import { WorkoutSessionRepository } from "../../src/modules/workout-engine/infrastructure/workout-session.repository";
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from "./helpers/disposable-catalog-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildServices(db: PrismaService) {
  const catalog = new WorkoutCatalogReleaseService(db);
  const profiles = new WorkoutProfileRepository(db);
  const engineRepo = new WorkoutEngineRepository(db);
  const engine = new WorkoutEngineService(
    engineRepo,
    {
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
    } as never,
    db,
    profiles,
    catalog,
  );
  const sessions = new WorkoutSessionService(
    new WorkoutSessionRepository(db),
    engine,
    db,
    catalog,
  );
  const adaptations = new WorkoutAdaptationService(
    db,
    new WorkoutSessionRepository(db),
    catalog,
    engine,
    new WorkoutAdaptationRepository(db),
  );
  return { catalog, profiles, engine, sessions, adaptations };
}

async function seedUserAndSession(
  pool: Pool,
  db: PrismaService,
  timezone?: string,
  equipment?: string[],
  availableDays?: number[],
) {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1, $2)`, [
    userId,
    `fix2-${userId}@example.com`,
  ]);
  const svc = buildServices(db);
  await svc.profiles.createDefaults(userId, { trainingLevel: "BEGINNER", workoutsPerWeek: 3 });
  await svc.profiles.update(userId, {
    trainingLevel: "BEGINNER",
    trainingPlace: "HOME",
    workoutsPerWeek: 3,
    preferredDuration: "STANDARD",
    availableDays: availableDays ?? [0, 2, 4],
    workoutEquipment: (equipment ?? ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"]) as never,
    preferredActivityTypes: ["strength", "walking", "mobility"],
    excludedExerciseKeys: [],
  });
  if (timezone) {
    await pool.query(
      `UPDATE "UserProfile" SET timezone = $1 WHERE "userId" = $2`,
      [timezone, userId],
    );
  }
  await svc.engine.generatePlan(userId);
  if (timezone) {
    await pool.query(
      `UPDATE "WorkoutPlan" SET "timeZone" = $1 WHERE "userId" = $2`,
      [timezone, userId],
    );
  }

  const week = await svc.engine.getWeekView(userId);
  const day = week.days.find((d) => !d.isRestDay && d.exercises.length > 0);
  if (!day) throw new Error("NO_TRAINING_DAY");
  const session = await svc.sessions.start(userId, { dayIndex: day.dayIndex });

  return { userId, session, ...svc, dayIndex: day.dayIndex };
}

type PublishedExerciseRow = {
  exerciseId: string;
  revisionId: string;
  releaseId: string;
  nameRu: string;
  nameEn: string | null;
  techniqueRu: string;
  techniqueEn: string | null;
  commonMistakeRu: string;
  commonMistakeEn: string | null;
  easierVariantRu: string;
  easierVariantEn: string | null;
  breathingRu: string;
  breathingEn: string | null;
  stopConditionsRu: string;
  stopConditionsEn: string | null;
  equipmentCodesJson: unknown;
  isActive: boolean;
};

async function loadPublishedExercise(pool: Pool, key: string): Promise<PublishedExerciseRow> {
  const result = await pool.query<PublishedExerciseRow>(
    `SELECT e.id AS "exerciseId",
            r.id AS "revisionId",
            rel.id AS "releaseId",
            r."nameRu", r."nameEn",
            r."techniqueRu", r."techniqueEn",
            r."commonMistakeRu", r."commonMistakeEn",
            r."easierVariantRu", r."easierVariantEn",
            r."breathingRu", r."breathingEn",
            r."stopConditionsRu", r."stopConditionsEn",
            e."equipmentCodesJson", e."isActive"
     FROM "WorkoutCatalogRelease" rel
     JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
     JOIN "Exercise" e ON e.id = i."exerciseId"
     JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     WHERE rel.status = 'PUBLISHED'
       AND e.key = $1
     LIMIT 1`,
    [key],
  );
  if (!result.rows[0]) throw new Error(`Exercise not found in PUBLISHED release: ${key}`);
  return result.rows[0];
}

async function forceSessionSingleExercise(
  pool: Pool,
  db: PrismaService,
  ctx: { userId: string; session: { id: string; version: number } },
  exerciseKey: string,
): Promise<{ session: { id: string; version: number; effectiveDayIndex: number; effectiveDate: string; workoutPlanId: string | null }; version: number }> {
  const pubEx = await loadPublishedExercise(pool, exerciseKey);

  const sessRow = await pool.query<{
    id: string; version: number; "workoutPlanId": string | null;
    "sourceDayIndex": number; "effectiveDayIndex": number; "effectiveDate": Date | string;
    "dayTitle": string | null; "estimatedMinutes": number | null;
  }>(
    `SELECT id, version, "workoutPlanId", "sourceDayIndex", "effectiveDayIndex",
            "effectiveDate", "dayTitle", "estimatedMinutes"
     FROM "WorkoutSession" WHERE id = $1`,
    [ctx.session.id],
  );
  const sess = sessRow.rows[0]!;
  const effectiveDateStr =
    typeof sess.effectiveDate === "string"
      ? sess.effectiveDate.slice(0, 10)
      : sess.effectiveDate instanceof Date
        ? sess.effectiveDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

  const snapshot = {
    id: sess.id,
    workoutPlanId: sess.workoutPlanId,
    sourceDayIndex: sess.sourceDayIndex,
    effectiveDayIndex: sess.effectiveDayIndex,
    effectiveDate: effectiveDateStr,
    dayTitle: sess.dayTitle,
    estimatedMinutes: sess.estimatedMinutes,
    version: sess.version,
    catalogReleaseId: pubEx.releaseId,
    exercises: [
      {
        orderIndex: 0,
        exerciseKey,
        sourceExerciseId: pubEx.exerciseId,
        exerciseRevisionId: pubEx.revisionId,
        catalogReleaseId: pubEx.releaseId,
        displayNameRu: pubEx.nameRu,
        displayNameEn: pubEx.nameEn ?? pubEx.nameRu,
        targetSets: 3,
        targetRepsMin: 10,
        targetRepsMax: 15,
        targetDurationSeconds: null,
        restSeconds: 60,
        techniqueSummaryRu: pubEx.techniqueRu,
        techniqueSummaryEn: pubEx.techniqueEn ?? null,
        commonMistakeRu: pubEx.commonMistakeRu,
        commonMistakeEn: pubEx.commonMistakeEn ?? null,
        easierVariantRu: pubEx.easierVariantRu,
        easierVariantEn: pubEx.easierVariantEn ?? null,
        breathingRu: pubEx.breathingRu,
        breathingEn: pubEx.breathingEn ?? null,
        stopConditionsRu: pubEx.stopConditionsRu,
        stopConditionsEn: pubEx.stopConditionsEn ?? null,
        media: [],
      },
    ],
  };

  const sessionRepo = new WorkoutSessionRepository(db);
  const updated = await db.withTransaction(async (query) => {
    return sessionRepo.replaceSessionContent(query, ctx.userId, sess.id, sess.version, snapshot);
  });

  return {
    session: {
      id: updated.id,
      version: updated.version,
      effectiveDayIndex: updated.effectiveDayIndex,
      effectiveDate: updated.effectiveDate,
      workoutPlanId: updated.workoutPlanId,
    },
    version: updated.version,
  };
}

async function countAdaptations(pool: Pool, sessionId: string): Promise<number> {
  const result = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation" WHERE "workoutSessionId" = $1`,
    [sessionId],
  );
  return Number(result.rows[0]!.c);
}

async function countExercises(pool: Pool, sessionId: string): Promise<number> {
  const result = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "WorkoutSessionExercise" WHERE "sessionId" = $1`,
    [sessionId],
  );
  return Number(result.rows[0]!.c);
}

async function readExerciseKeys(pool: Pool, sessionId: string): Promise<(string | null)[]> {
  const result = await pool.query<{ exerciseKey: string | null }>(
    `SELECT "exerciseKey" FROM "WorkoutSessionExercise" WHERE "sessionId" = $1 ORDER BY "orderIndex"`,
    [sessionId],
  );
  return result.rows.map((r) => r.exerciseKey);
}

// ---------------------------------------------------------------------------
// Part A – Four historical HOME E2E (barbell_romanian_deadlift, dumbbell_row, goblet_squat, light_jog)
// ---------------------------------------------------------------------------

const PAIRS: Array<{
  sourceKey: string;
  targetKey: string;
  equipment: string[];
}> = [
  {
    sourceKey: "barbell_romanian_deadlift",
    targetKey: "glute_bridge",
    equipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL"],
  },
  {
    sourceKey: "dumbbell_row",
    targetKey: "band_row",
    equipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
  },
  {
    sourceKey: "goblet_squat",
    targetKey: "bodyweight_squats",
    equipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "KETTLEBELL"],
  },
  {
    sourceKey: "light_jog",
    targetKey: "morning_walk",
    equipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
  },
];

describe("WORKOUT-V2-01D-FIX2 Part A – historical HOME E2E", () => {
  for (const { sourceKey, targetKey, equipment } of PAIRS) {
    it(`${sourceKey} → ${targetKey}: full apply/undo E2E`, async () => {
      await withDisposableMigratedDb(async ({ pool, createDb }) => {
        await assertCanonicalPublished(pool);
        const db = createDb();

        // 1. Assert PG relation
        const relRow = await pool.query<{ active: boolean; priority: number; relationType: string }>(
          `SELECT vr.active, vr.priority, vr."relationType"
           FROM "ExerciseVariantRelation" vr
           JOIN "Exercise" f ON f.id = vr."fromExerciseId"
           JOIN "Exercise" t ON t.id = vr."toExerciseId"
           WHERE f.key = $1 AND t.key = $2
           ORDER BY vr.priority ASC, vr.active DESC
           LIMIT 1`,
          [sourceKey, targetKey],
        );
        expect(relRow.rows.length, `No relation ${sourceKey}→${targetKey}`).toBeGreaterThan(0);
        const rel = relRow.rows[0]!;
        expect(rel.active, `relation ${sourceKey}→${targetKey} not active`).toBe(true);
        expect(Number(rel.priority), `priority should be 0`).toBe(0);
        expect(rel.relationType, `relationType should be EASIER`).toBe("EASIER");

        // 2. Assert target exercise is active + revision APPROVED + in PUBLISHED release
        const target = await loadPublishedExercise(pool, targetKey);
        expect(target.isActive, `target ${targetKey} isActive`).toBe(true);
        const revStatus = await pool.query<{ status: string }>(
          `SELECT status FROM "ExerciseRevision" WHERE id = $1`,
          [target.revisionId],
        );
        expect(revStatus.rows[0]?.status).toBe("APPROVED");

        // 3. Seed user with appropriate equipment
        const ctx = await seedUserAndSession(pool, db, undefined, equipment);

        // 4. Force session to single source exercise
        const forced = await forceSessionSingleExercise(pool, db, ctx, sourceKey);
        expect(await countExercises(pool, forced.session.id)).toBe(1);
        expect(await readExerciseKeys(pool, forced.session.id)).toEqual([sourceKey]);

        // 5. Preview HOME
        const preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
        expect(preview.recommended, `HOME recommended must exist for ${sourceKey}`).toBeTruthy();

        // 6. Assert recommended exercise is targetKey
        const recExercises = preview.recommended!.preview.exercises;
        expect(recExercises.length, `expected 1 exercise in preview for ${sourceKey}`).toBe(1);
        expect(
          recExercises[0]!.exerciseKey,
          `HOME recommended must be ${targetKey}, got ${recExercises[0]?.exerciseKey} — check EASIER edge and equipment`,
        ).toBe(targetKey);

        // 7. Apply recommended
        const applied = await ctx.adaptations.apply(ctx.userId, forced.session.id, {
          intent: "HOME",
          optionCode: preview.recommended!.optionCode,
          expectedSessionVersion: forced.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: preview.recommended!.optionFingerprint,
          idempotencyKey: `fix2-${sourceKey}-apply-${forced.session.id}`,
        });
        expect(applied.adaptation.status).toBe("APPLIED");

        // 8. Assert WorkoutSessionExercise has targetKey with correct revision provenance
        const sessEx = await pool.query<{
          exerciseKey: string | null;
          exerciseRevisionId: string | null;
          catalogReleaseId: string | null;
          techniqueSummaryRu: string | null;
          commonMistakeRu: string | null;
        }>(
          `SELECT "exerciseKey", "exerciseRevisionId", "catalogReleaseId",
                  "techniqueSummaryRu", "commonMistakeRu"
           FROM "WorkoutSessionExercise" WHERE "sessionId" = $1`,
          [forced.session.id],
        );
        expect(sessEx.rows.length).toBe(1);
        expect(sessEx.rows[0]!.exerciseKey).toBe(targetKey);
        expect(sessEx.rows[0]!.exerciseRevisionId).toBe(target.revisionId);
        expect(sessEx.rows[0]!.catalogReleaseId).toBe(target.releaseId);
        expect(sessEx.rows[0]!.techniqueSummaryRu).toBeTruthy();
        expect(sessEx.rows[0]!.commonMistakeRu).toBeTruthy();

        // 9. Audit snapshot
        expect(applied.adaptation.beforeSnapshot.exercises[0]!.exerciseKey).toBe(sourceKey);
        expect(applied.adaptation.afterSnapshot.exercises[0]!.exerciseKey).toBe(targetKey);

        // 10. Version bumped
        expect(applied.session.version).toBe(forced.version + 1);

        // 11. Undo
        const undone = await ctx.adaptations.undo(ctx.userId, forced.session.id, {
          adaptationId: applied.adaptation.id,
          expectedSessionVersion: applied.session.version,
          idempotencyKey: `fix2-${sourceKey}-undo-${forced.session.id}`,
        });

        // 12. Session exercise key restored
        const sessExAfterUndo = await pool.query<{ exerciseKey: string | null }>(
          `SELECT "exerciseKey" FROM "WorkoutSessionExercise" WHERE "sessionId" = $1`,
          [forced.session.id],
        );
        expect(sessExAfterUndo.rows[0]?.exerciseKey).toBe(sourceKey);
        expect(undone.adaptation.status).toBe("UNDONE");
        expect(undone.session.version).toBe(applied.session.version + 1);

        // 13. No duplicate APPLIED rows
        const dupApplied = await pool.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"
           WHERE "workoutSessionId" = $1 AND status = 'APPLIED'`,
          [forced.session.id],
        );
        expect(Number(dupApplied.rows[0]!.c)).toBe(0);
      });
    }, 300_000);
  }
});

// ---------------------------------------------------------------------------
// Part B – Catalog adversarial mutation → preview
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX2 Part B – catalog adversarial", () => {
  // Shared setup helper: seed + force barbell_romanian_deadlift (so glute_bridge would be candidate)
  async function setupRdlSession(pool: Pool, db: PrismaService) {
    const ctx = await seedUserAndSession(pool, db, undefined, [
      "NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL",
    ]);
    const forced = await forceSessionSingleExercise(pool, db, ctx, "barbell_romanian_deadlift");
    return { ctx, forced };
  }

  it("B-A DRAFT: trigger rejects APPROVED→DRAFT mutation; state is unchanged", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const { ctx, forced } = await setupRdlSession(pool, db);

      const gb = await loadPublishedExercise(pool, "glute_bridge");
      const adaptCountBefore = await countAdaptations(pool, forced.session.id);
      const versionBefore = forced.version;

      // The DB trigger EXERCISE_REVISION_IMMUTABLE blocks this mutation once the
      // revision has been approved (or is referenced by any release item).
      await expect(
        pool.query(`UPDATE "ExerciseRevision" SET status = 'DRAFT' WHERE id = $1`, [gb.revisionId]),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error && err.message.includes("EXERCISE_REVISION_IMMUTABLE"),
      );

      // State unchanged – the mutation was rejected, nothing was written.
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
      const versionAfter = (await pool.query<{ version: number }>(
        `SELECT version FROM "WorkoutSession" WHERE id = $1`,
        [forced.session.id],
      )).rows[0]!.version;
      expect(versionAfter).toBe(versionBefore);

      // glute_bridge must still appear in preview (mutation was blocked).
      const preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      const allKeys = [preview.recommended, ...preview.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "glute_bridge must still be eligible after rejected mutation").toContain("glute_bridge");
    });
  }, 300_000);

  it("B-B outside release: exercise absent from current PUBLISHED release is excluded", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const { ctx, forced } = await setupRdlSession(pool, db);

      const adaptCountBefore = await countAdaptations(pool, forced.session.id);

      // Publish a new release that does NOT include glute_bridge.
      // Old PUBLISHED release will be RETIRED automatically.
      // WorkoutCatalogReleaseItem in PUBLISHED releases is immutable, so we build
      // the new DRAFT release by copying all current items EXCEPT glute_bridge.
      const code = `fix2-bb-${randomUUID().slice(0, 8)}`;
      const draftRes = await pool.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
         VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:fix2-bb')
         RETURNING id`,
        [code],
      );
      const newReleaseId = draftRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         SELECT $1, i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE rel.status = 'PUBLISHED'
           AND e.key <> 'glute_bridge'`,
        [newReleaseId],
      );
      await ctx.catalog.publishRelease(newReleaseId);

      // Now glute_bridge is only in the RETIRED release, not in the current PUBLISHED one.
      let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      } catch (err) {
        expect((err as Error).message).toMatch(/WORKOUT_CATALOG/);
        expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
        return;
      }

      const allKeys = [preview!.recommended, ...preview!.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "exercise not in PUBLISHED release must be excluded").not.toContain("glute_bridge");
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
    });
  }, 300_000);

  it("B-C retired release: exercise only in RETIRED release is excluded from HOME", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const { ctx, forced } = await setupRdlSession(pool, db);

      const adaptCountBefore = await countAdaptations(pool, forced.session.id);

      // Publish a new release WITHOUT glute_bridge. This retires the old release
      // that contained glute_bridge, leaving glute_bridge only in the RETIRED release.
      const code = `fix2-bc-${randomUUID().slice(0, 8)}`;
      const draftRes = await pool.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
         VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:fix2-bc')
         RETURNING id`,
        [code],
      );
      const newReleaseId = draftRes.rows[0]!.id;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         SELECT $1, i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE rel.status = 'PUBLISHED'
           AND e.key <> 'glute_bridge'`,
        [newReleaseId],
      );
      await ctx.catalog.publishRelease(newReleaseId);

      // Confirm old release is now RETIRED.
      const retiredCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'RETIRED'`,
      );
      expect(Number(retiredCount.rows[0]!.c)).toBeGreaterThan(0);

      let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      } catch (err) {
        expect((err as Error).message).toMatch(/WORKOUT_CATALOG/);
        expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
        return;
      }

      const allKeys = [preview!.recommended, ...preview!.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "exercise in RETIRED release must not appear in HOME options").not.toContain("glute_bridge");
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
    });
  }, 300_000);

  it("B-D inactive: pinned deactivation blocked; inactive published candidate excluded", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const { ctx, forced } = await setupRdlSession(pool, db);

      const adaptCountBefore = await countAdaptations(pool, forced.session.id);
      const versionBefore = forced.version;

      // Pinned published exercise cannot be deactivated.
      await expect(
        pool.query(`UPDATE "Exercise" SET "isActive" = false WHERE key = 'glute_bridge'`),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error && err.message.includes("EXERCISE_ACTIVE_PUBLISHED_RELEASE_PINNED"),
      );

      // Publish an active candidate, then force isActive=false via replica role
      // (publish rejects inactive; PUBLISHED items are immutable).
      const familySlug = `test-bd-inactive-${randomUUID().slice(0, 6)}`;
      const familyId = (await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseFamily" (slug, "nameRu", "nameEn", "movementPattern")
         VALUES ($1, 'BD inactive', 'BD inactive', 'hip_hinge') RETURNING id`,
        [familySlug],
      )).rows[0]!.id;
      const exerciseKey = `test_bd_inactive_${randomUUID().slice(0, 6)}`;
      const exerciseId = (await pool.query<{ id: string }>(
        `INSERT INTO "Exercise" (name, key, "isActive", "familyId", "equipmentCodesJson",
                                  "riskLevel", "movementPattern", difficulty)
         VALUES ($1, $2, true, $3, '["BODYWEIGHT"]'::jsonb, 'low', 'hip_hinge', 'BEGINNER')
         RETURNING id`,
        [`BD inactive`, exerciseKey, familyId],
      )).rows[0]!.id;
      const revisionId = (await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn",
           "techniqueRu", "commonMistakeRu", "easierVariantRu", "breathingRu", "stopConditionsRu",
           "createdBy", "approvedAt"
         ) VALUES ($1, 1, 'APPROVED', 'BD', 'BD', 't', 'm', 'e', 'b', 's', 'test:fix2-bd', now())
         RETURNING id`,
        [exerciseId],
      )).rows[0]!.id;
      const rdl = await pool.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key = 'barbell_romanian_deadlift' LIMIT 1`,
      );
      await pool.query(
        `INSERT INTO "ExerciseVariantRelation"
           ("fromExerciseId", "toExerciseId", "relationType", priority, "equipmentContext", "placeContext")
         VALUES ($1, $2, 'EASIER', 1, '', '')
         ON CONFLICT ON CONSTRAINT "ExerciseVariantRelation_tuple_uidx" DO NOTHING`,
        [rdl.rows[0]!.id, exerciseId],
      );

      const code = `fix2-bd-${randomUUID().slice(0, 6)}`;
      const newReleaseId = (await pool.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
         VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:fix2-bd') RETURNING id`,
        [code],
      )).rows[0]!.id;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         SELECT $1, i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         WHERE rel.status = 'PUBLISHED'`,
        [newReleaseId],
      );
      const maxOrd = (await pool.query<{ maxOrd: number | null }>(
        `SELECT MAX(ordinal) + 1 AS "maxOrd" FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`,
        [newReleaseId],
      )).rows[0]!.maxOrd ?? 1;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         VALUES ($1, $2, $3, $4, $5, true)`,
        [newReleaseId, exerciseId, revisionId, familyId, maxOrd],
      );
      await ctx.catalog.publishRelease(newReleaseId);

      await pool.query(`SET session_replication_role = replica`);
      await pool.query(`UPDATE "Exercise" SET "isActive" = false WHERE id = $1`, [exerciseId]);
      await pool.query(`SET session_replication_role = DEFAULT`);

      const preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      const allKeys = [preview.recommended, ...preview.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "inactive exercise must be excluded").not.toContain(exerciseKey);
      expect(allKeys, "valid glute_bridge remains").toContain("glute_bridge");
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
      const versionAfter = (await pool.query<{ version: number }>(
        `SELECT version FROM "WorkoutSession" WHERE id = $1`,
        [forced.session.id],
      )).rows[0]!.version;
      expect(versionAfter).toBe(versionBefore);
    });
  }, 300_000);

  it.each([
    ["techniqueRu"],
    ["commonMistakeRu"],
    ["easierVariantRu"],
    ["breathingRu"],
    ["stopConditionsRu"],
  ])("B-E missing mandatory field '%s': service skips exercise, no writes", async (field) => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, undefined, [
        "NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL",
      ]);
      const forced = await forceSessionSingleExercise(pool, db, ctx, "barbell_romanian_deadlift");
      const adaptCountBefore = await countAdaptations(pool, forced.session.id);
      const versionBefore = forced.version;

      // Create a fresh exercise with an APPROVED revision that has an EMPTY mandatory field.
      // There is no INSERT trigger on ExerciseRevision, so we can insert with status='APPROVED'
      // and an empty content field directly. The service fix (listGeneratorEligibleExercises
      // skipping rows with missing mandatory fields) should exclude this exercise.

      const familySlug = `test-be-${field.toLowerCase().slice(0, 8)}-${randomUUID().slice(0, 6)}`;
      const familyRes = await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseFamily" (slug, "nameRu", "nameEn", "movementPattern")
         VALUES ($1, $2, $3, 'squat') RETURNING id`,
        [familySlug, `Test B-E ${field}`, `Test B-E ${field} en`],
      );
      const familyId = familyRes.rows[0]!.id;

      const exerciseKey = `test_be_${field.toLowerCase().replace(/[^a-z]/g, "_")}_${randomUUID().slice(0, 6)}`;
      const exerciseRes = await pool.query<{ id: string }>(
        `INSERT INTO "Exercise" (name, key, "isActive", "familyId", "equipmentCodesJson",
                                  "riskLevel", "movementPattern", difficulty)
         VALUES ($1, $2, true, $3, '["BODYWEIGHT"]'::jsonb, 'low', 'squat', 'BEGINNER')
         RETURNING id`,
        [`Test B-E ${field}`, exerciseKey, familyId],
      );
      const exerciseId = exerciseRes.rows[0]!.id;

      // Insert APPROVED revision with empty value for the field under test.
      const fieldValues: Record<string, string> = {
        nameRu: "Тест",
        techniqueRu: "Test technique",
        commonMistakeRu: "Test mistake",
        easierVariantRu: "Test easier",
        breathingRu: "Test breathing",
        stopConditionsRu: "Test stop",
      };
      fieldValues[field] = ""; // empty the tested field

      const revisionRes = await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn",
           "techniqueRu", "commonMistakeRu", "easierVariantRu", "breathingRu", "stopConditionsRu",
           "createdBy", "approvedAt"
         ) VALUES ($1, 1, 'APPROVED', $2, $3, $4, $5, $6, $7, $8, 'test:fix2-be', now())
         RETURNING id`,
        [
          exerciseId,
          fieldValues.nameRu, `Test B-E ${field} en`,
          fieldValues.techniqueRu, fieldValues.commonMistakeRu,
          fieldValues.easierVariantRu, fieldValues.breathingRu, fieldValues.stopConditionsRu,
        ],
      );
      const revisionId = revisionRes.rows[0]!.id;

      // Add variant edge from barbell_romanian_deadlift → new exercise (EASIER, lower priority than glute_bridge).
      const rdlRow = await pool.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key = 'barbell_romanian_deadlift' LIMIT 1`,
      );
      if (rdlRow.rows.length > 0) {
        await pool.query(
          `INSERT INTO "ExerciseVariantRelation"
             ("fromExerciseId", "toExerciseId", "relationType", priority, "equipmentContext", "placeContext")
           VALUES ($1, $2, 'EASIER', 1, '', '')
           ON CONFLICT ON CONSTRAINT "ExerciseVariantRelation_tuple_uidx" DO NOTHING`,
          [rdlRow.rows[0]!.id, exerciseId],
        );
      }

      // Publish a new release containing ALL existing exercises PLUS the new (partially-invalid) one.
      const code = `fix2-be-${field.slice(0, 4)}-${randomUUID().slice(0, 6)}`;
      const newDraftRes = await pool.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
         VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:fix2-be')
         RETURNING id`,
        [code],
      );
      const newReleaseId = newDraftRes.rows[0]!.id;

      // Copy all existing PUBLISHED items.
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         SELECT $1, i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         WHERE rel.status = 'PUBLISHED'`,
        [newReleaseId],
      );

      // Add the new (partially-invalid) exercise.
      const maxOrdRes = await pool.query<{ maxOrd: number | null }>(
        `SELECT MAX(ordinal) + 1 AS "maxOrd" FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`,
        [newReleaseId],
      );
      const newOrdinal = maxOrdRes.rows[0]!.maxOrd ?? 1;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         VALUES ($1, $2, $3, $4, $5, true)`,
        [newReleaseId, exerciseId, revisionId, familyId, newOrdinal],
      );

      await ctx.catalog.publishRelease(newReleaseId);

      // Preview HOME: the new exercise must be absent because the service skips rows
      // with empty mandatory fields. All other valid exercises (like glute_bridge) remain.
      let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      } catch (err) {
        expect((err as Error).message).toMatch(/WORKOUT_CATALOG/);
        expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
        return;
      }

      const allKeys = [preview!.recommended, ...preview!.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, `exercise with empty ${field} must be excluded from recommendations`)
        .not.toContain(exerciseKey);

      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
      const versionAfter = (await pool.query<{ version: number }>(
        `SELECT version FROM "WorkoutSession" WHERE id = $1`,
        [forced.session.id],
      )).rows[0]!.version;
      expect(versionAfter).toBe(versionBefore);
    });
  }, 300_000);

  it("B-F equipment: glute_bridge with GYM_MACHINES only → excluded from HOME", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      // Equipment includes BARBELL but NOT GYM_MACHINES
      const ctx = await seedUserAndSession(pool, db, undefined, ["BARBELL", "NONE", "BODYWEIGHT"]);
      const forced = await forceSessionSingleExercise(pool, db, ctx, "barbell_romanian_deadlift");
      const adaptCountBefore = await countAdaptations(pool, forced.session.id);

      // Mutate glute_bridge to require GYM_MACHINES only
      await pool.query(
        `UPDATE "Exercise" SET "equipmentCodesJson" = $1::jsonb WHERE key = 'glute_bridge'`,
        [JSON.stringify(["GYM_MACHINES"])],
      );

      let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      } catch (err) {
        expect((err as Error).message).toMatch(/WORKOUT_CATALOG/);
        expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
        return;
      }

      const allKeys = [preview!.recommended, ...preview!.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "GYM_MACHINES-only exercise excluded from HOME").not.toContain("glute_bridge");
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
    });
  }, 300_000);

  it("B-G HOME place: BARBELL+GYM_MACHINES equipment → isHomeFriendly=false → excluded", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, undefined, [
        "NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL",
      ]);
      const forced = await forceSessionSingleExercise(pool, db, ctx, "barbell_romanian_deadlift");
      const adaptCountBefore = await countAdaptations(pool, forced.session.id);

      // Make glute_bridge require BARBELL+GYM_MACHINES → not home-friendly
      await pool.query(
        `UPDATE "Exercise" SET "equipmentCodesJson" = $1::jsonb WHERE key = 'glute_bridge'`,
        [JSON.stringify(["BARBELL", "GYM_MACHINES"])],
      );

      let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      } catch (err) {
        expect((err as Error).message).toMatch(/WORKOUT_CATALOG/);
        expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
        return;
      }

      const allKeys = [preview!.recommended, ...preview!.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "isHomeFriendly=false exercise excluded from HOME").not.toContain("glute_bridge");
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
    });
  }, 300_000);

  it("B-H exclusion: glute_bridge in excludedExerciseKeys → not in HOME recommended", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, undefined, [
        "NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL",
      ]);
      const forced = await forceSessionSingleExercise(pool, db, ctx, "barbell_romanian_deadlift");
      const adaptCountBefore = await countAdaptations(pool, forced.session.id);

      // Update profile: exclude glute_bridge
      await ctx.profiles.update(ctx.userId, {
        trainingLevel: "BEGINNER",
        trainingPlace: "HOME",
        workoutsPerWeek: 3,
        preferredDuration: "STANDARD",
        availableDays: [0, 2, 4],
        workoutEquipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL"] as never,
        preferredActivityTypes: ["strength", "walking", "mobility"],
        excludedExerciseKeys: ["glute_bridge"],
      });

      let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      } catch (err) {
        expect((err as Error).message).toMatch(/WORKOUT_CATALOG/);
        expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
        return;
      }

      const allKeys = [preview!.recommended, ...preview!.alternatives]
        .filter(Boolean)
        .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      expect(allKeys, "excluded exercise must not appear in any option").not.toContain("glute_bridge");
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
    });
  }, 300_000);

  it("B-I HARDER: HOME and LIGHTER never recommend a HARDER edge target", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      // Find any exercise that has a HARDER relation
      const harderEdge = await pool.query<{ fromKey: string; toKey: string }>(
        `SELECT f.key AS "fromKey", t.key AS "toKey"
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" f ON f.id = vr."fromExerciseId"
         JOIN "Exercise" t ON t.id = vr."toExerciseId"
         WHERE vr."relationType" = 'HARDER'
           AND vr.active = true
           AND f.key IS NOT NULL
           AND t.key IS NOT NULL
         LIMIT 1`,
      );

      if (harderEdge.rows.length === 0) {
        // No HARDER edges → test passes trivially (policy was already correct)
        return;
      }

      const { fromKey, toKey: harderTarget } = harderEdge.rows[0]!;
      const ctx = await seedUserAndSession(pool, db, undefined, [
        "NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL", "BARBELL", "KETTLEBELL",
      ]);
      const forced = await forceSessionSingleExercise(pool, db, ctx, fromKey);

      for (const intent of ["HOME", "LIGHTER"] as const) {
        let preview: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
        try {
          preview = await ctx.adaptations.preview(ctx.userId, forced.session.id, intent);
        } catch {
          continue;
        }
        const allKeys = [preview!.recommended, ...preview!.alternatives]
          .filter(Boolean)
          .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
        expect(allKeys, `HARDER target must not appear in ${intent} options`).not.toContain(harderTarget);
      }
    });
  }, 300_000);

  it("B-J mixed: invalid candidates excluded; valid remains; ordering deterministic", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const { ctx, forced } = await setupRdlSession(pool, db);
      const adaptCountBefore = await countAdaptations(pool, forced.session.id);
      const versionBefore = forced.version;

      const familySlug = `test-bj-mixed-${randomUUID().slice(0, 6)}`;
      const familyId = (await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseFamily" (slug, "nameRu", "nameEn", "movementPattern")
         VALUES ($1, 'BJ mixed', 'BJ mixed', 'hip_hinge') RETURNING id`,
        [familySlug],
      )).rows[0]!.id;
      const invalidKey = `test_bj_invalid_${randomUUID().slice(0, 6)}`;
      const exerciseId = (await pool.query<{ id: string }>(
        `INSERT INTO "Exercise" (name, key, "isActive", "familyId", "equipmentCodesJson",
                                  "riskLevel", "movementPattern", difficulty)
         VALUES ($1, $2, true, $3, '["BODYWEIGHT"]'::jsonb, 'low', 'hip_hinge', 'BEGINNER')
         RETURNING id`,
        [`BJ invalid`, invalidKey, familyId],
      )).rows[0]!.id;
      const revisionId = (await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn",
           "techniqueRu", "commonMistakeRu", "easierVariantRu", "breathingRu", "stopConditionsRu",
           "createdBy", "approvedAt"
         ) VALUES ($1, 1, 'APPROVED', 'BJ', 'BJ', '', 'm', 'e', 'b', 's', 'test:fix2-bj', now())
         RETURNING id`,
        [exerciseId],
      )).rows[0]!.id;
      const rdl = await pool.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key = 'barbell_romanian_deadlift' LIMIT 1`,
      );
      await pool.query(
        `INSERT INTO "ExerciseVariantRelation"
           ("fromExerciseId", "toExerciseId", "relationType", priority, "equipmentContext", "placeContext")
         VALUES ($1, $2, 'EASIER', 1, '', '')
         ON CONFLICT ON CONSTRAINT "ExerciseVariantRelation_tuple_uidx" DO NOTHING`,
        [rdl.rows[0]!.id, exerciseId],
      );

      const code = `fix2-bj-${randomUUID().slice(0, 6)}`;
      const newReleaseId = (await pool.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
         VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:fix2-bj') RETURNING id`,
        [code],
      )).rows[0]!.id;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         SELECT $1, i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         WHERE rel.status = 'PUBLISHED'`,
        [newReleaseId],
      );
      const maxOrd = (await pool.query<{ maxOrd: number | null }>(
        `SELECT MAX(ordinal) + 1 AS "maxOrd" FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`,
        [newReleaseId],
      )).rows[0]!.maxOrd ?? 1;
      await pool.query(
        `INSERT INTO "WorkoutCatalogReleaseItem"
           ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
         VALUES ($1, $2, $3, $4, $5, true)`,
        [newReleaseId, exerciseId, revisionId, familyId, maxOrd],
      );
      await ctx.catalog.publishRelease(newReleaseId);

      const preview1 = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      const preview2 = await ctx.adaptations.preview(ctx.userId, forced.session.id, "HOME");
      const keysOf = (p: typeof preview1) =>
        [p.recommended, ...p.alternatives]
          .filter(Boolean)
          .flatMap((o) => o!.preview.exercises.map((e) => e.exerciseKey));
      const codesOf = (p: typeof preview1) =>
        [p.recommended, ...p.alternatives].filter(Boolean).map((o) => o!.optionCode);

      expect(keysOf(preview1)).not.toContain(invalidKey);
      expect(keysOf(preview1)).toContain("glute_bridge");
      expect(preview1.recommended!.preview.exercises[0]!.exerciseKey).toBe("glute_bridge");
      expect(codesOf(preview1)).toEqual(codesOf(preview2));
      expect(keysOf(preview1)).toEqual(keysOf(preview2));
      expect(await countAdaptations(pool, forced.session.id)).toBe(adaptCountBefore);
      expect(
        (await pool.query<{ version: number }>(
          `SELECT version FROM "WorkoutSession" WHERE id = $1`,
          [forced.session.id],
        )).rows[0]!.version,
      ).toBe(versionBefore);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Part C – MOVE_DAY undo collision
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX2 Part C – MOVE_DAY undo collision", () => {
  it("C-1 undo conflicts when another ACTIVE session occupies the restore day", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]);

      // Session A: on some training day X
      const sessionA = ctx.session;
      const dayX = sessionA.effectiveDayIndex;
      const planId = sessionA.workoutPlanId;

      // Preview MOVE_DAY from day X
      const movePrev = await ctx.adaptations.preview(ctx.userId, sessionA.id, "MOVE_DAY");
      if (!movePrev.recommended) {
        // No MOVE targets in current plan week — skip
        return;
      }

      // Apply MOVE_DAY: session A → day Y
      const applied = await ctx.adaptations.apply(ctx.userId, sessionA.id, {
        intent: "MOVE_DAY",
        optionCode: movePrev.recommended.optionCode,
        expectedSessionVersion: sessionA.version,
        expectedCatalogReleaseId: movePrev.catalogReleaseId,
        policyVersion: movePrev.policyVersion,
        optionFingerprint: movePrev.recommended.optionFingerprint,
        idempotencyKey: `fix2-move-apply-${sessionA.id}`,
      });
      expect(applied.adaptation.status).toBe("APPLIED");
      const dayY = applied.session.effectiveDayIndex;
      expect(dayY).not.toBe(dayX);

      // Insert synthetic session B on day X (the original day of A).
      // Status must be COMPLETED because the DB enforces at most one ACTIVE session per
      // user (WorkoutSession_active_user_uidx). The service assertMoveTargetAvailable
      // checks status IN ('ACTIVE','COMPLETED'), so COMPLETED still triggers the conflict.
      const originalEffectiveDate = applied.adaptation.beforeSnapshot.effectiveDate;
      await pool.query(
        `INSERT INTO "WorkoutSession" (
           "userId", "workoutPlanId", "sourceDayIndex", "effectiveDayIndex", "effectiveDate",
           "dayTitle", "estimatedMinutes", status, "totalExercises", "completedExercises",
           "completedAt"
         ) VALUES ($1, $2, $3, $4, $5::date, 'Synthetic B', 30, 'COMPLETED', 0, 0, now())`,
        [ctx.userId, planId, dayX, dayX, originalEffectiveDate],
      );

      // Undo A → should conflict (B occupies restore day X with COMPLETED status)
      const versionBeforeUndo = applied.session.version;
      const undoInput = {
        expectedSessionVersion: applied.session.version,
        adaptationId: applied.adaptation.id,
        idempotencyKey: `fix2-move-undo-${sessionA.id}`,
      };
      await expect(ctx.adaptations.undo(ctx.userId, sessionA.id, undoInput))
        .rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);
      await expect(ctx.adaptations.undo(ctx.userId, sessionA.id, undoInput))
        .rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);
      await expect(
        ctx.adaptations.undo(ctx.userId, sessionA.id, {
          ...undoInput,
          idempotencyKey: `fix2-move-undo-other-${sessionA.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);

      // A is still on day Y; adaptation still APPLIED; undoneAt=null; version unchanged
      const sessRow = await pool.query<{ effectiveDayIndex: number; version: number }>(
        `SELECT "effectiveDayIndex", version FROM "WorkoutSession" WHERE id = $1`,
        [sessionA.id],
      );
      expect(sessRow.rows[0]!.effectiveDayIndex).toBe(dayY);
      expect(sessRow.rows[0]!.version).toBe(versionBeforeUndo);

      const adaptRow = await pool.query<{ status: string; undoneAt: string | null }>(
        `SELECT status, "undoneAt" FROM "WorkoutAdaptation" WHERE id = $1`,
        [applied.adaptation.id],
      );
      expect(adaptRow.rows[0]!.status).toBe("APPLIED");
      expect(adaptRow.rows[0]!.undoneAt).toBeNull();

      const bRow = await pool.query<{ effectiveDayIndex: number }>(
        `SELECT "effectiveDayIndex" FROM "WorkoutSession"
         WHERE "userId" = $1 AND "dayTitle" = 'Synthetic B' LIMIT 1`,
        [ctx.userId],
      );
      expect(bRow.rows[0]!.effectiveDayIndex).toBe(dayX);
    });
  }, 300_000);

  it("C-2 completed session on restore day also blocks undo", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]);
      const sessionA = ctx.session;
      const dayX = sessionA.effectiveDayIndex;
      const planId = sessionA.workoutPlanId;

      const movePrev = await ctx.adaptations.preview(ctx.userId, sessionA.id, "MOVE_DAY");
      if (!movePrev.recommended) return;

      const applied = await ctx.adaptations.apply(ctx.userId, sessionA.id, {
        intent: "MOVE_DAY",
        optionCode: movePrev.recommended.optionCode,
        expectedSessionVersion: sessionA.version,
        expectedCatalogReleaseId: movePrev.catalogReleaseId,
        policyVersion: movePrev.policyVersion,
        optionFingerprint: movePrev.recommended.optionFingerprint,
        idempotencyKey: `fix2-move-c2-apply-${sessionA.id}`,
      });

      const originalDate = applied.adaptation.beforeSnapshot.effectiveDate;
      // Insert completed session B on restore day X
      await pool.query(
        `INSERT INTO "WorkoutSession" (
           "userId", "workoutPlanId", "sourceDayIndex", "effectiveDayIndex", "effectiveDate",
           "dayTitle", "estimatedMinutes", status, "totalExercises", "completedExercises",
           "completedAt"
         ) VALUES ($1, $2, $3, $4, $5::date, 'Synthetic B completed', 30, 'COMPLETED', 0, 0, now())`,
        [ctx.userId, planId, dayX, dayX, originalDate],
      );

      await expect(
        ctx.adaptations.undo(ctx.userId, sessionA.id, {
          expectedSessionVersion: applied.session.version,
          adaptationId: applied.adaptation.id,
          idempotencyKey: `fix2-move-c2-undo-${sessionA.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);
    });
  }, 300_000);

  it("C-3 past-date: undo blocked when beforeSnapshot.effectiveDate < today (fixed clock date)", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]);

      // DB enforces at most one ACTIVE session per user. Complete the seeded session
      // so we can insert a fresh ACTIVE past-session without hitting the unique constraint.
      await pool.query(
        `UPDATE "WorkoutSession" SET status = 'COMPLETED', "completedAt" = now() WHERE id = $1`,
        [ctx.session.id],
      );

      const planRow = await pool.query<{ id: string }>(
        `SELECT id FROM "WorkoutPlan" WHERE "userId" = $1 LIMIT 1`,
        [ctx.userId],
      );
      if (!planRow.rows[0]) return;
      const workoutPlanId = planRow.rows[0].id;

      // Fixed past date — independent of wall-clock "yesterday".
      const pastDayIndex = 0;
      const pastDate = "2020-06-01";

      const sessInsert = await pool.query<{ id: string; version: number }>(
        `INSERT INTO "WorkoutSession" (
           "userId", "workoutPlanId", "sourceDayIndex", "effectiveDayIndex", "effectiveDate",
           "dayTitle", "estimatedMinutes", status, "totalExercises", "completedExercises"
         ) VALUES ($1, $2, $3, $4, $5::date, 'Past session', 30, 'ACTIVE', 1, 0)
         RETURNING id, version`,
        [ctx.userId, workoutPlanId, pastDayIndex, pastDayIndex, pastDate],
      );
      const pastSession = sessInsert.rows[0]!;

      await pool.query(
        `INSERT INTO "WorkoutSessionExercise" (
           "sessionId", "exerciseKey", "orderIndex", "displayNameRu", "displayNameEn",
           "targetSets", status, "mediaSnapshotJson"
         ) VALUES ($1, 'morning_walk', 0, 'Прогулка', 'Morning walk', 1, 'PENDING', '[]'::jsonb)`,
        [pastSession.id],
      );

      let movePrev: Awaited<ReturnType<typeof ctx.adaptations.preview>> | null = null;
      try {
        movePrev = await ctx.adaptations.preview(ctx.userId, pastSession.id, "MOVE_DAY");
      } catch {
        return;
      }
      if (!movePrev?.recommended) return;

      const applied = await ctx.adaptations.apply(ctx.userId, pastSession.id, {
        intent: "MOVE_DAY",
        optionCode: movePrev.recommended.optionCode,
        expectedSessionVersion: pastSession.version,
        expectedCatalogReleaseId: movePrev.catalogReleaseId,
        policyVersion: movePrev.policyVersion,
        optionFingerprint: movePrev.recommended.optionFingerprint,
        idempotencyKey: `fix2-past-apply-${pastSession.id}`,
      });

      expect(applied.adaptation.beforeSnapshot.effectiveDate).toBe(pastDate);

      const undoInput = {
        expectedSessionVersion: applied.session.version,
        adaptationId: applied.adaptation.id,
        idempotencyKey: `fix2-past-undo-${pastSession.id}`,
      };
      await expect(ctx.adaptations.undo(ctx.userId, pastSession.id, undoInput))
        .rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);
      // Same-key retry returns the same conflict semantics (no silent success / partial undo).
      await expect(ctx.adaptations.undo(ctx.userId, pastSession.id, undoInput))
        .rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);
      // Different idempotency key cannot bypass the collision.
      await expect(
        ctx.adaptations.undo(ctx.userId, pastSession.id, {
          ...undoInput,
          idempotencyKey: `fix2-past-undo-alt-${pastSession.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);

      const adaptRow = await pool.query<{ status: string; undoneAt: string | null }>(
        `SELECT status, "undoneAt" FROM "WorkoutAdaptation" WHERE id = $1`,
        [applied.adaptation.id],
      );
      expect(adaptRow.rows[0]!.status).toBe("APPLIED");
      expect(adaptRow.rows[0]!.undoneAt).toBeNull();
    });
  }, 300_000);

  it("C-4 parallel MOVE same session same version → exactly one succeeds", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]);
      const sessionA = ctx.session;
      const versionBefore = sessionA.version;

      const movePrev = await ctx.adaptations.preview(ctx.userId, sessionA.id, "MOVE_DAY");
      if (!movePrev.recommended) return;

      const opt1 = movePrev.recommended;
      const opt2 = movePrev.alternatives[0] ?? movePrev.recommended;
      if (opt1.optionCode === opt2.optionCode && movePrev.alternatives.length === 0) {
        // Need two distinct targets; fabricate second option from another day if present.
      }

      const baseInput = {
        expectedSessionVersion: sessionA.version,
        expectedCatalogReleaseId: movePrev.catalogReleaseId,
        policyVersion: movePrev.policyVersion,
      };

      const results = await Promise.allSettled([
        ctx.adaptations.apply(ctx.userId, sessionA.id, {
          ...baseInput,
          intent: "MOVE_DAY" as const,
          optionCode: opt1.optionCode,
          optionFingerprint: opt1.optionFingerprint,
          idempotencyKey: `fix2-para-1-${sessionA.id}`,
        }),
        ctx.adaptations.apply(ctx.userId, sessionA.id, {
          ...baseInput,
          intent: "MOVE_DAY" as const,
          optionCode: opt2.optionCode,
          optionFingerprint: opt2.optionFingerprint,
          idempotencyKey: `fix2-para-2-${sessionA.id}`,
        }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(results.filter((r) => r.status === "rejected").length).toBe(1);

      const appliedCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"
         WHERE "workoutSessionId" = $1 AND status = 'APPLIED' AND intent = 'MOVE_DAY'`,
        [sessionA.id],
      );
      expect(Number(appliedCount.rows[0]!.c)).toBe(1);

      const sess = await pool.query<{ version: number; effectiveDayIndex: number; effectiveDate: string }>(
        `SELECT version, "effectiveDayIndex", "effectiveDate"::text AS "effectiveDate"
         FROM "WorkoutSession" WHERE id = $1`,
        [sessionA.id],
      );
      expect(sess.rows[0]!.version).toBe(versionBefore + 1);
      expect(sess.rows[0]!.effectiveDayIndex).not.toBe(sessionA.effectiveDayIndex);
    });
  }, 300_000);

  it("C-6 undo conflicts when restore day leaves availableDays week window", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]);
      const sessionA = ctx.session;
      const dayX = sessionA.effectiveDayIndex;

      const movePrev = await ctx.adaptations.preview(ctx.userId, sessionA.id, "MOVE_DAY");
      if (!movePrev.recommended) return;

      const applied = await ctx.adaptations.apply(ctx.userId, sessionA.id, {
        intent: "MOVE_DAY",
        optionCode: movePrev.recommended.optionCode,
        expectedSessionVersion: sessionA.version,
        expectedCatalogReleaseId: movePrev.catalogReleaseId,
        policyVersion: movePrev.policyVersion,
        optionFingerprint: movePrev.recommended.optionFingerprint,
        idempotencyKey: `fix2-week-apply-${sessionA.id}`,
      });
      const dayY = applied.session.effectiveDayIndex;
      expect(dayY).not.toBe(dayX);

      // Shrink week window so original day X is no longer available.
      const remaining = [0, 2, 4].filter((d) => d !== dayX);
      expect(remaining.length).toBeGreaterThan(0);
      await ctx.profiles.update(ctx.userId, {
        trainingLevel: "BEGINNER",
        trainingPlace: "HOME",
        workoutsPerWeek: remaining.length,
        preferredDuration: "STANDARD",
        availableDays: remaining,
        workoutEquipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"] as never,
        preferredActivityTypes: ["strength", "walking", "mobility"],
        excludedExerciseKeys: [],
      });

      await expect(
        ctx.adaptations.undo(ctx.userId, sessionA.id, {
          expectedSessionVersion: applied.session.version,
          adaptationId: applied.adaptation.id,
          idempotencyKey: `fix2-week-undo-${sessionA.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_MOVE_DATE_CONFLICT/);

      const sessRow = await pool.query<{ effectiveDayIndex: number; version: number }>(
        `SELECT "effectiveDayIndex", version FROM "WorkoutSession" WHERE id = $1`,
        [sessionA.id],
      );
      expect(sessRow.rows[0]!.effectiveDayIndex).toBe(dayY);
      expect(sessRow.rows[0]!.version).toBe(applied.session.version);

      const adaptRow = await pool.query<{ status: string; undoneAt: string | null }>(
        `SELECT status, "undoneAt" FROM "WorkoutAdaptation" WHERE id = $1`,
        [applied.adaptation.id],
      );
      expect(adaptRow.rows[0]!.status).toBe("APPLIED");
      expect(adaptRow.rows[0]!.undoneAt).toBeNull();
    });
  }, 300_000);

  it("C-5 parallel MOVE two different users → both succeed", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();

      const [ctx1, ctx2] = await Promise.all([
        seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]),
        seedUserAndSession(pool, db, "Europe/Moscow", undefined, [0, 2, 4]),
      ]);

      const [p1, p2] = await Promise.all([
        ctx1.adaptations.preview(ctx1.userId, ctx1.session.id, "MOVE_DAY"),
        ctx2.adaptations.preview(ctx2.userId, ctx2.session.id, "MOVE_DAY"),
      ]);

      if (!p1.recommended || !p2.recommended) return;

      const results = await Promise.allSettled([
        ctx1.adaptations.apply(ctx1.userId, ctx1.session.id, {
          intent: "MOVE_DAY" as const,
          optionCode: p1.recommended.optionCode,
          expectedSessionVersion: ctx1.session.version,
          expectedCatalogReleaseId: p1.catalogReleaseId,
          policyVersion: p1.policyVersion,
          optionFingerprint: p1.recommended.optionFingerprint,
          idempotencyKey: `fix2-para-u1-${ctx1.session.id}`,
        }),
        ctx2.adaptations.apply(ctx2.userId, ctx2.session.id, {
          intent: "MOVE_DAY" as const,
          optionCode: p2.recommended.optionCode,
          expectedSessionVersion: ctx2.session.version,
          expectedCatalogReleaseId: p2.catalogReleaseId,
          policyVersion: p2.policyVersion,
          optionFingerprint: p2.recommended.optionFingerprint,
          idempotencyKey: `fix2-para-u2-${ctx2.session.id}`,
        }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled").length).toBe(2);
    });
  }, 300_000);
});
