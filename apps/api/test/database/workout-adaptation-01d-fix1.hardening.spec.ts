/**
 * WORKOUT-V2-01D-FIX1 hardening test matrix.
 *
 * All tests run against a disposable migrated DB (no shared state).
 * Test groups:
 *  1. Migration 213 check
 *  2. Audit immutability – raw SQL adversarial attacks on WorkoutAdaptation
 *  3. Idempotency key semantics
 *  4. Concurrency (session lock isolation)
 *  5. Stale catalog detection
 *  6. Undo conflicts
 *  7. Catalog adversarial (DRAFT/RETIRED exclusion)
 *  8. Four historical HOME variant relations
 *  9. Full publish-switch e2e scenario
 * 10. Apply after undo
 * 11. MOVE_DAY timezone basics
 * 12. Completed session / ownership / forced cleanup
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
import { runSqlMigrations } from "../../scripts/lib/sql-migration-runner.mjs";
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from "./helpers/disposable-catalog-db";
import { WORKOUT_ADAPTATION_LOCK_NAMESPACE } from "../../src/modules/workout-engine/domain/workout-adaptation.types";

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

async function seedUser(pool: Pool, emailPrefix = "fix1") {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1, $2)`, [
    userId,
    `${emailPrefix}-${userId}@example.com`,
  ]);
  return userId;
}

async function seedUserAndSession(pool: Pool, db: PrismaService, timezone?: string) {
  const userId = await seedUser(pool, "fix1");
  const svc = buildServices(db);

  await svc.profiles.createDefaults(userId, { trainingLevel: "BEGINNER", workoutsPerWeek: 3 });
  await svc.profiles.update(userId, {
    trainingLevel: "BEGINNER",
    trainingPlace: "HOME",
    workoutsPerWeek: 3,
    preferredDuration: "STANDARD",
    availableDays: [0, 2, 4],
    workoutEquipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
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
  // The engine mock doesn't expose timezone, so WorkoutPlan.timeZone is saved as 'UTC'.
  // Sync it from UserProfile.timezone so that resolveTimeZone() short-circuits correctly.
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

/**
 * Clone the current PUBLISHED release items into a new DRAFT release and publish it.
 * The old PUBLISHED release becomes RETIRED.
 */
async function cloneAndPublishRelease(
  pool: Pool,
  catalog: WorkoutCatalogReleaseService,
  codePrefix = "test-clone",
): Promise<string> {
  const code = `${codePrefix}-${randomUUID().slice(0, 8)}`;
  const draft = await pool.query<{ id: string }>(
    `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "createdBy")
     VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1', 'test:hardening')
     RETURNING id`,
    [code],
  );
  const releaseId = draft.rows[0]!.id;
  await pool.query(
    `INSERT INTO "WorkoutCatalogReleaseItem"
       ("releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator")
     SELECT $1, i."exerciseId", i."exerciseRevisionId", i."familyId", i.ordinal, i."enabledForGenerator"
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
     WHERE rel.status = 'PUBLISHED'`,
    [releaseId],
  );
  await catalog.publishRelease(releaseId);
  return releaseId;
}

// ---------------------------------------------------------------------------
// 1. Migration 213
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – migration", () => {
  it("migration 213 is applied on fresh DB and a second run is idempotent (0 applied)", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);

      const ledger = await pool.query<{ migrationName: string }>(
        `SELECT "migrationName" FROM "SchemaMigrationLedger"
         WHERE "migrationName" = $1`,
        ["213_workout_adaptation_hardening"],
      );
      expect(ledger.rows).toHaveLength(1);

      // WorkoutAdaptationCommand table must exist.
      const tableExists = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_name = 'WorkoutAdaptationCommand'
         ) AS exists`,
      );
      expect(tableExists.rows[0]!.exists).toBe(true);

      // WorkoutPlan.timeZone column must exist.
      const colExists = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'WorkoutPlan' AND column_name = 'timeZone'
         ) AS exists`,
      );
      expect(colExists.rows[0]!.exists).toBe(true);

      // Second run of migrations must apply nothing.
      const client = await pool.connect();
      try {
        const rerun = await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
        expect(rerun.applied).toHaveLength(0);
      } finally {
        client.release();
      }
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 2. Audit immutability – adversarial raw SQL
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – WorkoutAdaptation immutability trigger", () => {
  it("blocks all adversarial UPDATE attempts on immutable fields", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(preview.recommended).toBeTruthy();
      const applied = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `immut-apply-${ctx.session.id}`,
      });
      const adaptId = applied.adaptation.id;

      // Helper: expect raw SQL to throw WORKOUT_ADAPTATION_IMMUTABLE.
      const expectBlocked = async (sql: string, params: unknown[]) => {
        await expect(
          pool.query(sql, params),
        ).rejects.toSatisfy(
          (err: unknown) =>
            err instanceof Error && err.message.includes("WORKOUT_ADAPTATION_IMMUTABLE"),
        );
      };

      // 2a. Mutate workoutPlanId.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "workoutPlanId" = $2 WHERE id = $1`,
        [adaptId, randomUUID()],
      );

      // 2b. Mutate userId.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "userId" = $2 WHERE id = $1`,
        [adaptId, randomUUID()],
      );

      // 2c. Mutate workoutSessionId.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "workoutSessionId" = $2 WHERE id = $1`,
        [adaptId, randomUUID()],
      );

      // 2d. Mutate intent.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET intent = 'LIGHTER' WHERE id = $1`,
        [adaptId],
      );

      // 2e. Mutate selectedOptionCode.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "selectedOptionCode" = 'tampered' WHERE id = $1`,
        [adaptId],
      );

      // 2f. Mutate beforeSnapshot (raw JSONB injection).
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "beforeSnapshot" = '{"tampered":true}'::jsonb WHERE id = $1`,
        [adaptId],
      );

      // 2g. Mutate afterSnapshot.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "afterSnapshot" = '{"tampered":true}'::jsonb WHERE id = $1`,
        [adaptId],
      );

      // 2h. Mutate policyVersion.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "policyVersion" = 'tampered-v0' WHERE id = $1`,
        [adaptId],
      );

      // 2i. Mutate sessionVersionBefore.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "sessionVersionBefore" = 999 WHERE id = $1`,
        [adaptId],
      );

      // 2j. Mutate sessionVersionAfter.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "sessionVersionAfter" = 999 WHERE id = $1`,
        [adaptId],
      );

      // 2k. APPLIED→UNDONE but also mutating intent (only status+undoneAt may change).
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET status = 'UNDONE', intent = 'LIGHTER' WHERE id = $1`,
        [adaptId],
      );

      // 2l. DELETE.
      await expectBlocked(
        `DELETE FROM "WorkoutAdaptation" WHERE id = $1`,
        [adaptId],
      );

      // Undo via service (the one allowed transition: APPLIED → UNDONE).
      const undone = await ctx.adaptations.undo(ctx.userId, ctx.session.id, {
        expectedSessionVersion: applied.session.version,
        adaptationId: adaptId,
        idempotencyKey: `immut-undo-${ctx.session.id}`,
      });
      expect(undone.adaptation.status).toBe("UNDONE");

      // 2m. UNDONE → APPLIED re-transition is blocked.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET status = 'APPLIED' WHERE id = $1`,
        [adaptId],
      );

      // 2n. Redo undoneAt on already-UNDONE row.
      await expectBlocked(
        `UPDATE "WorkoutAdaptation" SET "undoneAt" = now() WHERE id = $1`,
        [adaptId],
      );

      // 2o. DELETE of an UNDONE row.
      await expectBlocked(
        `DELETE FROM "WorkoutAdaptation" WHERE id = $1`,
        [adaptId],
      );
    });
  }, 300_000);

  it("WorkoutAdaptationCommand is immutable – UPDATE and DELETE both blocked", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applied = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `cmd-immut-${ctx.session.id}`,
      });

      const cmd = await pool.query<{ id: string }>(
        `SELECT id FROM "WorkoutAdaptationCommand" WHERE "workoutSessionId" = $1 LIMIT 1`,
        [ctx.session.id],
      );
      expect(cmd.rows.length).toBe(1);
      const cmdId = cmd.rows[0]!.id;

      // UPDATE blocked.
      await expect(
        pool.query(
          `UPDATE "WorkoutAdaptationCommand" SET "requestHash" = 'tampered' WHERE id = $1`,
          [cmdId],
        ),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error && err.message.includes("WORKOUT_ADAPTATION_COMMAND_IMMUTABLE"),
      );

      // DELETE blocked.
      await expect(
        pool.query(`DELETE FROM "WorkoutAdaptationCommand" WHERE id = $1`, [cmdId]),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error && err.message.includes("WORKOUT_ADAPTATION_COMMAND_IMMUTABLE"),
      );

      // Confirm original row is intact.
      const still = await pool.query<{ id: string }>(
        `SELECT id FROM "WorkoutAdaptationCommand" WHERE id = $1`,
        [cmdId],
      );
      expect(still.rows.length).toBe(1);
      void applied; // reference to satisfy TS
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 3. Idempotency key semantics
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – idempotency", () => {
  it("same key + same payload → idempotentReplay=true, same adaptation ID", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const input = {
        intent: "HOME" as const,
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `idem-same-${ctx.session.id}`,
      };

      const first = await ctx.adaptations.apply(ctx.userId, ctx.session.id, input);
      expect(first.idempotentReplay).toBe(false);

      const second = await ctx.adaptations.apply(ctx.userId, ctx.session.id, input);
      expect(second.idempotentReplay).toBe(true);
      expect(second.adaptation.id).toBe(first.adaptation.id);

      // Only one row in WorkoutAdaptation.
      const count = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation" WHERE "workoutSessionId" = $1`,
        [ctx.session.id],
      );
      expect(Number(count.rows[0]!.c)).toBe(1);
    });
  }, 300_000);

  it("same key + different payload → WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");

      const key = `idem-conflict-${ctx.session.id}`;
      await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: key,
      });

      // Same key, different intent → conflict.
      await expect(
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "LIGHTER",
          optionCode: "different-option",
          expectedSessionVersion: ctx.session.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: "different-fingerprint",
          idempotencyKey: key, // same key!
        }),
      ).rejects.toThrow(/WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT/);
    });
  }, 300_000);

  it("same key in a different session does NOT replay (scoped per session)", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx1 = await seedUserAndSession(pool, db);
      const ctx2 = await seedUserAndSession(pool, db);

      const sharedKey = "shared-idem-key";
      const preview1 = await ctx1.adaptations.preview(ctx1.userId, ctx1.session.id, "HOME");
      await ctx1.adaptations.apply(ctx1.userId, ctx1.session.id, {
        intent: "HOME",
        optionCode: preview1.recommended!.optionCode,
        expectedSessionVersion: ctx1.session.version,
        expectedCatalogReleaseId: preview1.catalogReleaseId,
        policyVersion: preview1.policyVersion,
        optionFingerprint: preview1.recommended!.optionFingerprint,
        idempotencyKey: sharedKey,
      });

      // ctx2 uses the same key but a different session → fresh apply, not a replay.
      const preview2 = await ctx2.adaptations.preview(ctx2.userId, ctx2.session.id, "HOME");
      const result2 = await ctx2.adaptations.apply(ctx2.userId, ctx2.session.id, {
        intent: "HOME",
        optionCode: preview2.recommended!.optionCode,
        expectedSessionVersion: ctx2.session.version,
        expectedCatalogReleaseId: preview2.catalogReleaseId,
        policyVersion: preview2.policyVersion,
        optionFingerprint: preview2.recommended!.optionFingerprint,
        idempotencyKey: sharedKey,
      });
      expect(result2.idempotentReplay).toBe(false);
    });
  }, 300_000);

  it("different user cannot access the other user's command (isolated)", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx1 = await seedUserAndSession(pool, db);
      const ctx2 = await seedUserAndSession(pool, db);

      const sharedKey = "cross-user-key";
      const preview1 = await ctx1.adaptations.preview(ctx1.userId, ctx1.session.id, "HOME");
      await ctx1.adaptations.apply(ctx1.userId, ctx1.session.id, {
        intent: "HOME",
        optionCode: preview1.recommended!.optionCode,
        expectedSessionVersion: ctx1.session.version,
        expectedCatalogReleaseId: preview1.catalogReleaseId,
        policyVersion: preview1.policyVersion,
        optionFingerprint: preview1.recommended!.optionFingerprint,
        idempotencyKey: sharedKey,
      });

      // ctx2 using same key against ctx1's session should be rejected with ownership error.
      const preview2 = await ctx2.adaptations.preview(ctx2.userId, ctx2.session.id, "HOME");
      await expect(
        ctx2.adaptations.apply(ctx2.userId, ctx1.session.id, {
          intent: "HOME",
          optionCode: preview2.recommended!.optionCode,
          expectedSessionVersion: ctx1.session.version,
          expectedCatalogReleaseId: preview2.catalogReleaseId,
          policyVersion: preview2.policyVersion,
          optionFingerprint: preview2.recommended!.optionFingerprint,
          idempotencyKey: sharedKey,
        }),
      ).rejects.toThrow(/WORKOUT_SESSION_NOT_FOUND/);
    });
  }, 300_000);

  it("undo same key + same payload → idempotentReplay after first undo", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applied = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `idem-undo-apply-${ctx.session.id}`,
      });

      const undoInput = {
        expectedSessionVersion: applied.session.version,
        adaptationId: applied.adaptation.id,
        idempotencyKey: `idem-undo-${ctx.session.id}`,
      };
      const undo1 = await ctx.adaptations.undo(ctx.userId, ctx.session.id, undoInput);
      expect(undo1.idempotentReplay).toBe(false);
      expect(undo1.adaptation.status).toBe("UNDONE");

      const undo2 = await ctx.adaptations.undo(ctx.userId, ctx.session.id, undoInput);
      expect(undo2.idempotentReplay).toBe(true);
      expect(undo2.adaptation.id).toBe(undo1.adaptation.id);

      // Different payload with same key → conflict
      await expect(
        ctx.adaptations.undo(ctx.userId, ctx.session.id, {
          ...undoInput,
          expectedSessionVersion: applied.session.version + 99,
        }),
      ).rejects.toThrow(/WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT/);

      const undoneCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"
         WHERE "workoutSessionId" = $1 AND status = 'UNDONE'`,
        [ctx.session.id],
      );
      expect(Number(undoneCount.rows[0]!.c)).toBe(1);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 4. Concurrency / session lock isolation
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – concurrency", () => {
  it("concurrent apply same session → exactly one APPLIED", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(preview.recommended).toBeTruthy();

      const results = await Promise.allSettled([
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "HOME",
          optionCode: preview.recommended!.optionCode,
          expectedSessionVersion: ctx.session.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: preview.recommended!.optionFingerprint,
          idempotencyKey: `conc-A-${ctx.session.id}`,
        }),
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "HOME",
          optionCode: preview.recommended!.optionCode,
          expectedSessionVersion: ctx.session.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: preview.recommended!.optionFingerprint,
          idempotencyKey: `conc-B-${ctx.session.id}`,
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(results.filter((r) => r.status === "rejected").length).toBe(1);

      const applied = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"
         WHERE "workoutSessionId" = $1 AND status = 'APPLIED'`,
        [ctx.session.id],
      );
      expect(Number(applied.rows[0]!.c)).toBe(1);
    });
  }, 300_000);

  it("concurrent apply different sessions → both succeed", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx1 = await seedUserAndSession(pool, db);
      const ctx2 = await seedUserAndSession(pool, db);
      const [p1, p2] = await Promise.all([
        ctx1.adaptations.preview(ctx1.userId, ctx1.session.id, "HOME"),
        ctx2.adaptations.preview(ctx2.userId, ctx2.session.id, "HOME"),
      ]);
      expect(p1.recommended).toBeTruthy();
      expect(p2.recommended).toBeTruthy();

      const results = await Promise.allSettled([
        ctx1.adaptations.apply(ctx1.userId, ctx1.session.id, {
          intent: "HOME",
          optionCode: p1.recommended!.optionCode,
          expectedSessionVersion: ctx1.session.version,
          expectedCatalogReleaseId: p1.catalogReleaseId,
          policyVersion: p1.policyVersion,
          optionFingerprint: p1.recommended!.optionFingerprint,
          idempotencyKey: `conc-diff-1-${ctx1.session.id}`,
        }),
        ctx2.adaptations.apply(ctx2.userId, ctx2.session.id, {
          intent: "HOME",
          optionCode: p2.recommended!.optionCode,
          expectedSessionVersion: ctx2.session.version,
          expectedCatalogReleaseId: p2.catalogReleaseId,
          policyVersion: p2.policyVersion,
          optionFingerprint: p2.recommended!.optionFingerprint,
          idempotencyKey: `conc-diff-2-${ctx2.session.id}`,
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(2);
    });
  }, 300_000);

  it("lock probe: holding xact lock on session A does not block try_lock on session B", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);
      const sessionIdA = randomUUID();
      const sessionIdB = randomUUID();
      const NS = WORKOUT_ADAPTATION_LOCK_NAMESPACE;

      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        // A holds xact lock on sessionA.
        await clientA.query("BEGIN");
        await clientA.query(
          `SELECT pg_advisory_xact_lock($1, hashtext($2::text))`,
          [NS, sessionIdA],
        );

        // B cannot acquire xact lock on sessionA (it's held by A).
        await clientB.query("BEGIN");
        const tryA = await clientB.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_xact_lock($1, hashtext($2::text)) AS locked`,
          [NS, sessionIdA],
        );
        expect(tryA.rows[0]!.locked).toBe(false);

        // B CAN acquire xact lock on sessionB (independent session).
        const tryB = await clientB.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_xact_lock($1, hashtext($2::text)) AS locked`,
          [NS, sessionIdB],
        );
        expect(tryB.rows[0]!.locked).toBe(true);
      } finally {
        await clientA.query("ROLLBACK").catch(() => undefined);
        await clientB.query("ROLLBACK").catch(() => undefined);
        clientA.release();
        clientB.release();
      }
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 5. Stale catalog detection
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – stale catalog", () => {
  it("apply with stale catalogReleaseId → WORKOUT_ADAPTATION_CATALOG_STALE, zero rows written", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);

      // Preview while release A is current.
      const previewOnA = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(previewOnA.recommended).toBeTruthy();
      const oldReleaseId = previewOnA.catalogReleaseId;

      const countBefore = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"`,
      );
      const cmdCountBefore = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptationCommand"`,
      );

      // Publish release B (A becomes RETIRED).
      await cloneAndPublishRelease(pool, ctx.catalog, "stale-test");

      // Attempt to apply with the old preview (release A ID).
      await expect(
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "HOME",
          optionCode: previewOnA.recommended!.optionCode,
          expectedSessionVersion: ctx.session.version,
          expectedCatalogReleaseId: oldReleaseId, // stale!
          policyVersion: previewOnA.policyVersion,
          optionFingerprint: previewOnA.recommended!.optionFingerprint,
          idempotencyKey: `stale-cat-${ctx.session.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_ADAPTATION_CATALOG_STALE/);

      // Zero rows written.
      const countAfter = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"`,
      );
      const cmdCountAfter = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptationCommand"`,
      );
      expect(countAfter.rows[0]!.c).toBe(countBefore.rows[0]!.c);
      expect(cmdCountAfter.rows[0]!.c).toBe(cmdCountBefore.rows[0]!.c);
    });
  }, 300_000);

  it("apply succeeds after refreshing preview against new published release", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);

      // Publish a new release.
      await cloneAndPublishRelease(pool, ctx.catalog, "refresh-test");

      // Fresh preview uses new release.
      const freshPreview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(freshPreview.recommended).toBeTruthy();

      const result = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: freshPreview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: freshPreview.catalogReleaseId,
        policyVersion: freshPreview.policyVersion,
        optionFingerprint: freshPreview.recommended!.optionFingerprint,
        idempotencyKey: `refresh-apply-${ctx.session.id}`,
      });
      expect(result.adaptation.status).toBe("APPLIED");
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 6. Undo conflicts
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – undo conflicts", () => {
  it("undo with adaptationId of non-latest APPLIED → WORKOUT_ADAPTATION_UNDO_UNAVAILABLE", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);

      // Apply A.
      const previewHome = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applyA = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: previewHome.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: previewHome.catalogReleaseId,
        policyVersion: previewHome.policyVersion,
        optionFingerprint: previewHome.recommended!.optionFingerprint,
        idempotencyKey: `undo-conflict-A-${ctx.session.id}`,
      });
      const adaptationAId = applyA.adaptation.id;

      // Apply B on top of A.
      const previewShorter = await ctx.adaptations.preview(
        ctx.userId, ctx.session.id, "SHORTER",
      );
      if (previewShorter.recommended) {
        await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "SHORTER",
          optionCode: previewShorter.recommended.optionCode,
          expectedSessionVersion: applyA.session.version,
          expectedCatalogReleaseId: previewShorter.catalogReleaseId,
          policyVersion: previewShorter.policyVersion,
          optionFingerprint: previewShorter.recommended.optionFingerprint,
          idempotencyKey: `undo-conflict-B-${ctx.session.id}`,
        });

        // Trying to undo A (not latest) → WORKOUT_ADAPTATION_UNDO_UNAVAILABLE.
        await expect(
          ctx.adaptations.undo(ctx.userId, ctx.session.id, {
            expectedSessionVersion: applyA.session.version,
            adaptationId: adaptationAId, // A is not latest (B is)
            idempotencyKey: `undo-conflict-undo-A-${ctx.session.id}`,
          }),
        ).rejects.toThrow(/WORKOUT_ADAPTATION_UNDO_UNAVAILABLE|WORKOUT_ADAPTATION_STALE_VERSION/);
      } else {
        // SHORTER not available; verify A can be undone cleanly.
        const undone = await ctx.adaptations.undo(ctx.userId, ctx.session.id, {
          expectedSessionVersion: applyA.session.version,
          adaptationId: adaptationAId,
          idempotencyKey: `undo-conflict-only-A-${ctx.session.id}`,
        });
        expect(undone.adaptation.status).toBe("UNDONE");
      }
      void pool;
    });
  }, 300_000);

  it("concurrent undo: exactly one succeeds, other gets UNDO_UNAVAILABLE", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applied = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `conc-undo-apply-${ctx.session.id}`,
      });

      const results = await Promise.allSettled([
        ctx.adaptations.undo(ctx.userId, ctx.session.id, {
          expectedSessionVersion: applied.session.version,
          adaptationId: applied.adaptation.id,
          idempotencyKey: `conc-undo-1-${ctx.session.id}`,
        }),
        ctx.adaptations.undo(ctx.userId, ctx.session.id, {
          expectedSessionVersion: applied.session.version,
          adaptationId: applied.adaptation.id,
          idempotencyKey: `conc-undo-2-${ctx.session.id}`,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const undoneCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"
         WHERE "workoutSessionId" = $1 AND status = 'UNDONE'`,
        [ctx.session.id],
      );
      expect(Number(undoneCount.rows[0]!.c)).toBe(1);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 7. Catalog adversarial – DRAFT/RETIRED/inactive items excluded from eligible list
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – catalog adversarial", () => {
  it("canonical release: 84 eligible exercises with non-null keys and active status", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const catalog = new WorkoutCatalogReleaseService(db);
      const result = await catalog.listGeneratorEligibleExercises();
      expect(result.exercises.length).toBe(84);
      // All eligible exercises must have non-null keys (null-key exercises excluded).
      expect(result.exercises.every((e) => e.key !== null && e.key.length > 0)).toBe(true);
      // All eligible exercises must be active (inactive excluded).
      expect(result.exercises.every((e) => e.isActive === true)).toBe(true);
      // All eligible exercises must have a revision (outside-release excluded).
      expect(result.exercises.every((e) => e.exerciseRevisionId !== null)).toBe(true);
    });
  }, 300_000);

  it("published release items all have APPROVED revisions (DRAFT/RETIRED excluded by SQL)", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);

      // No items in the PUBLISHED release should have a non-APPROVED revision.
      const nonApproved = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         WHERE rel.status = 'PUBLISHED'
           AND r.status != 'APPROVED'`,
      );
      expect(Number(nonApproved.rows[0]!.c)).toBe(0);

      // No items in the PUBLISHED release should belong to inactive exercises.
      const inactive = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE rel.status = 'PUBLISHED'
           AND e."isActive" IS NOT TRUE`,
      );
      expect(Number(inactive.rows[0]!.c)).toBe(0);

      // All items have non-null exercise keys (excludes null-key exercises from eligibility).
      const noKey = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE rel.status = 'PUBLISHED'
           AND e.key IS NULL`,
      );
      expect(Number(noKey.rows[0]!.c)).toBe(0);
    });
  }, 300_000);

  it("RETIRED release items are excluded from eligibility query (only PUBLISHED used)", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const catalog = new WorkoutCatalogReleaseService(db);

      // Publish a new release (canonical becomes RETIRED).
      await cloneAndPublishRelease(pool, catalog, "retired-check");

      // Verify the old release is now RETIRED.
      const retired = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'RETIRED'`,
      );
      expect(Number(retired.rows[0]!.c)).toBeGreaterThanOrEqual(1);

      // listGeneratorEligibleExercises should still return 84 (from the new PUBLISHED release).
      const result = await catalog.listGeneratorEligibleExercises();
      expect(result.exercises.length).toBe(84);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 8. Four historical HOME variant relations
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – historical HOME relations", () => {
  it("all four canonical HOME variant relations are present and active (priority=0)", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);

      const result = await pool.query<{ from_key: string; to_key: string }>(
        `SELECT f.key AS from_key, t.key AS to_key
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" f ON f.id = vr."fromExerciseId"
         JOIN "Exercise" t ON t.id = vr."toExerciseId"
         WHERE vr.active = true
           AND vr.priority = 0
           AND (
             (f.key = 'barbell_romanian_deadlift' AND t.key = 'glute_bridge')
             OR (f.key = 'dumbbell_row'           AND t.key = 'band_row')
             OR (f.key = 'goblet_squat'           AND t.key = 'bodyweight_squats')
             OR (f.key = 'light_jog'              AND t.key = 'morning_walk')
           )`,
      );
      expect(result.rows.length).toBe(4);

      const pairs = new Set(result.rows.map((r) => `${r.from_key}→${r.to_key}`));
      expect(pairs.has("barbell_romanian_deadlift→glute_bridge")).toBe(true);
      expect(pairs.has("dumbbell_row→band_row")).toBe(true);
      expect(pairs.has("goblet_squat→bodyweight_squats")).toBe(true);
      expect(pairs.has("light_jog→morning_walk")).toBe(true);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 9. Full publish-switch e2e scenario
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – publish-switch e2e", () => {
  it("HOME→undo→stale apply→fresh preview apply→idempotent replay→conflict", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow");

      // --- Phase 1: Apply HOME on release A ---
      const previewA = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(previewA.recommended).toBeTruthy();
      const homeInput = {
        intent: "HOME" as const,
        optionCode: previewA.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: previewA.catalogReleaseId,
        policyVersion: previewA.policyVersion,
        optionFingerprint: previewA.recommended!.optionFingerprint,
        idempotencyKey: `switch-home-${ctx.session.id}`,
      };
      const home = await ctx.adaptations.apply(ctx.userId, ctx.session.id, homeInput);
      expect(home.adaptation.status).toBe("APPLIED");
      const beforeSnapshotExercises = home.adaptation.beforeSnapshot.exercises;
      expect(beforeSnapshotExercises.length).toBeGreaterThan(0);

      // --- Phase 2: Undo HOME ---
      const undoneHome = await ctx.adaptations.undo(ctx.userId, ctx.session.id, {
        expectedSessionVersion: home.session.version,
        adaptationId: home.adaptation.id,
        idempotencyKey: `switch-undo-home-${ctx.session.id}`,
      });
      expect(undoneHome.adaptation.status).toBe("UNDONE");

      // --- Phase 3: Preview LIGHTER on release A ---
      const previewLighterA = await ctx.adaptations.preview(
        ctx.userId, ctx.session.id, "LIGHTER",
      );
      expect(previewLighterA.recommended).toBeTruthy();
      const oldReleaseId = previewLighterA.catalogReleaseId;

      // --- Phase 4: Publish release B ---
      await cloneAndPublishRelease(pool, ctx.catalog, "switch-b");

      // --- Phase 5: Apply LIGHTER with stale preview (release A) → CATALOG_STALE ---
      await expect(
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "LIGHTER",
          optionCode: previewLighterA.recommended!.optionCode,
          expectedSessionVersion: undoneHome.session.version,
          expectedCatalogReleaseId: oldReleaseId,
          policyVersion: previewLighterA.policyVersion,
          optionFingerprint: previewLighterA.recommended!.optionFingerprint,
          idempotencyKey: `switch-lighter-stale-${ctx.session.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_ADAPTATION_CATALOG_STALE/);

      // --- Phase 6: Fresh preview on release B → apply succeeds ---
      const previewLighterB = await ctx.adaptations.preview(
        ctx.userId, ctx.session.id, "LIGHTER",
      );
      expect(previewLighterB.recommended).toBeTruthy();
      expect(previewLighterB.catalogReleaseId).not.toBe(oldReleaseId);

      const lighterInput = {
        intent: "LIGHTER" as const,
        optionCode: previewLighterB.recommended!.optionCode,
        expectedSessionVersion: undoneHome.session.version,
        expectedCatalogReleaseId: previewLighterB.catalogReleaseId,
        policyVersion: previewLighterB.policyVersion,
        optionFingerprint: previewLighterB.recommended!.optionFingerprint,
        idempotencyKey: `switch-lighter-fresh-${ctx.session.id}`,
      };
      const lighter = await ctx.adaptations.apply(ctx.userId, ctx.session.id, lighterInput);
      expect(lighter.adaptation.status).toBe("APPLIED");

      // beforeSnapshot must match the original pre-HOME exercises (undone state restored).
      expect(lighter.adaptation.beforeSnapshot.exercises.map((e) => e.exerciseKey)).toEqual(
        beforeSnapshotExercises.map((e) => e.exerciseKey),
      );

      // --- Phase 7: Idempotent replay ---
      const replayLighter = await ctx.adaptations.apply(ctx.userId, ctx.session.id, lighterInput);
      expect(replayLighter.idempotentReplay).toBe(true);
      expect(replayLighter.adaptation.id).toBe(lighter.adaptation.id);

      // --- Phase 8: Different payload, same key → IDEMPOTENCY_CONFLICT ---
      await expect(
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          ...lighterInput,
          optionFingerprint: "completely-different-fingerprint",
        }),
      ).rejects.toThrow(/WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT/);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 10. Apply after undo
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – apply after undo", () => {
  it("second apply after undo succeeds and restores then re-adapts", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);

      // Apply HOME.
      const preview1 = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applied1 = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview1.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview1.catalogReleaseId,
        policyVersion: preview1.policyVersion,
        optionFingerprint: preview1.recommended!.optionFingerprint,
        idempotencyKey: `after-undo-apply1-${ctx.session.id}`,
      });

      // Undo.
      await ctx.adaptations.undo(ctx.userId, ctx.session.id, {
        expectedSessionVersion: applied1.session.version,
        adaptationId: applied1.adaptation.id,
        idempotencyKey: `after-undo-undo1-${ctx.session.id}`,
      });

      // Apply HOME again (fresh preview required after undo bumps version).
      const preview2 = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applied2 = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview2.recommended!.optionCode,
        expectedSessionVersion: preview2.sessionVersion,
        expectedCatalogReleaseId: preview2.catalogReleaseId,
        policyVersion: preview2.policyVersion,
        optionFingerprint: preview2.recommended!.optionFingerprint,
        idempotencyKey: `after-undo-apply2-${ctx.session.id}`,
      });
      expect(applied2.adaptation.status).toBe("APPLIED");
      expect(applied2.idempotentReplay).toBe(false);

      // Exactly 2 rows in WorkoutAdaptation (one UNDONE, one APPLIED).
      const rows = await pool.query<{ status: string }>(
        `SELECT status FROM "WorkoutAdaptation"
         WHERE "workoutSessionId" = $1 ORDER BY "createdAt" ASC`,
        [ctx.session.id],
      );
      expect(rows.rows.map((r) => r.status)).toEqual(["UNDONE", "APPLIED"]);
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 11. MOVE_DAY timezone basics (DB-level)
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – MOVE_DAY timezone", () => {
  it("preview with Europe/Moscow timezone resolves timeZone correctly", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db, "Europe/Moscow");
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(preview.timeZone).toBe("Europe/Moscow");
    });
  }, 300_000);

  it("preview with no timezone falls back to UTC", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      // No timezone set → generatePlan saves WorkoutPlan.timeZone='UTC' → resolveTimeZone returns 'UTC'.
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(preview.timeZone).toBe("UTC");
    });
  }, 300_000);

  it("WorkoutPlan.timeZone column accepts and persists IANA zone", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);

      // Set the plan's timeZone.
      await pool.query(
        `UPDATE "WorkoutPlan" SET "timeZone" = 'Europe/Amsterdam'
         WHERE "userId" = $1`,
        [ctx.userId],
      );

      const row = await pool.query<{ timeZone: string | null }>(
        `SELECT "timeZone" FROM "WorkoutPlan" WHERE "userId" = $1`,
        [ctx.userId],
      );
      expect(row.rows[0]!.timeZone).toBe("Europe/Amsterdam");

      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(preview.timeZone).toBe("Europe/Amsterdam");
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 12. Completed / ownership / forced cleanup
// ---------------------------------------------------------------------------

describe("WORKOUT-V2-01D-FIX1 hardening – completed / ownership / cleanup", () => {
  it("completed session blocks preview, apply and undo", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);

      // Apply something so there is an adaptation to undo.
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      const applied = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "HOME",
        optionCode: preview.recommended!.optionCode,
        expectedSessionVersion: ctx.session.version,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `completed-apply-${ctx.session.id}`,
      });

      await ctx.sessions.complete(ctx.userId, ctx.session.id, { confirmIncomplete: true });

      await expect(
        ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME"),
      ).rejects.toThrow(/WORKOUT_SESSION_COMPLETED/);

      await expect(
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "HOME",
          optionCode: preview.recommended!.optionCode,
          expectedSessionVersion: applied.session.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: preview.recommended!.optionFingerprint,
          idempotencyKey: `completed-apply-attempt-${ctx.session.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_SESSION_COMPLETED/);

      await expect(
        ctx.adaptations.undo(ctx.userId, ctx.session.id, {
          expectedSessionVersion: applied.session.version,
          adaptationId: applied.adaptation.id,
          idempotencyKey: `completed-undo-attempt-${ctx.session.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_SESSION_COMPLETED/);
    });
  }, 300_000);

  it("cross-user ownership: history/preview blocked for wrong user", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const otherId = await seedUser(pool, "crossown");

      await expect(
        ctx.adaptations.history(otherId, ctx.session.id),
      ).rejects.toThrow(/WORKOUT_SESSION_NOT_FOUND/);

      await expect(
        ctx.adaptations.preview(otherId, ctx.session.id, "HOME"),
      ).rejects.toThrow(/WORKOUT_SESSION_NOT_FOUND/);
    });
  }, 300_000);

  it("forced failure in withDisposableMigratedDb propagates and cleans up", async () => {
    await expect(
      withDisposableMigratedDb(async () => {
        throw new Error("forced-hardening-cleanup");
      }),
    ).rejects.toThrow("forced-hardening-cleanup");
  }, 300_000);
});
