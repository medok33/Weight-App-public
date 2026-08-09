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

async function seedUserAndSession(pool: Pool, db: PrismaService) {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1, $2)`, [
    userId,
    `adapt-01d-${userId}@example.com`,
  ]);

  const catalog = new WorkoutCatalogReleaseService(db);
  const profiles = new WorkoutProfileRepository(db);
  const engine = new WorkoutEngineService(
    new WorkoutEngineRepository(db),
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

  const sessions = new WorkoutSessionService(
    new WorkoutSessionRepository(db),
    engine,
    db,
    catalog,
  );
  const week = await engine.getWeekView(userId);
  const day = week.days.find((d) => !d.isRestDay && d.exercises.length > 0);
  if (!day) throw new Error("NO_TRAINING_DAY");
  const session = await sessions.start(userId, { dayIndex: day.dayIndex });

  const adaptations = new WorkoutAdaptationService(
    db,
    new WorkoutSessionRepository(db),
    catalog,
    engine,
    new WorkoutAdaptationRepository(db),
  );
  return { userId, session, adaptations, sessions, engine, dayIndex: day.dayIndex };
}

describe("WORKOUT-V2-01D workout adaptation persistence", () => {
  it("fresh migrations include 213 and a second run applies nothing", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);
      // Both 212 and 213 must be present after a fresh run.
      const ledger212 = await pool.query<{ migrationName: string }>(
        `SELECT "migrationName" FROM "SchemaMigrationLedger" WHERE "migrationName" = $1`,
        ["212_workout_adaptive_replacements"],
      );
      expect(ledger212.rows).toHaveLength(1);

      const ledger213 = await pool.query<{ migrationName: string }>(
        `SELECT "migrationName" FROM "SchemaMigrationLedger" WHERE "migrationName" = $1`,
        ["213_workout_adaptation_hardening"],
      );
      expect(ledger213.rows).toHaveLength(1);

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

  it("preview/apply/undo/idempotency/stale/completed/ownership/HOME preferred", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const beforeCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"`,
      );
      const beforeVersion = ctx.session.version;

      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME");
      expect(preview.sessionVersion).toBe(beforeVersion);
      expect(preview.recommended).toBeTruthy();
      expect(preview.alternatives.length).toBeGreaterThanOrEqual(0);
      expect(preview.recommended?.goalImpact.disclaimerRu).toMatch(/не является медицинским/i);

      const afterPreview = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"`,
      );
      expect(afterPreview.rows[0]?.c).toBe(beforeCount.rows[0]?.c);
      const sessionStill = await ctx.sessions.getById(ctx.userId, ctx.session.id);
      expect(sessionStill.version).toBe(beforeVersion);

      const optionCode = preview.recommended!.optionCode;
      // Build the canonical apply input so we can replay it identically.
      const homeApplyInput = {
        intent: "HOME" as const,
        optionCode,
        expectedSessionVersion: beforeVersion,
        expectedCatalogReleaseId: preview.catalogReleaseId,
        policyVersion: preview.policyVersion,
        optionFingerprint: preview.recommended!.optionFingerprint,
        idempotencyKey: `home-${ctx.session.id}`,
      };

      const applied = await ctx.adaptations.apply(ctx.userId, ctx.session.id, homeApplyInput);
      expect(applied.idempotentReplay).toBe(false);
      expect(applied.adaptation.status).toBe("APPLIED");
      expect(applied.session.version).toBe(beforeVersion + 1);
      expect(applied.adaptation.beforeSnapshot.exercises.length).toBeGreaterThan(0);
      expect(applied.adaptation.afterSnapshot.exercises.length).toBeGreaterThan(0);

      // Idempotent replay: exact same payload → same adaptation ID, idempotentReplay=true.
      const replay = await ctx.adaptations.apply(ctx.userId, ctx.session.id, homeApplyInput);
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.adaptation.id).toBe(applied.adaptation.id);

      // Stale version: session is at beforeVersion+1 now, using beforeVersion → STALE.
      await expect(
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "LIGHTER",
          optionCode: "nope",
          expectedSessionVersion: beforeVersion,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: "fake-fingerprint-stale-test",
          idempotencyKey: `stale-test-${ctx.session.id}`,
        }),
      ).rejects.toThrow(/WORKOUT_ADAPTATION_STALE_VERSION/);

      const undone = await ctx.adaptations.undo(ctx.userId, ctx.session.id, {
        expectedSessionVersion: applied.session.version,
        adaptationId: applied.adaptation.id,
        idempotencyKey: `undo-home-${ctx.session.id}`,
      });
      expect(undone.adaptation.status).toBe("UNDONE");
      expect(undone.session.exercises.map((e) => e.exerciseKey)).toEqual(
        applied.adaptation.beforeSnapshot.exercises.map((e) => e.exerciseKey),
      );
      const audit = await pool.query<{ status: string }>(
        `SELECT status FROM "WorkoutAdaptation" WHERE id = $1`,
        [applied.adaptation.id],
      );
      expect(audit.rows[0]?.status).toBe("UNDONE");

      // LIGHTER after undo
      const lighterPreview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "LIGHTER");
      expect(lighterPreview.recommended).toBeTruthy();
      const lighter = await ctx.adaptations.apply(ctx.userId, ctx.session.id, {
        intent: "LIGHTER",
        optionCode: lighterPreview.recommended!.optionCode,
        expectedSessionVersion: undone.session.version,
        expectedCatalogReleaseId: lighterPreview.catalogReleaseId,
        policyVersion: lighterPreview.policyVersion,
        optionFingerprint: lighterPreview.recommended!.optionFingerprint,
        idempotencyKey: `lighter-${ctx.session.id}`,
      });
      expect(lighter.adaptation.beforeSnapshot.exercises[0]?.techniqueSummaryRu).toBeTruthy();

      // historical preferred edges available in graph
      const hist = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" f ON f.id = vr."fromExerciseId"
         JOIN "Exercise" t ON t.id = vr."toExerciseId"
         WHERE vr.active AND vr.priority = 0
           AND (
             (f.key = 'barbell_romanian_deadlift' AND t.key = 'glute_bridge')
             OR (f.key = 'dumbbell_row' AND t.key = 'band_row')
             OR (f.key = 'goblet_squat' AND t.key = 'bodyweight_squats')
             OR (f.key = 'light_jog' AND t.key = 'morning_walk')
           )`,
      );
      expect(Number(hist.rows[0]?.c)).toBe(4);

      // completed session blocked
      await ctx.sessions.complete(ctx.userId, ctx.session.id, { confirmIncomplete: true });
      await expect(
        ctx.adaptations.preview(ctx.userId, ctx.session.id, "HOME"),
      ).rejects.toThrow(/WORKOUT_SESSION_COMPLETED/);

      // ownership
      const other = randomUUID();
      await pool.query(`INSERT INTO "User" (id, email) VALUES ($1,$2)`, [
        other,
        `other-${other}@example.com`,
      ]);
      await expect(
        ctx.adaptations.history(other, ctx.session.id),
      ).rejects.toThrow(/WORKOUT_SESSION_NOT_FOUND/);
    });
  }, 300_000);

  it("concurrent apply leaves exactly one APPLIED adaptation", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const ctx = await seedUserAndSession(pool, db);
      const preview = await ctx.adaptations.preview(ctx.userId, ctx.session.id, "SHORTER");
      expect(preview.recommended).toBeTruthy();
      const results = await Promise.allSettled([
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "SHORTER",
          optionCode: preview.recommended!.optionCode,
          expectedSessionVersion: ctx.session.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: preview.recommended!.optionFingerprint,
          idempotencyKey: `conc-a-${ctx.session.id}`,
        }),
        ctx.adaptations.apply(ctx.userId, ctx.session.id, {
          intent: "SHORTER",
          optionCode: preview.recommended!.optionCode,
          expectedSessionVersion: ctx.session.version,
          expectedCatalogReleaseId: preview.catalogReleaseId,
          policyVersion: preview.policyVersion,
          optionFingerprint: preview.recommended!.optionFingerprint,
          idempotencyKey: `conc-b-${ctx.session.id}`,
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const applied = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutAdaptation"
         WHERE "workoutSessionId" = $1 AND status = 'APPLIED'`,
        [ctx.session.id],
      );
      expect(Number(applied.rows[0]?.c)).toBe(1);
    });
  }, 300_000);

  it("disposable migration databases clean up after a forced failure", async () => {
    await expect(
      withDisposableMigratedDb(async () => {
        throw new Error("forced adaptation persistence failure");
      }),
    ).rejects.toThrow("forced adaptation persistence failure");
  }, 300_000);
});
