/**
 * WORKOUT-ENERGY-01B — migration 218 + immutable session energy persistence.
 * Uses disposable PostgreSQL only (never shared weight_app DB).
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { runSqlMigrations } from "../../scripts/lib/sql-migration-runner.mjs";
import { loadEnergyPilotProfiles } from "../../src/modules/workout-engine/energy/pilot/energy-pilot-loader";
import { loadEnergyTimingPilotProfiles } from "../../src/modules/workout-engine/energy/pilot/energy-timing-pilot-loader";
import { WorkoutSessionRepository } from "../../src/modules/workout-engine/infrastructure/workout-session.repository";
import { withDisposableMigratedDb } from "./helpers/disposable-catalog-db";

const M217 = "217_workout_energy_profile_foundation";
const M218 = "218_workout_session_energy_snapshot";
const M219 = "219_workout_catalog_v3_01a_taxonomy_foundation";
const M220 = "220_auth_01a_identity_invite_recovery";
const M221 = "221_auth_01b_session_privacy_deletion_retention";
const WORKOUT_ENERGY_UPGRADE_MIGRATIONS = [M218, M219, M220, M221];
const SHARED_DB_MARKER = "postgresql://weight_app:weight_app_local@localhost:5432/weight_app";

async function createUser(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1::uuid, $2)`, [
    userId,
    `energy01b-${userId.slice(0, 8)}@example.com`,
  ]);
  return userId;
}

describe("WORKOUT-ENERGY-01B migration + persistence", () => {
  it("upgrades 217 to 218, preserves legacy rows, restores modes, and reruns as a no-op", async () => {
    await withDisposableMigratedDb(
      async ({ pool, connectionString }) => {
        expect(connectionString).not.toBe(SHARED_DB_MARKER);
        expect(connectionString).not.toMatch(/\/weight_app(\?|$)/);

        const userId = await createUser(pool);
        const planId = randomUUID();
        const sessionId = randomUUID();
        const legacyExerciseId = randomUUID();
        await pool.query(
          `INSERT INTO "WorkoutPlan" (
             id, "userId", version, status, "algorithmVersion", "inputSnapshotJson", "generatedAt"
           ) VALUES ($1::uuid, $2::uuid, 1, 'active', 'energy-01b-test', '{}'::jsonb, now())`,
          [planId, userId],
        );
        await pool.query(
          `INSERT INTO "WorkoutSession" (
             id, "userId", "workoutPlanId", "sourceDayIndex", "effectiveDayIndex",
             "effectiveDate", status, "totalExercises"
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 0, '2026-08-05', 'ACTIVE', 1)`,
          [sessionId, userId, planId],
        );
        await pool.query(
          `INSERT INTO "WorkoutSessionExercise" (
             id, "sessionId", "orderIndex", "displayNameRu", "displayNameEn", "targetSets"
           ) VALUES ($1::uuid, $2::uuid, 0, 'Историческое', 'Historical', 1)`,
          [legacyExerciseId, sessionId],
        );

        const client = await pool.connect();
        try {
          const applied = await runSqlMigrations(client, {
            migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
          });
          const appliedNames = applied.applied.map((item: { name: string }) => item.name);
          expect(appliedNames.filter((name) => WORKOUT_ENERGY_UPGRADE_MIGRATIONS.includes(name))).toEqual(
            WORKOUT_ENERGY_UPGRADE_MIGRATIONS,
          );
          expect(new Set(appliedNames).size).toBe(appliedNames.length);
        } finally {
          client.release();
        }

        const ledger = await pool.query<{ migrationName: string }>(
          `SELECT "migrationName" FROM "SchemaMigrationLedger"
           WHERE "migrationName" IN ($1, $2)
           ORDER BY "migrationName"`,
          [M217, M218],
        );
        expect(ledger.rows.map((row) => row.migrationName)).toEqual([M217, M218]);

        const latestWorkoutMigration = await pool.query<{ migrationName: string }>(
          `SELECT "migrationName" FROM "SchemaMigrationLedger"
           WHERE "migrationName" = ANY($1::text[])
           ORDER BY "migrationName" DESC LIMIT 1`,
          [WORKOUT_ENERGY_UPGRADE_MIGRATIONS],
        );
        expect(latestWorkoutMigration.rows[0]?.migrationName).toBe(M221);

        const timingTable = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ExerciseEnergyTimingProfile'
           ) AS exists`,
        );
        expect(timingTable.rows[0]?.exists).toBe(true);

        const planColumns = await pool.query<{
          columnName: string;
          isNullable: string;
        }>(
          `SELECT column_name AS "columnName", is_nullable AS "isNullable"
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'WorkoutPlanDay'
             AND column_name IN ('prescriptionMode', 'durationSecondsPerSet')
           ORDER BY column_name`,
        );
        expect(planColumns.rows).toEqual([
          { columnName: "durationSecondsPerSet", isNullable: "YES" },
          { columnName: "prescriptionMode", isNullable: "YES" },
        ]);

        const energyColumnNames = [
          "energyEstimateStatus",
          "plannedGrossEstimatedKcal",
          "plannedRestingEstimatedKcal",
          "plannedIncrementalEstimatedKcal",
          "energyWeightKgUsed",
          "energyWeightSource",
          "energyWeightSourceRecordedAt",
          "energyActiveSecondsUsed",
          "exerciseEnergyProfileId",
          "exerciseEnergyTimingProfileId",
          "energyCalculationMethod",
          "energyPopulationType",
          "energyPolicyVersion",
          "energySourceVersion",
          "energyCalculatedAt",
        ].sort();
        const energyColumns = await pool.query<{
          columnName: string;
          columnDefault: string | null;
        }>(
          `SELECT column_name AS "columnName", column_default AS "columnDefault"
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'WorkoutSessionExercise'
             AND column_name = ANY($1::text[])
           ORDER BY column_name`,
          [energyColumnNames],
        );
        expect(energyColumns.rows.map((row) => row.columnName)).toEqual(energyColumnNames);
        expect(
          energyColumns.rows.find((row) => row.columnName === "energyEstimateStatus")
            ?.columnDefault,
        ).toBeNull();
        expect(energyColumns.rows.every((row) => !row.columnDefault?.includes("AVAILABLE"))).toBe(
          true,
        );

        const legacy = await pool.query<{
          status: string | null;
          gross: string | null;
          resting: string | null;
          incremental: string | null;
        }>(
          `SELECT "energyEstimateStatus" AS status,
                  "plannedGrossEstimatedKcal"::text AS gross,
                  "plannedRestingEstimatedKcal"::text AS resting,
                  "plannedIncrementalEstimatedKcal"::text AS incremental
           FROM "WorkoutSessionExercise" WHERE id = $1::uuid`,
          [legacyExerciseId],
        );
        expect(legacy.rows[0]).toEqual({
          status: null,
          gross: null,
          resting: null,
          incremental: null,
        });

        const modes = await pool.query<{ key: string; repetitionMode: string | null }>(
          `SELECT e.key, r."repetitionMode"
           FROM "WorkoutCatalogRelease" rel
           JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
           JOIN "Exercise" e ON e.id = i."exerciseId"
           JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
           WHERE rel.status = 'PUBLISHED'
             AND e.key IN ('push_ups', 'core_plank', 'wall_angels')
           ORDER BY e.key`,
        );
        expect(Object.fromEntries(modes.rows.map((row) => [row.key, row.repetitionMode]))).toEqual({
          core_plank: "DURATION",
          push_ups: "REPS",
          wall_angels: "REPS_OR_DURATION",
        });

        const rerunClient = await pool.connect();
        try {
          const rerun = await runSqlMigrations(rerunClient, {
            migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
          });
          expect(rerun.applied).toEqual([]);
        } finally {
          rerunClient.release();
        }
      },
      { stopBefore: M218 },
    );
  }, 300_000);

  it("loads both pilots and stores constrained immutable available/unavailable snapshots", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      expect(connectionString).not.toBe(SHARED_DB_MARKER);
      expect(connectionString).not.toMatch(/\/weight_app(\?|$)/);

      const db = createDb();
      const energyLoad = await loadEnergyPilotProfiles({
        db,
        mode: "apply",
        reviewedBy: "owner@example.com",
      });
      const timingLoad = await loadEnergyTimingPilotProfiles({
        db,
        mode: "apply",
        reviewedBy: "owner@example.com",
      });
      expect(energyLoad).toMatchObject({ valid: true, created: 8, approved: 8 });
      // FIX-01: production timing pilots removed — zero runtime mappings.
      expect(timingLoad).toMatchObject({ valid: true, created: 0, approved: 0, mappingsReviewed: 0 });

      const core = await pool.query<{
        exerciseId: string;
        revisionId: string;
        energyProfileId: string;
      }>(
        `SELECT e.id AS "exerciseId", r.id AS "revisionId", p.id AS "energyProfileId"
         FROM "WorkoutCatalogRelease" rel
         JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
         JOIN "Exercise" e ON e.id = i."exerciseId"
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "ExerciseEnergyProfile" p
           ON p."exerciseRevisionId" = r.id
          AND p.status = 'APPROVED'
          AND p."enabledForCalculation" = true
         WHERE rel.status = 'PUBLISHED'
           AND e.key = 'core_plank'`,
      );
      expect(core.rows).toHaveLength(1);
      const catalog = core.rows[0]!;

      const userId = await createUser(pool);
      const measuredAt = "2026-08-04T08:00:00.000Z";
      const startedAt = new Date("2026-08-05T12:00:00.000Z");
      await pool.query(
        `INSERT INTO "ProgressEntry" ("userId", "weightKg", "measuredAt", "createdAt")
         VALUES ($1::uuid, 80, $2::timestamptz, $2::timestamptz)`,
        [userId, measuredAt],
      );

      const planId = randomUUID();
      const planDayId = randomUUID();
      await pool.query(
        `INSERT INTO "WorkoutPlan" (
           id, "userId", version, status, "algorithmVersion", "inputSnapshotJson", "generatedAt"
         ) VALUES ($1::uuid, $2::uuid, 1, 'active', 'energy-01b-test', '{}'::jsonb, now())`,
        [planId, userId],
      );
      await pool.query(
        `INSERT INTO "WorkoutPlanDay" (
           id, "workoutPlanId", "dayIndex", "exerciseOrder", "exerciseName", "riskLevel",
           "dayTitle", "isRestDay", sets, "repsMin", "repsMax", "restSeconds",
           "prescriptionMode", "durationSecondsPerSet", "exerciseId"
         ) VALUES (
           $1::uuid, $2::uuid, 0, 0, 'core_plank', 'low',
           'Duration day', false, 1, NULL, NULL, 60, 'DURATION', 45, $3::uuid
         )`,
        [planDayId, planId, catalog.exerciseId],
      );

      const repository = new WorkoutSessionRepository(db);
      const session = await repository.createSnapshotSession({
        userId,
        workoutPlanId: planId,
        sourceDayIndex: 0,
        effectiveDayIndex: 0,
        effectiveDate: "2026-08-05",
        dayTitle: "Duration day",
        estimatedMinutes: 10,
        startedAt,
        exercises: [
          {
            sourceExerciseId: catalog.exerciseId,
            exerciseRevisionId: catalog.revisionId,
            catalogReleaseId: null,
            sourcePlanDayRowId: planDayId,
            exerciseKey: "core_plank",
            orderIndex: 0,
            displayNameRu: "Планка",
            displayNameEn: "Plank",
            targetSets: 1,
            targetRepsMin: null,
            targetRepsMax: null,
            targetDurationSeconds: 45,
            restSeconds: 60,
            techniqueSummaryRu: null,
            techniqueSummaryEn: null,
            commonMistakeRu: null,
            commonMistakeEn: null,
            easierVariantRu: null,
            easierVariantEn: null,
            breathingRu: null,
            breathingEn: null,
            stopConditionsRu: null,
            stopConditionsEn: null,
            media: [],
            energySnapshot: {
              energyEstimateStatus: "AVAILABLE",
              plannedGrossEstimatedKcal: 7.6,
              plannedRestingEstimatedKcal: 2,
              plannedIncrementalEstimatedKcal: 5.6,
              energyWeightKgUsed: 80,
              energyWeightSource: "PROGRESS_MEASUREMENT",
              energyWeightSourceRecordedAt: measuredAt,
              energyActiveSecondsUsed: 45,
              exerciseEnergyProfileId: catalog.energyProfileId,
              exerciseEnergyTimingProfileId: null,
              energyCalculationMethod: "MET_DURATION",
              energyPopulationType: "ADULT_STANDARD_2024",
              energyPolicyVersion: "workout-energy-1.0",
              energySourceVersion: "compendium-adult-2024.1",
              energyCalculatedAt: startedAt,
            },
          },
          {
            sourceExerciseId: catalog.exerciseId,
            exerciseRevisionId: catalog.revisionId,
            catalogReleaseId: null,
            sourcePlanDayRowId: null,
            exerciseKey: "missing-profile-probe",
            orderIndex: 1,
            displayNameRu: "Недоступно",
            displayNameEn: "Unavailable",
            targetSets: 1,
            targetRepsMin: null,
            targetRepsMax: null,
            targetDurationSeconds: 30,
            restSeconds: 0,
            techniqueSummaryRu: null,
            techniqueSummaryEn: null,
            commonMistakeRu: null,
            commonMistakeEn: null,
            easierVariantRu: null,
            easierVariantEn: null,
            breathingRu: null,
            breathingEn: null,
            stopConditionsRu: null,
            stopConditionsEn: null,
            media: [],
            energySnapshot: {
              energyEstimateStatus: "UNAVAILABLE_MISSING_ENERGY_PROFILE",
              plannedGrossEstimatedKcal: null,
              plannedRestingEstimatedKcal: null,
              plannedIncrementalEstimatedKcal: null,
              energyWeightKgUsed: 80,
              energyWeightSource: "PROGRESS_MEASUREMENT",
              energyWeightSourceRecordedAt: measuredAt,
              energyActiveSecondsUsed: 30,
              exerciseEnergyProfileId: null,
              exerciseEnergyTimingProfileId: null,
              energyCalculationMethod: null,
              energyPopulationType: null,
              energyPolicyVersion: null,
              energySourceVersion: null,
              energyCalculatedAt: startedAt,
            },
          },
        ],
      });

      const planDay = await pool.query<{
        prescriptionMode: string | null;
        durationSecondsPerSet: number | null;
        repsMin: number | null;
        repsMax: number | null;
      }>(
        `SELECT "prescriptionMode", "durationSecondsPerSet", "repsMin", "repsMax"
         FROM "WorkoutPlanDay" WHERE id = $1::uuid`,
        [planDayId],
      );
      expect(planDay.rows[0]).toEqual({
        prescriptionMode: "DURATION",
        durationSecondsPerSet: 45,
        repsMin: null,
        repsMax: null,
      });

      const setTargets = await pool.query<{
        orderIndex: number;
        targetReps: number | null;
        targetDurationSeconds: number | null;
      }>(
        `SELECT e."orderIndex", s."targetReps", s."targetDurationSeconds"
         FROM "WorkoutSessionSet" s
         JOIN "WorkoutSessionExercise" e ON e.id = s."sessionExerciseId"
         WHERE e."sessionId" = $1::uuid
         ORDER BY e."orderIndex", s."setIndex"`,
        [session.id],
      );
      expect(setTargets.rows).toHaveLength(2);
      for (const row of setTargets.rows) {
        expect((row.targetReps == null) !== (row.targetDurationSeconds == null)).toBe(true);
      }

      const snapshots = await pool.query<{
        orderIndex: number;
        status: string | null;
        gross: string | null;
        resting: string | null;
        incremental: string | null;
        weight: string | null;
        activeSeconds: string | null;
        profileId: string | null;
      }>(
        `SELECT "orderIndex", "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "exerciseEnergyProfileId"::text AS "profileId"
         FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid
         ORDER BY "orderIndex"`,
        [session.id],
      );
      expect(snapshots.rows[0]).toMatchObject({
        status: "AVAILABLE",
        gross: "7.6000",
        resting: "2.0000",
        incremental: "5.6000",
        weight: "80.000",
        activeSeconds: "45.0000",
        profileId: catalog.energyProfileId,
      });
      expect(snapshots.rows[1]).toMatchObject({
        status: "UNAVAILABLE_MISSING_ENERGY_PROFILE",
        gross: null,
        resting: null,
        incremental: null,
      });

      const availableExercise = await pool.query<{ id: string }>(
        `SELECT id FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid AND "orderIndex" = 0`,
        [session.id],
      );
      await expect(
        pool.query(
          `UPDATE "WorkoutSessionExercise"
           SET "plannedGrossEstimatedKcal" = NULL
           WHERE id = $1::uuid`,
          [availableExercise.rows[0]!.id],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(`DELETE FROM "ExerciseEnergyProfile" WHERE id = $1::uuid`, [
          catalog.energyProfileId,
        ]),
      ).rejects.toThrow();

      const beforeWeightChange = snapshots.rows[0];
      await pool.query(
        `UPDATE "ProgressEntry" SET "weightKg" = 99 WHERE "userId" = $1::uuid`,
        [userId],
      );
      const afterWeightChange = await pool.query<(typeof snapshots.rows)[number]>(
        `SELECT "orderIndex", "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "exerciseEnergyProfileId"::text AS "profileId"
         FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid AND "orderIndex" = 0`,
        [session.id],
      );
      expect(afterWeightChange.rows[0]).toEqual(beforeWeightChange);
    });
  }, 300_000);

  it("rejects multi-set DURATION plan rows via DB CHECK and preserves energy across replace/undo", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      expect(connectionString).not.toBe(SHARED_DB_MARKER);
      expect(connectionString).not.toMatch(/\/weight_app(\?|$)/);

      const db = createDb();
      const energyLoad = await loadEnergyPilotProfiles({
        db,
        mode: "apply",
        reviewedBy: "owner@example.com",
      });
      expect(energyLoad).toMatchObject({ valid: true, created: 8 });

      const core = await pool.query<{ energyProfileId: string }>(
        `SELECT p.id AS "energyProfileId"
         FROM "WorkoutCatalogRelease" rel
         JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
         JOIN "Exercise" e ON e.id = i."exerciseId"
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "ExerciseEnergyProfile" p
           ON p."exerciseRevisionId" = r.id
          AND p.status = 'APPROVED'
         WHERE rel.status = 'PUBLISHED'
           AND e.key = 'core_plank'`,
      );
      expect(core.rows).toHaveLength(1);
      const energyProfileId = core.rows[0]!.energyProfileId;

      const userId = await createUser(pool);
      const planId = randomUUID();
      await pool.query(
        `INSERT INTO "WorkoutPlan" (
           id, "userId", version, status, "algorithmVersion", "inputSnapshotJson", "generatedAt"
         ) VALUES ($1::uuid, $2::uuid, 1, 'active', 'energy-01b-test', '{}'::jsonb, now())`,
        [planId, userId],
      );

      await expect(
        pool.query(
          `INSERT INTO "WorkoutPlanDay" (
             id, "workoutPlanId", "dayIndex", "exerciseOrder", "exerciseName", "riskLevel",
             "dayTitle", "isRestDay", sets, "repsMin", "repsMax", "restSeconds",
             "prescriptionMode", "durationSecondsPerSet"
           ) VALUES (
             $1::uuid, $2::uuid, 0, 0, 'core_plank', 'low',
             'Bad duration', false, 5, NULL, NULL, 60, 'DURATION', 300
           )`,
          [randomUUID(), planId],
        ),
      ).rejects.toThrow();

      const measuredAt = "2026-08-04T08:00:00.000Z";
      const calculatedAt = "2026-08-05T12:00:00.000Z";
      const sessionId = randomUUID();
      await pool.query(
        `INSERT INTO "WorkoutSession" (
           id, "userId", "workoutPlanId", "sourceDayIndex", "effectiveDayIndex",
           "effectiveDate", status, "totalExercises", version
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 0, '2026-08-05', 'ACTIVE', 1, 1)`,
        [sessionId, userId, planId],
      );
      const exerciseId = randomUUID();
      await pool.query(
        `INSERT INTO "WorkoutSessionExercise" (
           id, "sessionId", "orderIndex", "exerciseKey", "displayNameRu", "displayNameEn",
           "targetSets", "targetRepsMin", "targetRepsMax", "targetDurationSeconds", "restSeconds",
           "mediaSnapshotJson", status,
           "energyEstimateStatus", "plannedGrossEstimatedKcal", "plannedRestingEstimatedKcal",
           "plannedIncrementalEstimatedKcal", "energyWeightKgUsed", "energyWeightSource",
           "energyWeightSourceRecordedAt", "energyActiveSecondsUsed", "exerciseEnergyProfileId",
           "energyCalculationMethod", "energyPopulationType", "energyPolicyVersion",
           "energySourceVersion", "energyCalculatedAt"
         ) VALUES (
           $1::uuid, $2::uuid, 0, 'core_plank', 'Планка', 'Plank',
           1, NULL, NULL, 300, 60, '[]'::jsonb, 'PENDING',
           'AVAILABLE', 7.6000, 2.0000, 5.6000, 80.000, 'PROGRESS_MEASUREMENT',
           $3::timestamptz, 300.0000, $5::uuid,
           'MET_DURATION', 'ADULT_STANDARD_2024', 'workout-energy-1.0',
           'compendium-adult-2024.1', $4::timestamptz
         )`,
        [exerciseId, sessionId, measuredAt, calculatedAt, energyProfileId],
      );
      await pool.query(
        `INSERT INTO "WorkoutSessionSet" ("sessionExerciseId", "setIndex", "targetReps", "targetDurationSeconds")
         VALUES ($1::uuid, 1, NULL, 300)`,
        [exerciseId],
      );

      const before = await pool.query<{
        status: string | null;
        gross: string | null;
        resting: string | null;
        incremental: string | null;
        weight: string | null;
        activeSeconds: string | null;
        calculatedAt: string | null;
      }>(
        `SELECT "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "energyCalculatedAt"::text AS "calculatedAt"
         FROM "WorkoutSessionExercise" WHERE id = $1::uuid`,
        [exerciseId],
      );

      const energyFields = {
        energyEstimateStatus: "AVAILABLE",
        plannedGrossEstimatedKcal: 7.6,
        plannedRestingEstimatedKcal: 2,
        plannedIncrementalEstimatedKcal: 5.6,
        energyWeightKgUsed: 80,
        energyWeightSource: "PROGRESS_MEASUREMENT",
        energyWeightSourceRecordedAt: measuredAt,
        energyActiveSecondsUsed: 300,
        exerciseEnergyProfileId: energyProfileId,
        exerciseEnergyTimingProfileId: null,
        energyCalculationMethod: "MET_DURATION",
        energyPopulationType: "ADULT_STANDARD_2024",
        energyPolicyVersion: "workout-energy-1.0",
        energySourceVersion: "compendium-adult-2024.1",
        energyCalculatedAt: calculatedAt,
      };

      const repository = new WorkoutSessionRepository(db);
      const unchangedSnapshot = {
        id: sessionId,
        workoutPlanId: planId,
        sourceDayIndex: 0,
        effectiveDayIndex: 0,
        effectiveDate: "2026-08-05",
        dayTitle: "Duration day",
        estimatedMinutes: 10,
        version: 1,
        catalogReleaseId: null,
        exercises: [
          {
            orderIndex: 0,
            exerciseKey: "core_plank",
            sourceExerciseId: null,
            exerciseRevisionId: null,
            catalogReleaseId: null,
            displayNameRu: "Планка",
            displayNameEn: "Plank",
            targetSets: 1,
            targetRepsMin: null,
            targetRepsMax: null,
            targetDurationSeconds: 300,
            restSeconds: 60,
            techniqueSummaryRu: null,
            techniqueSummaryEn: null,
            commonMistakeRu: null,
            commonMistakeEn: null,
            easierVariantRu: null,
            easierVariantEn: null,
            breathingRu: null,
            breathingEn: null,
            stopConditionsRu: null,
            stopConditionsEn: null,
            media: [],
            ...energyFields,
          },
        ],
      };

      const afterReplace = await db.withTransaction(async (query) =>
        repository.replaceSessionContent(query, userId, sessionId, 1, unchangedSnapshot),
      );
      expect(afterReplace.version).toBe(2);

      const preserved = await pool.query<(typeof before.rows)[number]>(
        `SELECT "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "energyCalculatedAt"::text AS "calculatedAt"
         FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid AND "orderIndex" = 0`,
        [sessionId],
      );
      expect(preserved.rows[0]).toMatchObject({
        status: before.rows[0]!.status,
        gross: before.rows[0]!.gross,
        resting: before.rows[0]!.resting,
        incremental: before.rows[0]!.incremental,
        weight: before.rows[0]!.weight,
        activeSeconds: before.rows[0]!.activeSeconds,
      });
      expect(preserved.rows[0]!.calculatedAt).toMatch(/2026-08-05/);

      const replacementCalculatedAt = "2026-08-05T13:30:00.000Z";
      const replacedSnapshot = {
        ...unchangedSnapshot,
        version: 2,
        exercises: [
          {
            ...unchangedSnapshot.exercises[0]!,
            exerciseKey: "morning_walk",
            displayNameRu: "Прогулка",
            displayNameEn: "Walk",
            targetDurationSeconds: 600,
            energyEstimateStatus: "AVAILABLE",
            plannedGrossEstimatedKcal: 40,
            plannedRestingEstimatedKcal: 10,
            plannedIncrementalEstimatedKcal: 30,
            energyActiveSecondsUsed: 600,
            energyCalculatedAt: replacementCalculatedAt,
          },
        ],
      };
      await db.withTransaction(async (query) =>
        repository.replaceSessionContent(query, userId, sessionId, 2, replacedSnapshot),
      );
      const replaced = await pool.query<{
        key: string | null;
        activeSeconds: string | null;
        calculatedAt: string | null;
        gross: string | null;
      }>(
        `SELECT "exerciseKey" AS key,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "energyCalculatedAt"::text AS "calculatedAt",
                "plannedGrossEstimatedKcal"::text AS gross
         FROM "WorkoutSessionExercise" WHERE "sessionId" = $1::uuid`,
        [sessionId],
      );
      expect(replaced.rows[0]).toMatchObject({
        key: "morning_walk",
        activeSeconds: "600.0000",
        gross: "40.0000",
      });
      expect(replaced.rows[0]!.calculatedAt).toMatch(/13:30/);

      await db.withTransaction(async (query) =>
        repository.replaceSessionContent(query, userId, sessionId, 3, {
          ...unchangedSnapshot,
          version: 3,
        }),
      );
      const restored = await pool.query<(typeof before.rows)[number]>(
        `SELECT "energyEstimateStatus" AS status,
                "plannedGrossEstimatedKcal"::text AS gross,
                "plannedRestingEstimatedKcal"::text AS resting,
                "plannedIncrementalEstimatedKcal"::text AS incremental,
                "energyWeightKgUsed"::text AS weight,
                "energyActiveSecondsUsed"::text AS "activeSeconds",
                "energyCalculatedAt"::text AS "calculatedAt"
         FROM "WorkoutSessionExercise"
         WHERE "sessionId" = $1::uuid AND "orderIndex" = 0`,
        [sessionId],
      );
      expect(restored.rows[0]).toMatchObject({
        status: before.rows[0]!.status,
        gross: before.rows[0]!.gross,
        resting: before.rows[0]!.resting,
        incremental: before.rows[0]!.incremental,
        weight: before.rows[0]!.weight,
        activeSeconds: before.rows[0]!.activeSeconds,
      });
      expect(restored.rows[0]!.calculatedAt).toMatch(/2026-08-05.*12:00/);
    });
  }, 300_000);
});
