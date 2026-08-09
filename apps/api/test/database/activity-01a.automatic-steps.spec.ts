/**
 * ACTIVITY-01A — automatic provider steps sync persistence + FIX-01 coverage.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { runSqlMigrations } from "../../scripts/lib/sql-migration-runner.mjs";
import { PrismaService } from "../../src/infrastructure/database/prisma.service";
import { ActivityService } from "../../src/modules/activity/application/activity.service";
import { dateOnlyInTimeZone } from "../../src/modules/workout-engine/domain/workout-adaptation.fingerprint";
import {
  createDisposableMigratedDb,
  resetDisposableDatabase,
  type DisposableMigratedDb,
} from "./helpers/disposable-catalog-db";

const M215 = "215_activity_01a_automatic_steps_sync";
const M214 = "214_workout_catalog_01c_a_exercise_media_foundation";

let fullDb: DisposableMigratedDb;
let pre215Db: DisposableMigratedDb;
const ACTIVITY_RESET_TABLES = [
  "ActivityDailySnapshot",
  "ActivitySyncClient",
  "ActivitySyncOperation",
  "ActivitySyncRateBucket",
  "HealthPlatformConsent",
] as const;

beforeAll(async () => {
  fullDb = await createDisposableMigratedDb();
  pre215Db = await createDisposableMigratedDb({ onlyUntil: M214 });
}, 300_000);

afterAll(async () => {
  await pre215Db?.cleanup();
  await fullDb?.cleanup();
}, 300_000);

async function withDisposableMigratedDb<T>(
  fn: (ctx: { pool: Pool; connectionString: string; createDb: () => PrismaService }) => Promise<T>,
  migrateOptions?: { onlyUntil?: string },
): Promise<T> {
  const target = migrateOptions?.onlyUntil === M214 ? pre215Db : fullDb;
  if (target !== pre215Db) {
    await resetDisposableDatabase(target.connectionString, target.pool, { tables: ACTIVITY_RESET_TABLES });
  }
  return fn(target);
}

async function createUser(pool: Pool, timezone = "UTC") {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1::uuid, $2)`, [
    userId,
    `act-${userId.slice(0, 8)}@example.com`,
  ]);
  await pool.query(
    `INSERT INTO "UserProfile" (id, "userId", locale, timezone)
     VALUES (gen_random_uuid(), $1::uuid, 'ru', $2)`,
    [userId, timezone],
  );
  return userId;
}

async function grantActivityConsent(pool: Pool, userId: string, providerId: string) {
  await pool.query(
    `INSERT INTO "HealthPlatformConsent" (
       "userId", "providerId", "dataCategory", direction, purpose, "consentVersion", status, source
     ) VALUES ($1::uuid, $2, 'activity', 'READ', 'activity-sync', '01a', 'GRANTED', 'test')`,
    [userId, providerId],
  );
}

async function revokeActivityConsent(pool: Pool, userId: string, providerId: string) {
  await pool.query(
    `UPDATE "HealthPlatformConsent"
     SET status = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "userId" = $1::uuid AND "providerId" = $2 AND status = 'GRANTED'`,
    [userId, providerId],
  );
}

function service(
  db: PrismaService,
  now: Date,
  rateLimit?: { windowSeconds: number; maxRequests: number; blockSeconds: number },
) {
  return new ActivityService(db, { now: () => now }, rateLimit);
}

function basePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    operationId: "op-exact",
    source: "HEALTHKIT",
    clientInstanceId: "iphone-client-01",
    sequence: 1,
    timeZone: "UTC",
    snapshots: [
      {
        localDate: "2026-08-04",
        steps: 100,
        sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("ACTIVITY-01A automatic steps sync", () => {
  it("clean bootstrap migration 215 applies and repeat is idempotent", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const ledger = await pool.query(
        `SELECT "migrationName" FROM "SchemaMigrationLedger"
         WHERE "migrationName" = $1`,
        [M215],
      );
      expect(ledger.rows).toHaveLength(1);

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

  it("upgrade path 1–214 → 215 preserves data; repeat migrate = 0", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const preLedger = await pool.query(
        `SELECT "migrationName" FROM "SchemaMigrationLedger" WHERE "migrationName" = $1`,
        [M215],
      );
      expect(preLedger.rows).toHaveLength(0);

      const tables = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('ActivitySyncClient','ActivityDailySnapshot','ActivitySyncOperation')`,
      );
      expect(Number(tables.rows[0]?.c)).toBe(0);

      const userId = await createUser(pool, "UTC");
      const email = `pre215-${userId.slice(0, 8)}@example.com`;
      await pool.query(`UPDATE "User" SET email = $2 WHERE id = $1::uuid`, [userId, email]);

      const client = await pool.connect();
      try {
        const applied215 = await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
        expect(applied215.applied.map((a: { name: string }) => a.name)).toContain(M215);

        const postLedger = await pool.query(
          `SELECT "migrationName" FROM "SchemaMigrationLedger" WHERE "migrationName" = $1`,
          [M215],
        );
        expect(postLedger.rows).toHaveLength(1);

        const checks = await pool.query<{ conname: string }>(
          `SELECT conname FROM pg_constraint
           WHERE conrelid IN (
             '"ActivitySyncClient"'::regclass,
             '"ActivityDailySnapshot"'::regclass,
             '"ActivitySyncOperation"'::regclass,
             '"ActivitySyncRateBucket"'::regclass
           )
           AND contype = 'c'
           ORDER BY conname`,
        );
        expect(checks.rows.some((r) => r.conname.includes("sourceType"))).toBe(true);

        const indexes = await pool.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes
           WHERE tablename IN (
             'ActivitySyncClient','ActivityDailySnapshot',
             'ActivitySyncOperation','ActivitySyncRateBucket'
           )
           ORDER BY indexname`,
        );
        const indexNames = indexes.rows.map((r) => r.indexname);
        expect(indexNames).toContain("ActivitySyncClient_user_source_instance_uidx");
        expect(indexNames).toContain("ActivityDailySnapshot_active_uidx");
        expect(indexNames).toContain("ActivitySyncOperation_scope_uidx");
        expect(indexNames).toContain("ActivitySyncRateBucket_user_uidx");

        const fks = await pool.query<{ confdeltype: string }>(
          `SELECT confdeltype FROM pg_constraint
           WHERE contype = 'f'
             AND conrelid IN (
               '"ActivitySyncClient"'::regclass,
               '"ActivityDailySnapshot"'::regclass,
               '"ActivitySyncOperation"'::regclass,
               '"ActivitySyncRateBucket"'::regclass
             )
             AND confrelid = '"User"'::regclass`,
        );
        expect(fks.rows.length).toBeGreaterThanOrEqual(4);
        expect(fks.rows.every((r) => r.confdeltype === "c")).toBe(true);

        const activityTables = await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN (
               'ActivitySyncClient','ActivityDailySnapshot',
               'ActivitySyncOperation','ActivitySyncRateBucket'
             )
           ORDER BY table_name`,
        );
        expect(activityTables.rows.map((r) => r.table_name)).toEqual([
          "ActivityDailySnapshot",
          "ActivitySyncClient",
          "ActivitySyncOperation",
          "ActivitySyncRateBucket",
        ]);

        const preserved = await pool.query<{ email: string }>(
          `SELECT email FROM "User" WHERE id = $1::uuid`,
          [userId],
        );
        expect(preserved.rows[0]?.email).toBe(email);

        const rerun = await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
        expect(rerun.applied).toEqual([]);
      } finally {
        client.release();
      }
    }, { onlyUntil: M214 });
  }, 300_000);

  it("no data !== 0; ingest replaces; correction lower; replay; MANUAL rejected", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const db = createDb();
      const svc = service(db, now);

      const empty = await svc.getToday(userId);
      expect(empty.dataState).toBe("NO_DATA");
      expect(empty.steps).toBeNull();
      expect(empty.targetSteps).toBeNull();
      expect(empty.remainingSteps).toBeNull();

      const localDate = dateOnlyInTimeZone("UTC", now);
      const first = await svc.syncSteps(userId, {
        operationId: "op-1",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-client-01",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 6420,
            sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
          },
        ],
      });
      expect(first.today.steps).toBe(6420);
      expect(first.today.dataState).toBe("SYNCED");
      expect(first.today.source).toBe("HEALTHKIT");

      const replay = await svc.syncSteps(userId, {
        operationId: "op-1",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-client-01",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 6420,
            sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
          },
        ],
      });
      expect(replay.today.steps).toBe(6420);

      await expect(
        svc.syncSteps(userId, {
          operationId: "op-1",
          source: "HEALTHKIT",
          clientInstanceId: "iphone-client-01",
          sequence: 1,
          timeZone: "UTC",
          snapshots: [
            {
              localDate,
              steps: 7000,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/ACTIVITY_OPERATION_PAYLOAD_CONFLICT/);

      const replaced = await svc.syncSteps(userId, {
        operationId: "op-2",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-client-01",
        sequence: 2,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 7000,
            sourceCalculatedAt: "2026-08-04T11:30:00.000Z",
          },
        ],
      });
      expect(replaced.today.steps).toBe(7000);

      const corrected = await svc.syncSteps(userId, {
        operationId: "op-3",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-client-01",
        sequence: 3,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 6800,
            sourceCalculatedAt: "2026-08-04T11:45:00.000Z",
          },
        ],
      });
      expect(corrected.today.steps).toBe(6800);

      const zero = await svc.syncSteps(userId, {
        operationId: "op-4",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-client-01",
        sequence: 4,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 0,
            sourceCalculatedAt: "2026-08-04T11:50:00.000Z",
          },
        ],
      });
      expect(zero.today.steps).toBe(0);
      expect(zero.today.dataState).toBe("SYNCED");

      await expect(
        svc.syncSteps(userId, {
          operationId: "op-manual",
          source: "MANUAL",
          clientInstanceId: "iphone-client-01",
          sequence: 5,
          timeZone: "UTC",
          snapshots: [{ localDate, steps: 1, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/ACTIVITY_SOURCE_UNSUPPORTED|ACTIVITY_SYNC_FIELD_FORBIDDEN/);

      const activeCount = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityDailySnapshot"
         WHERE "userId" = $1 AND status = 'ACTIVE' AND "localDate" = $2::date`,
        [userId, localDate],
      );
      expect(activeCount.rows[0]?.c).toBe(1);
    });
  }, 300_000);

  it("strict top-level allowlist rejects forbidden fields without writes", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const db = createDb();
      const svc = service(db, now);
      const localDate = dateOnlyInTimeZone("UTC", now);

      const accepted = await svc.syncSteps(
        userId,
        basePayload({
          operationId: "op-allow-ok",
          snapshots: [
            {
              localDate,
              steps: 50,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );
      expect(accepted.accepted).toBe(true);

      const cases: Array<{ label: string; body: Record<string, unknown> }> = [
        {
          label: "distanceKm",
          body: basePayload({
            operationId: "op-dist",
            sequence: 2,
            distanceKm: 1.2,
            snapshots: [{ localDate, steps: 1, sourceCalculatedAt: now.toISOString() }],
          }),
        },
        {
          label: "unexpectedField",
          body: basePayload({
            operationId: "op-unexpected",
            sequence: 2,
            unexpectedField: true,
            snapshots: [{ localDate, steps: 1, sourceCalculatedAt: now.toISOString() }],
          }),
        },
        {
          label: "userId",
          body: basePayload({
            operationId: "op-userid",
            sequence: 2,
            userId: randomUUID(),
            snapshots: [{ localDate, steps: 1, sourceCalculatedAt: now.toISOString() }],
          }),
        },
        {
          label: "nested snapshot unknown",
          body: basePayload({
            operationId: "op-nested",
            sequence: 2,
            snapshots: [
              {
                localDate,
                steps: 1,
                sourceCalculatedAt: now.toISOString(),
                heartRate: 90,
              },
            ],
          }),
        },
      ];

      for (const c of cases) {
        await expect(svc.syncSteps(userId, c.body), c.label).rejects.toThrow(
          /ACTIVITY_SYNC_FIELD_FORBIDDEN/,
        );
        const err = await svc.syncSteps(userId, c.body).catch((e: Error) => e);
        expect(err.message).toBe("ACTIVITY_SYNC_FIELD_FORBIDDEN");
        expect(JSON.stringify(err)).not.toMatch(/distanceKm|unexpectedField|heartRate|iphone-client/i);
        expect(err.message).not.toMatch(/50|steps/);
      }

      const clients = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncClient" WHERE "userId" = $1`,
        [userId],
      );
      expect(clients.rows[0]?.c).toBe(1);
      const ops = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" WHERE "userId" = $1`,
        [userId],
      );
      expect(ops.rows[0]?.c).toBe(1);
      const snaps = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityDailySnapshot" WHERE "userId" = $1`,
        [userId],
      );
      expect(snaps.rows[0]?.c).toBe(1);
    });
  }, 300_000);

  it("concurrent first sync: one client, sequence 2 wins or sequential accept; no 500", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const localDate = dateOnlyInTimeZone("UTC", now);
      const clientInstanceId = "concurrent-client-01";

      const svc1 = service(createDb(), now);
      const svc2 = service(createDb(), now);

      const body1 = {
        operationId: "op-concurrent-1",
        source: "HEALTHKIT" as const,
        clientInstanceId,
        sequence: 1,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 1111,
            sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
          },
        ],
      };
      const body2 = {
        operationId: "op-concurrent-2",
        source: "HEALTHKIT" as const,
        clientInstanceId,
        sequence: 2,
        timeZone: "UTC",
        snapshots: [
          {
            localDate,
            steps: 2222,
            sourceCalculatedAt: "2026-08-04T11:05:00.000Z",
          },
        ],
      };

      const settled = await Promise.allSettled([
        svc1.syncSteps(userId, body1),
        svc2.syncSteps(userId, body2),
      ]);

      for (const result of settled) {
        if (result.status === "rejected") {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          expect(msg).not.toMatch(/unique|duplicate|23505/i);
          expect(msg).toMatch(/ACTIVITY_SEQUENCE_STALE/);
        } else {
          expect(result.value.accepted).toBe(true);
        }
      }

      const clients = await pool.query(
        `SELECT count(*)::int AS c, max("lastAcceptedSequence")::int AS seq
         FROM "ActivitySyncClient"
         WHERE "userId" = $1 AND "clientInstanceId" = $2`,
        [userId, clientInstanceId],
      );
      expect(clients.rows[0]?.c).toBe(1);
      expect(clients.rows[0]?.seq).toBe(2);

      const active = await pool.query(
        `SELECT value::int AS value FROM "ActivityDailySnapshot"
         WHERE "userId" = $1 AND status = 'ACTIVE' AND "localDate" = $2::date`,
        [userId, localDate],
      );
      expect(active.rows).toHaveLength(1);
      expect(active.rows[0]?.value).toBe(2222);

      const ops = await pool.query(
        `SELECT "operationId", sequence::int AS sequence FROM "ActivitySyncOperation"
         WHERE "userId" = $1 ORDER BY sequence`,
        [userId],
      );
      expect(ops.rows.length).toBeGreaterThanOrEqual(1);
      expect(ops.rows.length).toBeLessThanOrEqual(2);
      expect(ops.rows.some((r: { sequence: number }) => r.sequence === 2)).toBe(true);

      const orphanOps = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" o
         LEFT JOIN "ActivitySyncClient" c ON c.id = o."syncClientId"
         WHERE o."userId" = $1 AND c.id IS NULL`,
        [userId],
      );
      expect(orphanOps.rows[0]?.c).toBe(0);

      const replay = await svc1.syncSteps(userId, body2);
      expect(replay.today.steps).toBe(2222);
    });
  }, 300_000);

  it("rejects invalid input, stale sequence, isolation, missing consent", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userA = await createUser(pool, "UTC");
      const userB = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userA, "health_connect");
      const db = createDb();
      const svc = service(db, now);
      const localDate = dateOnlyInTimeZone("UTC", now);

      await expect(
        svc.syncSteps(userB, {
          operationId: "op-b",
          source: "HEALTH_CONNECT",
          clientInstanceId: "android-client-01",
          sequence: 1,
          timeZone: "UTC",
          snapshots: [{ localDate, steps: 10, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/HEALTH_CONSENT_REQUIRED/);

      await svc.syncSteps(userA, {
        operationId: "op-a1",
        source: "HEALTH_CONNECT",
        clientInstanceId: "android-client-01",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [{ localDate, steps: 111, sourceCalculatedAt: now.toISOString() }],
      });

      expect((await svc.getToday(userB)).steps).toBeNull();
      expect((await svc.getToday(userA)).steps).toBe(111);

      await expect(
        svc.syncSteps(userA, {
          operationId: "op-future",
          source: "HEALTH_CONNECT",
          clientInstanceId: "android-client-01",
          sequence: 2,
          timeZone: "UTC",
          snapshots: [
            {
              localDate: "2099-01-01",
              steps: 1,
              sourceCalculatedAt: now.toISOString(),
            },
          ],
        }),
      ).rejects.toThrow(/ACTIVITY_LOCAL_DATE_FUTURE/);

      await expect(
        svc.syncSteps(userA, {
          operationId: "op-tz",
          source: "HEALTH_CONNECT",
          clientInstanceId: "android-client-01",
          sequence: 2,
          timeZone: "Europe/Moscow",
          snapshots: [{ localDate, steps: 1, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/ACTIVITY_TIMEZONE_MISMATCH/);

      await expect(
        svc.syncSteps(userA, {
          operationId: "op-stale",
          source: "HEALTH_CONNECT",
          clientInstanceId: "android-client-01",
          sequence: 1,
          timeZone: "UTC",
          snapshots: [{ localDate, steps: 999, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/ACTIVITY_SEQUENCE_STALE/);

      await expect(
        svc.syncSteps(userA, {
          operationId: "op-cal",
          source: "HEALTH_CONNECT",
          clientInstanceId: "android-client-01",
          sequence: 2,
          timeZone: "UTC",
          calories: 100,
          snapshots: [{ localDate, steps: 1, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/ACTIVITY_SYNC_FIELD_FORBIDDEN/);

      await grantActivityConsent(pool, userA, "apple_health");
      await svc.syncSteps(userA, {
        operationId: "op-hk",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-client-02",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [{ localDate, steps: 5000, sourceCalculatedAt: now.toISOString() }],
      });
      const today = await svc.getToday(userA);
      expect(today.steps === 111 || today.steps === 5000).toBe(true);
      expect(today.steps).not.toBe(5111);
    });
  }, 300_000);

  it("revoked consent blocks sync without advancing sequence or writing", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const db = createDb();
      const svc = service(db, now);
      const localDate = dateOnlyInTimeZone("UTC", now);

      await svc.syncSteps(userId, {
        operationId: "op-before-revoke",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-revoke-01",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [{ localDate, steps: 3333, sourceCalculatedAt: now.toISOString() }],
      });

      await revokeActivityConsent(pool, userId, "apple_health");

      await expect(
        svc.syncSteps(userId, {
          operationId: "op-after-revoke",
          source: "HEALTHKIT",
          clientInstanceId: "iphone-revoke-01",
          sequence: 2,
          timeZone: "UTC",
          snapshots: [{ localDate, steps: 9999, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/HEALTH_CONSENT_REQUIRED/);

      const client = await pool.query(
        `SELECT "lastAcceptedSequence"::int AS seq FROM "ActivitySyncClient"
         WHERE "userId" = $1 AND "clientInstanceId" = $2`,
        [userId, "iphone-revoke-01"],
      );
      expect(client.rows[0]?.seq).toBe(1);

      const ops = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" WHERE "userId" = $1`,
        [userId],
      );
      expect(ops.rows[0]?.c).toBe(1);

      const snap = await pool.query(
        `SELECT value::int AS value FROM "ActivityDailySnapshot"
         WHERE "userId" = $1 AND status = 'ACTIVE'`,
        [userId],
      );
      expect(snap.rows[0]?.value).toBe(3333);
    });
  }, 300_000);

  it("invalid IANA timezone rejects without UTC fallback or partial writes", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const db = createDb();
      const svc = service(db, now);
      const localDate = dateOnlyInTimeZone("UTC", now);

      await expect(
        svc.syncSteps(userId, {
          operationId: "op-bad-iana",
          source: "HEALTHKIT",
          clientInstanceId: "iphone-iana-01",
          sequence: 1,
          timeZone: "Mars/Olympus",
          snapshots: [{ localDate, steps: 10, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/WORKOUT_TIMEZONE_INVALID/);

      const profile = await pool.query(
        `SELECT timezone FROM "UserProfile" WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(profile.rows[0]?.timezone).toBe("UTC");

      const counts = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM "ActivitySyncClient" WHERE "userId" = $1) AS clients,
           (SELECT count(*)::int FROM "ActivitySyncOperation" WHERE "userId" = $1) AS ops,
           (SELECT count(*)::int FROM "ActivityDailySnapshot" WHERE "userId" = $1) AS snaps`,
        [userId],
      );
      expect(counts.rows[0]).toEqual({ clients: 0, ops: 0, snaps: 0 });
    });
  }, 300_000);

  it("account deletion CASCADE removes Activity rows without orphans", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const db = createDb();
      const svc = service(db, now);
      const localDate = dateOnlyInTimeZone("UTC", now);

      await svc.syncSteps(userId, {
        operationId: "op-cascade",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-cascade-01",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [{ localDate, steps: 4444, sourceCalculatedAt: now.toISOString() }],
      });

      await pool.query(`DELETE FROM "User" WHERE id = $1::uuid`, [userId]);

      const leftover = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM "ActivitySyncClient" WHERE "userId" = $1) AS clients,
           (SELECT count(*)::int FROM "ActivitySyncOperation" WHERE "userId" = $1) AS ops,
           (SELECT count(*)::int FROM "ActivityDailySnapshot" WHERE "userId" = $1) AS snaps,
           (SELECT count(*)::int FROM "HealthPlatformConsent" WHERE "userId" = $1) AS consents`,
        [userId],
      );
      expect(leftover.rows[0]).toEqual({ clients: 0, ops: 0, snaps: 0, consents: 0 });
    });
  }, 300_000);

  it("endpoint rate limit: within window ok; overflow 429 semantics; USER isolation; no writes", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-08-04T12:00:00.000Z");
      const userA = await createUser(pool, "UTC");
      const userB = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userA, "apple_health");
      await grantActivityConsent(pool, userB, "apple_health");
      const localDate = dateOnlyInTimeZone("UTC", now);
      const limit = { windowSeconds: 60, maxRequests: 3, blockSeconds: 60 };
      const svcA = service(createDb(), now, limit);
      const svcB = service(createDb(), now, limit);

      for (let i = 1; i <= 3; i += 1) {
        await svcA.syncSteps(userA, {
          operationId: `op-rl-a-${i}`,
          source: "HEALTHKIT",
          clientInstanceId: "iphone-rl-a",
          sequence: i,
          timeZone: "UTC",
          snapshots: [
            {
              localDate,
              steps: 1000 + i,
              sourceCalculatedAt: now.toISOString(),
            },
          ],
        });
      }

      await expect(
        svcA.syncSteps(userA, {
          operationId: "op-rl-a-over",
          source: "HEALTHKIT",
          clientInstanceId: "iphone-rl-a",
          sequence: 4,
          timeZone: "UTC",
          snapshots: [{ localDate, steps: 9999, sourceCalculatedAt: now.toISOString() }],
        }),
      ).rejects.toThrow(/ACTIVITY_SYNC_RATE_LIMITED/);

      const clientA = await pool.query(
        `SELECT "lastAcceptedSequence"::int AS seq FROM "ActivitySyncClient"
         WHERE "userId" = $1`,
        [userA],
      );
      expect(clientA.rows[0]?.seq).toBe(3);
      const opsA = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" WHERE "userId" = $1`,
        [userA],
      );
      expect(opsA.rows[0]?.c).toBe(3);
      const snapA = await pool.query(
        `SELECT value::int AS value FROM "ActivityDailySnapshot"
         WHERE "userId" = $1 AND status = 'ACTIVE'`,
        [userA],
      );
      expect(snapA.rows[0]?.value).toBe(1003);

      await svcB.syncSteps(userB, {
        operationId: "op-rl-b-1",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-rl-b",
        sequence: 1,
        timeZone: "UTC",
        snapshots: [{ localDate, steps: 77, sourceCalculatedAt: now.toISOString() }],
      });
      expect((await svcB.getToday(userB)).steps).toBe(77);

      await pool.query(
        `UPDATE "ActivitySyncRateBucket"
         SET "windowStartedAt" = CURRENT_TIMESTAMP - INTERVAL '120 seconds',
             "blockedUntil" = NULL,
             "requestCount" = 0
         WHERE "userId" = $1::uuid`,
        [userA],
      );

      await svcA.syncSteps(userA, {
        operationId: "op-rl-a-after-window",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-rl-a",
        sequence: 4,
        timeZone: "UTC",
        snapshots: [{ localDate, steps: 8888, sourceCalculatedAt: now.toISOString() }],
      });
      expect((await svcA.getToday(userA)).steps).toBe(8888);
    });
  }, 300_000);

  it("DST/timezone boundary keeps declared localDate", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const now = new Date("2026-03-29T01:30:00.000Z");
      const userId = await createUser(pool, "Europe/Amsterdam");
      await grantActivityConsent(pool, userId, "apple_health");
      const db = createDb();
      const svc = service(db, now);
      const localDate = dateOnlyInTimeZone("Europe/Amsterdam", now);

      const result = await svc.syncSteps(userId, {
        operationId: "op-dst",
        source: "HEALTHKIT",
        clientInstanceId: "iphone-dst-01",
        sequence: 1,
        timeZone: "Europe/Amsterdam",
        snapshots: [
          {
            localDate,
            steps: 42,
            sourceCalculatedAt: now.toISOString(),
          },
        ],
      });
      expect(result.today.localDate).toBe(localDate);
      expect(result.today.steps).toBe(42);
      expect(result.today.timeZone).toBe("Europe/Amsterdam");
    });
  }, 300_000);
});
