/**
 * CONTENT-01B controlled content loader — disposable DB only.
 * Covers idempotency, conflict, rollback, retire/replace, concurrency, env allowlist, stale dry-run.
 */
import { describe, expect, it } from "vitest";
import { ENERGY_CONTENT_MAPPINGS } from "../../src/modules/workout-engine/energy/content/energy-content-manifest";
import { TIMING_CONTENT_MAPPINGS } from "../../src/modules/workout-engine/energy/content/timing-content-manifest";
import {
  withEnergyChecksum,
  withTimingChecksum,
} from "../../src/modules/workout-engine/energy/content/content-checksum";
import {
  CONTENT_LOADER_ADVISORY_LOCK_KEY,
  confirmContentLoaderApplyDatabase,
  formatContentVersionMarkerLine,
  runWorkoutEnergyContentLoad,
} from "../../src/modules/workout-engine/energy/content/content-loader";
import { WORKOUT_ENERGY_TIMING_REVIEWED_BY } from "../../src/modules/workout-engine/energy/content/timing-methodology";
import { confirmSafeDisposableDatabase } from "../../src/test-support/assert-disposable-database";
import { withDisposableMigratedDb } from "./helpers/disposable-catalog-db";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  const interval = opts.intervalMs ?? 25;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(interval);
  }
  throw new Error(`TIMEOUT_WAITING:${opts.label}`);
}

describe("WORKOUT-ENERGY-CONTENT loader persistence", () => {
  it("validate/dry-run/apply idempotency, conflict, env reject, rollback", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const confirmed = confirmSafeDisposableDatabase(connectionString);
      expect(confirmed).toBe("SAFE_DISPOSABLE_DATABASE_CONFIRMED");
      expect(confirmContentLoaderApplyDatabase(connectionString)).toBe(
        "SAFE_DISPOSABLE_DATABASE_CONFIRMED",
      );
      process.stdout.write(`SAFE_DISPOSABLE_DATABASE_CONFIRMED\n`);

      const db = createDb();

      const validate = await runWorkoutEnergyContentLoad({
        mode: "validate",
        energyMappings: ENERGY_CONTENT_MAPPINGS,
        timingMappings: [],
      });
      expect(validate.ok).toBe(true);

      const before = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile"`,
      );
      expect(Number(before.rows[0]?.n)).toBe(0);

      const dry = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db,
        databaseUrl: connectionString,
        energyMappings: ENERGY_CONTENT_MAPPINGS,
        timingMappings: [],
      });
      expect(dry.ok).toBe(true);
      expect(dry.counts.plannedNew).toBe(ENERGY_CONTENT_MAPPINGS.length);
      expect(dry.counts.appliedNew).toBe(0);

      const afterDry = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile"`,
      );
      expect(Number(afterDry.rows[0]?.n)).toBe(0);

      const first = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: ENERGY_CONTENT_MAPPINGS,
        timingMappings: [],
        reviewedBy: "weight-app-internal-content-review-v1",
      });
      expect(first.ok).toBe(true);
      expect(first.disposableConfirmed).toBe("SAFE_DISPOSABLE_DATABASE_CONFIRMED");
      expect(first.appliedLockedPlan).not.toBeNull();
      expect(first.counts.appliedNew).toBe(ENERGY_CONTENT_MAPPINGS.length);
      expect(first.counts.appliedUnchanged).toBe(0);

      const approved = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile"
         WHERE status = 'APPROVED' AND "enabledForCalculation" = true`,
      );
      expect(Number(approved.rows[0]?.n)).toBe(ENERGY_CONTENT_MAPPINGS.length);

      const second = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: ENERGY_CONTENT_MAPPINGS,
        timingMappings: [],
      });
      expect(second.ok).toBe(true);
      expect(second.counts.plannedUnchanged).toBe(ENERGY_CONTENT_MAPPINGS.length);
      expect(second.counts.appliedNew).toBe(0);
      expect(second.counts.appliedUnchanged).toBe(ENERGY_CONTENT_MAPPINGS.length);

      const third = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: ENERGY_CONTENT_MAPPINGS,
        timingMappings: [],
      });
      expect(third.ok).toBe(true);
      expect(third.counts.appliedNew).toBe(0);
      expect(third.counts.appliedRetired).toBe(0);
      expect(third.counts.plannedUnchanged).toBe(ENERGY_CONTENT_MAPPINGS.length);

      const reordered = [...ENERGY_CONTENT_MAPPINGS].reverse();
      const reorderedApply = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: reordered,
        timingMappings: [],
      });
      expect(reorderedApply.ok).toBe(true);
      expect(reorderedApply.counts.appliedNew).toBe(0);
      expect(reorderedApply.counts.plannedUnchanged).toBe(ENERGY_CONTENT_MAPPINGS.length);

      const stretching = ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === "stretching")!;
      const sameVersionMutated = withEnergyChecksum({
        ...stretching,
        metValue: 9.9,
      });
      const conflictPlan = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db,
        databaseUrl: connectionString,
        energyMappings: [sameVersionMutated],
        timingMappings: [],
      });
      expect(conflictPlan.items.some((i) => i.outcome === "CONFLICT")).toBe(true);
      expect(conflictPlan.ok).toBe(false);

      const pushUps = ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === "push_ups")!;
      const wrongRev = withEnergyChecksum({
        ...pushUps,
        expectedPublishedRevisionNumber: 1,
      });
      const wrong = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db,
        databaseUrl: connectionString,
        energyMappings: [wrongRev],
        timingMappings: [],
      });
      expect(wrong.items[0]?.outcome).toBe("REVISION_PIN_MISMATCH");
      expect(wrong.ok).toBe(false);

      const beforeRollback = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile" WHERE status = 'RETIRED'`,
      );
      const retiredBefore = Number(beforeRollback.rows[0]?.n);

      const replaceEntry = withEnergyChecksum({
        ...stretching,
        contentVersion: "workout-energy-content-01b-batch-01-rollback-probe",
        sourceReference: `citation\n${formatContentVersionMarkerLine(
          "workout-energy-content-01b-batch-01-rollback-probe",
        )}`,
        reviewedAt: "2026-08-07",
        reviewedBy: "weight-app-internal-content-review-v1",
      });

      await expect(
        runWorkoutEnergyContentLoad({
          mode: "apply",
          db,
          databaseUrl: connectionString,
          energyMappings: [replaceEntry],
          timingMappings: [],
          injectFailureAfterWrites: 1,
        }),
      ).rejects.toThrow(/CONTENT_LOADER_INJECTED_FAILURE/);

      const afterRollback = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile" WHERE status = 'RETIRED'`,
      );
      expect(Number(afterRollback.rows[0]?.n)).toBe(retiredBefore);

      const stillApproved = await pool.query<{ n: string; met: string }>(
        `SELECT COUNT(*)::text AS n, MAX(e."metValue")::text AS met
         FROM "ExerciseEnergyProfile" e
         JOIN "ExerciseRevision" r ON r.id = e."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'stretching'
           AND e.status = 'APPROVED'
           AND e."enabledForCalculation" = true`,
      );
      expect(Number(stillApproved.rows[0]?.n)).toBe(1);
      expect(Number(stillApproved.rows[0]?.met)).toBe(stretching.metValue);

      const sharedReject = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: "postgresql://weight_app:weight_app_local@localhost:5432/weight_app",
        energyMappings: ENERGY_CONTENT_MAPPINGS.slice(0, 1),
        timingMappings: [],
      });
      expect(sharedReject.ok).toBe(false);
      expect(sharedReject.issues.some((i) => i.code === "UNSAFE_DATABASE_TARGET")).toBe(true);
      expect(JSON.stringify(sharedReject)).not.toMatch(/weight_app_local/);

      const remoteReject = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: "postgresql://u:secretpass@staging.example.com:5432/wt_cat_fake",
        energyMappings: ENERGY_CONTENT_MAPPINGS.slice(0, 1),
        timingMappings: [],
      });
      expect(remoteReject.ok).toBe(false);
      expect(JSON.stringify(remoteReject)).not.toMatch(/secretpass/);

      const snapTable = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'WorkoutSessionEnergySnapshot'
         ) AS exists`,
      );
      if (snapTable.rows[0]?.exists) {
        const snaps = await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM "WorkoutSessionEnergySnapshot"`,
        );
        expect(Number(snaps.rows[0]?.n)).toBe(0);
      }
    });
  }, 300_000);

  it("successful RETIRE_AND_REPLACE then UNCHANGED; invalid V2 does not retire", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const db = createDb();
      const stretching = ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === "stretching")!;

      const v1 = withEnergyChecksum({
        ...stretching,
        contentVersion: "workout-energy-content-01b-retire-v1",
        sourceReference: `v1 citation\n${formatContentVersionMarkerLine(
          "workout-energy-content-01b-retire-v1",
        )}`,
      });

      const applyV1 = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [v1],
        timingMappings: [],
      });
      expect(applyV1.ok).toBe(true);
      expect(applyV1.counts.appliedNew).toBe(1);

      const afterV1 = await pool.query<{
        status: string;
        enabled: boolean;
        ref: string;
        met: string;
      }>(
        `SELECT e.status, e."enabledForCalculation" AS enabled, e."sourceReference" AS ref, e."metValue"::text AS met
         FROM "ExerciseEnergyProfile" e
         JOIN "ExerciseRevision" r ON r.id = e."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'stretching'
         ORDER BY e."createdAt"`,
      );
      expect(afterV1.rows).toHaveLength(1);
      expect(afterV1.rows[0]?.status).toBe("APPROVED");
      expect(afterV1.rows[0]?.enabled).toBe(true);
      expect(afterV1.rows[0]?.ref).toContain("WA_CONTENT_VERSION_V1=workout-energy-content-01b-retire-v1");

      const invalidV2 = withEnergyChecksum({
        ...stretching,
        contentVersion: "workout-energy-content-01b-retire-v1",
        metValue: 9.9,
        sourceReference: `mutated\n${formatContentVersionMarkerLine(
          "workout-energy-content-01b-retire-v1",
        )}`,
      });
      const invalidApply = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [invalidV2],
        timingMappings: [],
      });
      expect(invalidApply.ok).toBe(false);
      expect(invalidApply.items[0]?.outcome).toBe("CONFLICT");
      const stillOne = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile" e
         JOIN "ExerciseRevision" r ON r.id = e."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'stretching' AND e.status = 'APPROVED' AND e."enabledForCalculation" = true`,
      );
      expect(Number(stillOne.rows[0]?.n)).toBe(1);

      const v2 = withEnergyChecksum({
        ...stretching,
        contentVersion: "workout-energy-content-01b-retire-v2",
        metValue: stretching.metValue,
        sourceReference: `v2 citation\n${formatContentVersionMarkerLine(
          "workout-energy-content-01b-retire-v2",
        )}`,
        reviewedAt: "2026-08-07",
        reviewedBy: "weight-app-internal-content-review-v1",
      });

      const applyV2 = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [v2],
        timingMappings: [],
      });
      expect(applyV2.ok).toBe(true);
      expect(applyV2.items[0]?.outcome).toBe("RETIRE_AND_REPLACE");
      expect(applyV2.counts.appliedRetired).toBe(1);
      expect(applyV2.counts.appliedNew).toBe(1);

      const rows = await pool.query<{
        status: string;
        enabled: boolean;
        ref: string;
      }>(
        `SELECT e.status, e."enabledForCalculation" AS enabled, e."sourceReference" AS ref
         FROM "ExerciseEnergyProfile" e
         JOIN "ExerciseRevision" r ON r.id = e."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'stretching'
         ORDER BY e."createdAt"`,
      );
      expect(rows.rows).toHaveLength(2);
      const retired = rows.rows.find((r) => r.status === "RETIRED");
      const active = rows.rows.find((r) => r.status === "APPROVED" && r.enabled);
      expect(retired?.enabled).toBe(false);
      expect(retired?.ref).toContain("WA_CONTENT_VERSION_V1=workout-energy-content-01b-retire-v1");
      expect(active?.ref).toContain("WA_CONTENT_VERSION_V1=workout-energy-content-01b-retire-v2");

      const repeatV2 = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [v2],
        timingMappings: [],
      });
      expect(repeatV2.ok).toBe(true);
      expect(repeatV2.items[0]?.outcome).toBe("UNCHANGED");
      expect(repeatV2.counts.appliedNew).toBe(0);
      const finalCount = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile" e
         JOIN "ExerciseRevision" r ON r.id = e."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'stretching'`,
      );
      expect(Number(finalCount.rows[0]?.n)).toBe(2);
    });
  }, 300_000);

  it("real two-connection concurrent first apply: one NEW, waiter UNCHANGED, no duplicates", async () => {
    const started = Date.now();
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const subset = ENERGY_CONTENT_MAPPINGS.filter((e) =>
        ["stretching", "wall_sit"].includes(e.exerciseKey),
      );
      expect(subset.length).toBe(2);

      const dbA = createDb();
      const dbB = createDb();

      let releaseA!: () => void;
      const holdA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aLocked = false;

      const applyAPromise = runWorkoutEnergyContentLoad({
        mode: "apply",
        db: dbA,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
        testHoldAfterLock: async () => {
          aLocked = true;
          await holdA;
        },
      });

      await waitUntil(async () => aLocked, {
        timeoutMs: 30_000,
        label: "applyA_acquired_lock",
      });

      // Confirm A holds the advisory transaction lock and B will wait.
      const lockHeld = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
         FROM pg_locks
         WHERE locktype = 'advisory'
           AND objid = $1
           AND granted = true`,
        [CONTENT_LOADER_ADVISORY_LOCK_KEY],
      );
      expect(Number(lockHeld.rows[0]?.n)).toBeGreaterThanOrEqual(1);

      const applyBPromise = runWorkoutEnergyContentLoad({
        mode: "apply",
        db: dbB,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
      });

      await waitUntil(
        async () => {
          const waiting = await pool.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n
             FROM pg_locks
             WHERE locktype = 'advisory'
               AND objid = $1
               AND granted = false`,
            [CONTENT_LOADER_ADVISORY_LOCK_KEY],
          );
          return Number(waiting.rows[0]?.n) >= 1;
        },
        { timeoutMs: 30_000, label: "applyB_waiting_on_lock" },
      );

      releaseA();
      const [resA, resB] = await Promise.all([applyAPromise, applyBPromise]);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      expect(resA.counts.appliedNew).toBe(2);
      expect(resA.appliedLockedPlan?.every((i) => i.outcome === "NEW_PROFILE")).toBe(true);
      expect(resB.counts.appliedNew).toBe(0);
      expect(resB.counts.appliedUnchanged).toBe(2);
      expect(resB.appliedLockedPlan?.every((i) => i.outcome === "UNCHANGED")).toBe(true);

      const dup = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM (
           SELECT e."exerciseRevisionId"
           FROM "ExerciseEnergyProfile" e
           WHERE e.status = 'APPROVED' AND e."enabledForCalculation" = true
           GROUP BY e."exerciseRevisionId"
           HAVING COUNT(*) > 1
         ) d`,
      );
      expect(Number(dup.rows[0]?.n)).toBe(0);

      const active = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile"
         WHERE status = 'APPROVED' AND "enabledForCalculation" = true`,
      );
      expect(Number(active.rows[0]?.n)).toBe(2);

      const partial = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile" WHERE status = 'DRAFT'`,
      );
      expect(Number(partial.rows[0]?.n)).toBe(0);

      process.stdout.write(
        `CONCURRENT_FIRST_APPLY_MS=${Date.now() - started}\n`,
      );
    });
  }, 300_000);

  it("rollback-then-waiter: failed holder rolls back; waiter applies cleanly", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const subset = ENERGY_CONTENT_MAPPINGS.filter((e) => e.exerciseKey === "stretching");
      const dbA = createDb();
      const dbB = createDb();

      let releaseA!: () => void;
      const holdA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aLocked = false;

      const applyAPromise = runWorkoutEnergyContentLoad({
        mode: "apply",
        db: dbA,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
        injectFailureAfterWrites: 1,
        testHoldAfterLock: async () => {
          aLocked = true;
          await holdA;
        },
      });

      await waitUntil(async () => aLocked, {
        timeoutMs: 30_000,
        label: "rollback_holder_locked",
      });

      const applyBPromise = runWorkoutEnergyContentLoad({
        mode: "apply",
        db: dbB,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
      });

      await waitUntil(
        async () => {
          const waiting = await pool.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n
             FROM pg_locks
             WHERE locktype = 'advisory'
               AND objid = $1
               AND granted = false`,
            [CONTENT_LOADER_ADVISORY_LOCK_KEY],
          );
          return Number(waiting.rows[0]?.n) >= 1;
        },
        { timeoutMs: 30_000, label: "rollback_waiter_waiting" },
      );

      releaseA();
      await expect(applyAPromise).rejects.toThrow(/CONTENT_LOADER_INJECTED_FAILURE/);
      const resB = await applyBPromise;
      expect(resB.ok).toBe(true);
      expect(resB.counts.appliedNew).toBe(1);
      expect(resB.appliedLockedPlan?.[0]?.outcome).toBe("NEW_PROFILE");

      const rows = await pool.query<{ status: string; enabled: boolean }>(
        `SELECT e.status, e."enabledForCalculation" AS enabled
         FROM "ExerciseEnergyProfile" e
         JOIN "ExerciseRevision" r ON r.id = e."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'stretching'`,
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.status).toBe("APPROVED");
      expect(rows.rows[0]?.enabled).toBe(true);
    });
  }, 300_000);

  it("stale dry-run NEW does not apply after another caller writes; locked plan UNCHANGED", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const subset = ENERGY_CONTENT_MAPPINGS.filter((e) => e.exerciseKey === "stretching");
      const db1 = createDb();
      const db2 = createDb();

      const dry = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db: db1,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
      });
      expect(dry.ok).toBe(true);
      expect(dry.items[0]?.outcome).toBe("NEW_PROFILE");

      const other = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db: db2,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
      });
      expect(other.ok).toBe(true);
      expect(other.counts.appliedNew).toBe(1);

      const applyStale = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db: db1,
        databaseUrl: connectionString,
        energyMappings: subset,
        timingMappings: [],
      });
      expect(applyStale.ok).toBe(true);
      expect(applyStale.dryRunPlan?.[0]?.outcome).toBe("UNCHANGED");
      expect(applyStale.appliedLockedPlan?.[0]?.outcome).toBe("UNCHANGED");
      expect(applyStale.counts.appliedNew).toBe(0);

      const n = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile"
         WHERE status = 'APPROVED' AND "enabledForCalculation" = true`,
      );
      expect(Number(n.rows[0]?.n)).toBe(1);
    });
  }, 300_000);
});

describe("WORKOUT-ENERGY-CONTENT timing loader persistence (batch-02)", () => {
  it("timing validate/dry-run/apply idempotency, conflict, replace, rollback", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      expect(confirmSafeDisposableDatabase(connectionString)).toBe(
        "SAFE_DISPOSABLE_DATABASE_CONFIRMED",
      );
      process.stdout.write(`SAFE_DISPOSABLE_DATABASE_CONFIRMED\n`);
      expect(TIMING_CONTENT_MAPPINGS.length).toBe(49);

      const db = createDb();
      const N = TIMING_CONTENT_MAPPINGS.length;

      const validate = await runWorkoutEnergyContentLoad({
        mode: "validate",
        energyMappings: [],
        timingMappings: TIMING_CONTENT_MAPPINGS,
      });
      expect(validate.ok).toBe(true);

      const before = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyTimingProfile"`,
      );
      expect(Number(before.rows[0]?.n)).toBe(0);

      const dry = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: TIMING_CONTENT_MAPPINGS,
      });
      expect(dry.ok).toBe(true);
      expect(dry.counts.plannedNew).toBe(N);

      const first = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: TIMING_CONTENT_MAPPINGS,
        reviewedBy: WORKOUT_ENERGY_TIMING_REVIEWED_BY,
      });
      expect(first.ok).toBe(true);
      expect(first.counts.appliedNew).toBe(N);
      expect(first.counts.appliedUnchanged).toBe(0);
      expect(first.appliedLockedPlan?.every((i) => i.outcome === "NEW_PROFILE")).toBe(true);

      const approved = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyTimingProfile"
         WHERE status = 'APPROVED' AND "enabledForCalculation" = true`,
      );
      expect(Number(approved.rows[0]?.n)).toBe(N);

      const energyUntouched = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyProfile"`,
      );
      expect(Number(energyUntouched.rows[0]?.n)).toBe(0);

      const second = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: TIMING_CONTENT_MAPPINGS,
      });
      expect(second.ok).toBe(true);
      expect(second.counts.appliedNew).toBe(0);
      expect(second.counts.appliedUnchanged).toBe(N);

      const third = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: TIMING_CONTENT_MAPPINGS,
      });
      expect(third.ok).toBe(true);
      expect(third.counts.appliedUnchanged).toBe(N);

      const reordered = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: [...TIMING_CONTENT_MAPPINGS].reverse(),
      });
      expect(reordered.ok).toBe(true);
      expect(reordered.counts.appliedUnchanged).toBe(N);

      const push = TIMING_CONTENT_MAPPINGS.find((e) => e.exerciseKey === "push_ups")!;
      const conflict = withTimingChecksum({
        ...push,
        secondsPerRep: push.secondsPerRep + 0.5,
        movementPhases: {
          ...push.movementPhases,
          topTransitionSeconds: (push.movementPhases.topTransitionSeconds ?? 0) + 0.5,
        },
        phaseModel: push.phaseModel, // intentionally stale vs phases — checksum still computed
      });
      // Fix phaseModel to match mutated phases so validation focuses on CONFLICT not phase mismatch
      const { serializeTimingPhaseModel, sumTimingPhases } = await import(
        "../../src/modules/workout-engine/energy/content/timing-methodology"
      );
      const conflictPhases = {
        ...push.movementPhases,
        topTransitionSeconds: (push.movementPhases.topTransitionSeconds ?? 0) + 0.5,
      };
      const conflictEntry = withTimingChecksum({
        ...push,
        secondsPerRep: Number(sumTimingPhases(conflictPhases).toFixed(4)),
        movementPhases: conflictPhases,
        phaseModel: serializeTimingPhaseModel(conflictPhases),
        rationale: `${push.rationale} mutated`,
      });
      const conflictPlan = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: [conflictEntry],
      });
      expect(conflictPlan.items.some((i) => i.outcome === "CONFLICT")).toBe(true);
      expect(conflictPlan.ok).toBe(false);
      void conflict;

      const wrongRev = withTimingChecksum({
        ...push,
        expectedPublishedRevisionNumber: 1,
      });
      const wrong = await runWorkoutEnergyContentLoad({
        mode: "dry-run",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: [wrongRev],
      });
      expect(wrong.items[0]?.outcome).toBe("REVISION_PIN_MISMATCH");

      const beforeRollback = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyTimingProfile" WHERE status = 'RETIRED'`,
      );
      const retiredBefore = Number(beforeRollback.rows[0]?.n);

      const replaceProbe = withTimingChecksum({
        ...push,
        contentVersion: "workout-energy-content-01b-timing-batch-02-rollback-probe",
        sourceReference: `${push.sourceReference.split("\n")[0]}\n${formatContentVersionMarkerLine(
          "workout-energy-content-01b-timing-batch-02-rollback-probe",
        )}`,
        reviewedAt: "2026-08-07",
        reviewedBy: WORKOUT_ENERGY_TIMING_REVIEWED_BY,
      });

      await expect(
        runWorkoutEnergyContentLoad({
          mode: "apply",
          db,
          databaseUrl: connectionString,
          energyMappings: [],
          timingMappings: [replaceProbe],
          injectFailureAfterWrites: 1,
        }),
      ).rejects.toThrow(/CONTENT_LOADER_INJECTED_FAILURE/);

      const afterRollback = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "ExerciseEnergyTimingProfile" WHERE status = 'RETIRED'`,
      );
      expect(Number(afterRollback.rows[0]?.n)).toBe(retiredBefore);

      const stillActive = await pool.query<{ n: string; spr: string }>(
        `SELECT COUNT(*)::text AS n, MAX(t."secondsPerRep")::text AS spr
         FROM "ExerciseEnergyTimingProfile" t
         JOIN "ExerciseRevision" r ON r.id = t."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'push_ups'
           AND t.status = 'APPROVED'
           AND t."enabledForCalculation" = true`,
      );
      expect(Number(stillActive.rows[0]?.n)).toBe(1);
      expect(Number(stillActive.rows[0]?.spr)).toBe(push.secondsPerRep);

      const v2 = withTimingChecksum({
        ...push,
        contentVersion: "workout-energy-content-01b-timing-batch-02-v2-probe",
        sourceReference: `${push.sourceReference.split("\n")[0]}\n${formatContentVersionMarkerLine(
          "workout-energy-content-01b-timing-batch-02-v2-probe",
        )}`,
        reviewedAt: "2026-08-07",
        reviewedBy: WORKOUT_ENERGY_TIMING_REVIEWED_BY,
        rationale: `${push.rationale} v2 replace probe`,
      });
      const applyV2 = await runWorkoutEnergyContentLoad({
        mode: "apply",
        db,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: [v2],
      });
      expect(applyV2.ok).toBe(true);
      expect(applyV2.items[0]?.outcome).toBe("RETIRE_AND_REPLACE");
      expect(applyV2.counts.appliedRetired).toBe(1);
      expect(applyV2.counts.appliedNew).toBe(1);

      const rows = await pool.query<{ status: string; enabled: boolean; ref: string }>(
        `SELECT t.status, t."enabledForCalculation" AS enabled, t."sourceReference" AS ref
         FROM "ExerciseEnergyTimingProfile" t
         JOIN "ExerciseRevision" r ON r.id = t."exerciseRevisionId"
         JOIN "Exercise" ex ON ex.id = r."exerciseId"
         WHERE ex.key = 'push_ups'
         ORDER BY t."createdAt"`,
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.some((r) => r.status === "RETIRED" && r.enabled === false)).toBe(true);
      expect(
        rows.rows.some(
          (r) =>
            r.status === "APPROVED" &&
            r.enabled &&
            r.ref.includes("WA_CONTENT_VERSION_V1=workout-energy-content-01b-timing-batch-02-v2-probe"),
        ),
      ).toBe(true);

      const dup = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM (
           SELECT t."exerciseRevisionId"
           FROM "ExerciseEnergyTimingProfile" t
           WHERE t.status = 'APPROVED' AND t."enabledForCalculation" = true
           GROUP BY t."exerciseRevisionId"
           HAVING COUNT(*) > 1
         ) d`,
      );
      expect(Number(dup.rows[0]?.n)).toBe(0);

      const snapTable = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'WorkoutSessionEnergySnapshot'
         ) AS exists`,
      );
      if (snapTable.rows[0]?.exists) {
        const snaps = await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM "WorkoutSessionEnergySnapshot"`,
        );
        expect(Number(snaps.rows[0]?.n)).toBe(0);
      }
    });
  }, 300_000);

  it("concurrent timing first apply: one NEW batch, waiter UNCHANGED, no duplicates", async () => {
    const started = Date.now();
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const subset = TIMING_CONTENT_MAPPINGS.filter((e) =>
        ["push_ups", "bodyweight_squats"].includes(e.exerciseKey),
      );
      expect(subset.length).toBe(2);

      const dbA = createDb();
      const dbB = createDb();

      let releaseA!: () => void;
      const holdA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aLocked = false;

      const applyAPromise = runWorkoutEnergyContentLoad({
        mode: "apply",
        db: dbA,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: subset,
        testHoldAfterLock: async () => {
          aLocked = true;
          await holdA;
        },
      });

      await waitUntil(async () => aLocked, {
        timeoutMs: 30_000,
        label: "timing_applyA_acquired_lock",
      });

      const applyBPromise = runWorkoutEnergyContentLoad({
        mode: "apply",
        db: dbB,
        databaseUrl: connectionString,
        energyMappings: [],
        timingMappings: subset,
      });

      let pidA = 0;
      let pidB = 0;
      await waitUntil(
        async () => {
          const locks = await pool.query<{ pid: number; granted: boolean }>(
            `SELECT pid, granted
             FROM pg_locks
             WHERE locktype = 'advisory'
               AND objid = $1`,
            [CONTENT_LOADER_ADVISORY_LOCK_KEY],
          );
          const holder = locks.rows.find((r) => r.granted);
          const waiter = locks.rows.find((r) => !r.granted);
          if (holder && waiter) {
            pidA = Number(holder.pid);
            pidB = Number(waiter.pid);
            return true;
          }
          return false;
        },
        { timeoutMs: 30_000, label: "timing_applyB_waiting_on_lock" },
      );
      expect(pidA).toBeGreaterThan(0);
      expect(pidB).toBeGreaterThan(0);
      expect(pidA).not.toBe(pidB);
      process.stdout.write(`TIMING_CONCURRENCY_PID_A=${pidA}\n`);
      process.stdout.write(`TIMING_CONCURRENCY_PID_B=${pidB}\n`);
      process.stdout.write(`TIMING_CONCURRENCY_LOCK_WAIT=confirmed\n`);

      releaseA();
      const [resA, resB] = await Promise.all([applyAPromise, applyBPromise]);
      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      expect(resA.counts.appliedNew).toBe(2);
      expect(resB.counts.appliedUnchanged).toBe(2);

      const dup = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM (
           SELECT t."exerciseRevisionId"
           FROM "ExerciseEnergyTimingProfile" t
           WHERE t.status = 'APPROVED' AND t."enabledForCalculation" = true
           GROUP BY t."exerciseRevisionId"
           HAVING COUNT(*) > 1
         ) d`,
      );
      expect(Number(dup.rows[0]?.n)).toBe(0);
      process.stdout.write(`CONCURRENT_TIMING_FIRST_APPLY_MS=${Date.now() - started}\n`);
    });
  }, 300_000);
});
