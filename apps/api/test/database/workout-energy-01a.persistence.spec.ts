/**
 * WORKOUT-ENERGY-01A — migration 217 + ExerciseEnergyProfile persistence.
 * Uses disposable PostgreSQL only (never shared weight_app DB).
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { runSqlMigrations } from "../../scripts/lib/sql-migration-runner.mjs";
import { ExerciseEnergyProfileRepository } from "../../src/modules/workout-engine/energy/exercise-energy-profile.repository";
import { estimateExerciseEnergy } from "../../src/modules/workout-engine/energy/workout-energy.calculator";
import { resolveWorkoutEnergyWeight } from "../../src/modules/workout-engine/energy/workout-energy-weight.resolver";
import { loadEnergyPilotProfiles } from "../../src/modules/workout-engine/energy/pilot/energy-pilot-loader";
import { ENERGY_PILOT_MAPPINGS } from "../../src/modules/workout-engine/energy/pilot/energy-pilot-manifest";
import { WORKOUT_ENERGY_POLICY_VERSION } from "../../src/modules/workout-engine/energy/workout-energy.types";
import { withDisposableMigratedDb } from "./helpers/disposable-catalog-db";

const M216 = "216_activity_01b_connection_lifecycle";
const M217 = "217_workout_energy_profile_foundation";
const SHARED_DB_MARKER = "postgresql://weight_app:weight_app_local@localhost:5432/weight_app";

async function createUser(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1::uuid, $2)`, [
    userId,
    `energy01a-${userId.slice(0, 8)}@example.com`,
  ]);
  return userId;
}

async function revisionIdForKey(pool: Pool, key: string): Promise<string> {
  const published = await pool.query<{ id: string; revisionNumber: number }>(
    `SELECT r.id, r."revisionNumber"
     FROM "WorkoutCatalogRelease" rel
     JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
     JOIN "Exercise" e ON e.id = i."exerciseId"
     JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     WHERE rel.status = 'PUBLISHED'
       AND e.key = $1
     ORDER BY rel."publishedAt" ASC NULLS LAST, rel."createdAt" ASC
     LIMIT 1`,
    [key],
  );
  const pin = published.rows[0];
  if (pin) return pin.id;

  // Keys without published pin (should be rare): fail closed — no revisionNumber=1 fallback.
  throw new Error(`REVISION_PIN_NOT_FOUND:${key}`);
}

describe("WORKOUT-ENERGY-01A migration + persistence", () => {
  it("applies 217 on disposable DB; ledger records; rerun is no-op", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      expect(connectionString).not.toBe(SHARED_DB_MARKER);
      expect(connectionString).not.toMatch(/\/weight_app(\?|$)/);

      const ledger = await pool.query<{ migrationName: string }>(
        `SELECT "migrationName" FROM "SchemaMigrationLedger"
         WHERE "migrationName" IN ($1, $2)
         ORDER BY "migrationName"`,
        [M216, M217],
      );
      expect(ledger.rows.map((r) => r.migrationName)).toEqual([M216, M217]);

      const table = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'ExerciseEnergyProfile'
         ) AS exists`,
      );
      expect(table.rows[0]?.exists).toBe(true);

      const client = await pool.connect();
      try {
        const rerun = await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
        expect(rerun.applied).toEqual([]);
      } finally {
        client.release();
      }
    });
  }, 300_000);

  it("does not rewrite ExerciseRevision / WorkoutSession / Nutrition on migrate", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const before = await pool.query<{
        revisions: string;
        sessions: string;
        sessionExercises: string;
        profiles: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM "ExerciseRevision") AS revisions,
           (SELECT COUNT(*)::text FROM "WorkoutSession") AS sessions,
           (SELECT COUNT(*)::text FROM "WorkoutSessionExercise") AS "sessionExercises",
           (SELECT COUNT(*)::text FROM "ExerciseEnergyProfile") AS profiles`,
      );
      expect(Number(before.rows[0]?.profiles)).toBe(0);
      expect(Number(before.rows[0]?.revisions)).toBeGreaterThan(0);

      const client = await pool.connect();
      try {
        await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
      } finally {
        client.release();
      }

      const after = await pool.query<{
        revisions: string;
        sessions: string;
        sessionExercises: string;
        profiles: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM "ExerciseRevision") AS revisions,
           (SELECT COUNT(*)::text FROM "WorkoutSession") AS sessions,
           (SELECT COUNT(*)::text FROM "WorkoutSessionExercise") AS "sessionExercises",
           (SELECT COUNT(*)::text FROM "ExerciseEnergyProfile") AS profiles`,
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    });
  }, 300_000);

  it("enforces FK, unique active profile, approved review, and enabled checks", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = createDb();
      const repo = new ExerciseEnergyProfileRepository(db);
      const revisionId = await revisionIdForKey(pool, "push_ups");

      await expect(
        pool.query(
          `INSERT INTO "ExerciseEnergyProfile" (
             "exerciseRevisionId", "calculationMethod", "populationType",
             "compendiumEdition", "compendiumCode", "metValue", "sourceType",
             "sourceReference", "sourceVersion", "policyVersion"
           ) VALUES (
             $1, 'MET_DURATION', 'ADULT_STANDARD_2024', 'ADULT_2024', '02022', 3.8,
             'COMPENDIUM_ADULT_2024', 'ref', 'v1', $2
           )`,
          [randomUUID(), WORKOUT_ENERGY_POLICY_VERSION],
        ),
      ).rejects.toThrow();

      const draft = await repo.createDraft({
        exerciseRevisionId: revisionId,
        calculationMethod: "MET_DURATION",
        populationType: "ADULT_STANDARD_2024",
        compendiumEdition: "ADULT_2024",
        compendiumCode: "02022",
        metValue: 3.8,
        sourceType: "COMPENDIUM_ADULT_2024",
        sourceReference: "https://pacompendium.com/",
        sourceVersion: "compendium-adult-2024.1",
      });
      expect(draft.status).toBe("DRAFT");
      expect(draft.enabledForCalculation).toBe(false);

      await expect(
        repo.createDraft({
          exerciseRevisionId: revisionId,
          calculationMethod: "MET_DURATION",
          populationType: "ADULT_STANDARD_2024",
          compendiumEdition: "ADULT_2024",
          compendiumCode: "02022",
          metValue: 3.8,
          sourceType: "COMPENDIUM_ADULT_2024",
          sourceReference: "https://pacompendium.com/",
          sourceVersion: "compendium-adult-2024.1",
        }),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `UPDATE "ExerciseEnergyProfile"
           SET "enabledForCalculation" = true
           WHERE id = $1`,
          [draft.id],
        ),
      ).rejects.toThrow();

      const approved = await repo.approve(draft.id, "owner@example.com");
      expect(approved.status).toBe("APPROVED");
      expect(approved.enabledForCalculation).toBe(true);
      expect(approved.reviewedBy).toBe("owner@example.com");
      expect(approved.approvedAt).toBeTruthy();

      await expect(
        repo.updateDraft(approved.id, { metValue: 4.0 }),
      ).rejects.toThrow(/IMMUTABLE/);

      const selected = await repo.resolveApproved(revisionId);
      expect(selected?.id).toBe(approved.id);
      expect(selected?.metValue).toBe(3.8);

      const retired = await repo.retire(approved.id, "pilot-replace");
      expect(retired.status).toBe("RETIRED");
      expect(await repo.resolveApproved(revisionId)).toBeNull();
    });
  }, 300_000);

  it("weight resolver isolates tenants and prefers measured weight", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const userA = await createUser(pool);
      const userB = await createUser(pool);
      await pool.query(
        `INSERT INTO "UserProfile" (
           id, "userId", "displayName", "ageYears", "heightCm", "weightKg",
           "activityLevel", locale, timezone
         ) VALUES (
           gen_random_uuid(), $1::uuid, 'A', 30, 170, 80,
           'moderate', 'ru', 'UTC'
         )`,
        [userA],
      );
      await pool.query(
        `INSERT INTO "ProgressEntry" ("userId", "weightKg", "measuredAt", "createdAt")
         VALUES
           ($1::uuid, 72.5, '2026-08-04T10:00:00.000Z', '2026-08-04T10:00:01.000Z'),
           ($2::uuid, 99.0, '2026-08-04T10:00:00.000Z', '2026-08-04T10:00:01.000Z')`,
        [userA, userB],
      );
      await pool.query(
        `INSERT INTO "UserGoal" ("profileId", kind, target, unit)
         SELECT id, 'WEIGHT', 60, 'kg' FROM "UserProfile" WHERE "userId" = $1::uuid`,
        [userA],
      );

      const asOf = "2026-08-05T12:00:00.000Z";
      const entriesA = await pool.query<{
        id: string;
        userId: string;
        weightKg: string;
        measuredAt: string;
        createdAt: string;
      }>(
        `SELECT id, "userId", "weightKg"::text AS "weightKg",
                "measuredAt"::text AS "measuredAt", "createdAt"::text AS "createdAt"
         FROM "ProgressEntry" WHERE "userId" = $1::uuid`,
        [userA],
      );
      const entriesB = await pool.query<{
        id: string;
        userId: string;
        weightKg: string;
        measuredAt: string;
        createdAt: string;
      }>(
        `SELECT id, "userId", "weightKg"::text AS "weightKg",
                "measuredAt"::text AS "measuredAt", "createdAt"::text AS "createdAt"
         FROM "ProgressEntry" WHERE "userId" = $1::uuid`,
        [userB],
      );

      const resolvedA = resolveWorkoutEnergyWeight({
        userId: userA,
        asOf,
        progressEntries: [
          ...entriesA.rows.map((r) => ({
            id: r.id,
            userId: r.userId,
            weightKg: Number(r.weightKg),
            measuredAt: r.measuredAt,
            createdAt: r.createdAt,
          })),
          ...entriesB.rows.map((r) => ({
            id: r.id,
            userId: r.userId,
            weightKg: Number(r.weightKg),
            measuredAt: r.measuredAt,
            createdAt: r.createdAt,
          })),
        ],
        profile: { userId: userA, weightKg: 80 },
      });
      expect(resolvedA).toMatchObject({
        status: "AVAILABLE",
        weightKg: 72.5,
        source: "PROGRESS_MEASUREMENT",
      });
      expect(resolvedA.weightKg).not.toBe(99);
      expect(resolvedA.weightKg).not.toBe(60);
    });
  }, 300_000);

  it("pilot dry-run validates; apply loads only reviewed subset; calculator uses approved MET", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = createDb();
      const dry = await loadEnergyPilotProfiles({ db, mode: "dry-run" });
      expect(dry.valid).toBe(true);
      expect(dry.created).toBe(0);
      expect(dry.wouldCreate).toBe(ENERGY_PILOT_MAPPINGS.length);

      const applied = await loadEnergyPilotProfiles({
        db,
        mode: "apply",
        reviewedBy: "owner@example.com",
      });
      expect(applied.valid).toBe(true);
      expect(applied.created).toBe(ENERGY_PILOT_MAPPINGS.length);
      expect(applied.approved).toBe(ENERGY_PILOT_MAPPINGS.length);

      for (const pilot of ENERGY_PILOT_MAPPINGS) {
        expect(pilot.expectedPublishedRevisionNumber).toBe(2);
        const pin = await pool.query<{ revisionNumber: number }>(
          `SELECT r."revisionNumber" AS "revisionNumber"
           FROM "WorkoutCatalogRelease" rel
           JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
           JOIN "Exercise" e ON e.id = i."exerciseId"
           JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
           WHERE rel.status = 'PUBLISHED' AND e.key = $1
           LIMIT 1`,
          [pilot.exerciseKey],
        );
        expect(pin.rows[0]?.revisionNumber).toBe(2);
        expect(applied.revisionIdsByKey[pilot.exerciseKey]).toBeTruthy();
      }

      const count = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile" WHERE status = 'APPROVED'`,
      );
      expect(Number(count.rows[0]?.n)).toBe(ENERGY_PILOT_MAPPINGS.length);

      const pushUpsRevision = applied.revisionIdsByKey.push_ups!;
      const repo = new ExerciseEnergyProfileRepository(db);
      const profile = await repo.resolveApproved(pushUpsRevision);
      expect(profile?.compendiumCode).toBe("02022");
      expect(profile?.metValue).toBe(3.8);

      const estimate = estimateExerciseEnergy({
        weightKg: 80,
        activeSeconds: 600,
        metValue: profile!.metValue,
        calculationMethod: "MET_DURATION",
        populationType: "ADULT_STANDARD_2024",
        sourceVersion: profile!.sourceVersion,
        policyVersion: profile!.policyVersion,
      });
      expect(estimate.status).toBe("AVAILABLE");
      if (estimate.status === "AVAILABLE") {
        expect(estimate.grossEstimatedKcalPrecise).toBeGreaterThan(
          estimate.restingEstimatedKcalPrecise,
        );
        expect(estimate.incrementalEstimatedKcalPrecise).toBeGreaterThan(0);
      }

      const farmer = await revisionIdForKey(pool, "farmer_carry_dumbbell");
      expect(await repo.resolveApproved(farmer)).toBeNull();
    });
  }, 300_000);

  it("DRAFT profiles are never selected for runtime calculation", async () => {
    await withDisposableMigratedDb(async ({ createDb, pool }) => {
      const db = createDb();
      const repo = new ExerciseEnergyProfileRepository(db);
      const revisionId = await revisionIdForKey(pool, "core_plank");
      await repo.createDraft({
        exerciseRevisionId: revisionId,
        calculationMethod: "MET_DURATION",
        populationType: "ADULT_STANDARD_2024",
        compendiumEdition: "ADULT_2024",
        compendiumCode: "02024",
        metValue: 2.8,
        sourceType: "COMPENDIUM_ADULT_2024",
        sourceReference: "https://pacompendium.com/",
        sourceVersion: "compendium-adult-2024.1",
      });
      expect(await repo.resolveApproved(revisionId)).toBeNull();
    });
  }, 300_000);
});
