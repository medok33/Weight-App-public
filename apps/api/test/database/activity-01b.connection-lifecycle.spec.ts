/**
 * ACTIVITY-01B — provider connection lifecycle + sync status persistence.
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
const M216 = "216_activity_01b_connection_lifecycle";

let fullDb: DisposableMigratedDb;
let pre216Db: DisposableMigratedDb;
const ACTIVITY_CONNECTION_RESET_TABLES = [
  "ActivityDailySnapshot",
  "ActivityProviderConnection",
  "ActivitySyncClient",
  "ActivitySyncOperation",
  "ActivitySyncRateBucket",
  "HealthPlatformConsent",
] as const;

beforeAll(async () => {
  fullDb = await createDisposableMigratedDb();
  pre216Db = await createDisposableMigratedDb({ onlyUntil: M215 });
}, 300_000);

afterAll(async () => {
  await pre216Db?.cleanup();
  await fullDb?.cleanup();
}, 300_000);

async function withDisposableMigratedDb<T>(
  fn: (ctx: { pool: Pool; connectionString: string; createDb: () => PrismaService }) => Promise<T>,
  migrateOptions?: { onlyUntil?: string },
): Promise<T> {
  const target = migrateOptions?.onlyUntil === M215 ? pre216Db : fullDb;
  if (target !== pre216Db) {
    await resetDisposableDatabase(target.connectionString, target.pool, { tables: ACTIVITY_CONNECTION_RESET_TABLES });
  }
  return fn(target);
}

async function createUser(pool: Pool, timezone = "UTC") {
  const userId = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email) VALUES ($1::uuid, $2)`, [
    userId,
    `act01b-${userId.slice(0, 8)}@example.com`,
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
     ) VALUES ($1::uuid, $2, 'activity', 'READ', 'activity-sync', '01b', 'GRANTED', 'test')`,
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

function service(db: PrismaService, now: Date) {
  return new ActivityService(db, { now: () => now });
}

function basePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    operationId: "op-01b",
    source: "HEALTHKIT",
    clientInstanceId: "iphone-client-01b",
    sequence: 1,
    timeZone: "UTC",
    snapshots: [
      {
        localDate: "2026-08-04",
        steps: 5000,
        sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("ACTIVITY-01B connection lifecycle", () => {
  it("clean bootstrap includes 216; repeat migrate is no-op", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const ledger = await pool.query(
        `SELECT "migrationName" FROM "SchemaMigrationLedger"
         WHERE "migrationName" = $1`,
        [M216],
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

  it("upgrade 215 → 216 backfills connections; snapshots preserved; repeat = 0", async () => {
    await withDisposableMigratedDb(
      async ({ pool }) => {
        const userId = await createUser(pool, "UTC");
        await grantActivityConsent(pool, userId, "apple_health");

        await pool.query(
          `INSERT INTO "ActivitySyncClient" (
             id, "userId", "sourceType", "clientInstanceId",
             "lastAcceptedSequence", "lastSuccessfulSyncAt", "createdAt", "updatedAt"
           ) VALUES (
             gen_random_uuid(), $1::uuid, 'HEALTHKIT', 'legacy-client-01',
             3, '2026-08-03T12:00:00.000Z', '2026-08-01T08:00:00.000Z', now()
           )`,
          [userId],
        );

        const clientRow = await pool.query<{ id: string }>(
          `SELECT id FROM "ActivitySyncClient" WHERE "userId" = $1::uuid`,
          [userId],
        );
        const syncClientId = clientRow.rows[0]!.id;

        await pool.query(
          `INSERT INTO "ActivityDailySnapshot" (
             "userId", "sourceType", "syncClientId", "metricType", "localDate", "timeZone",
             value, version, status, "sourceCalculatedAt", "syncOperationId"
           ) VALUES (
             $1::uuid, 'HEALTHKIT', $2::uuid, 'STEPS', '2026-08-03', 'UTC',
             4200, 1, 'ACTIVE', '2026-08-03T18:00:00.000Z', 'legacy-op'
           )`,
          [userId, syncClientId],
        );

        const client = await pool.connect();
        try {
          const applied = await runSqlMigrations(client, {
            migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
          });
          expect(applied.applied.map((a: { name: string }) => a.name)).toContain(M216);
        } finally {
          client.release();
        }

        const connections = await pool.query(
          `SELECT status, "connectedAt", "lastSuccessfulSyncAt"
           FROM "ActivityProviderConnection"
           WHERE "userId" = $1::uuid AND "sourceType" = 'HEALTHKIT'`,
          [userId],
        );
        expect(connections.rows).toHaveLength(1);
        expect(connections.rows[0]?.status).toBe("CONNECTED");
        expect(new Date(connections.rows[0]!.connectedAt).toISOString()).toBe(
          "2026-08-01T08:00:00.000Z",
        );
        expect(new Date(connections.rows[0]!.lastSuccessfulSyncAt).toISOString()).toBe(
          "2026-08-03T12:00:00.000Z",
        );

        const snaps = await pool.query(
          `SELECT value FROM "ActivityDailySnapshot"
           WHERE "userId" = $1::uuid AND status = 'ACTIVE'`,
          [userId],
        );
        expect(snaps.rows).toHaveLength(1);
        expect(Number(snaps.rows[0]?.value)).toBe(4200);

        const client2 = await pool.connect();
        try {
          const rerun = await runSqlMigrations(client2, {
            migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
          });
          expect(rerun.applied).toEqual([]);
        } finally {
          client2.release();
        }
      },
      { onlyUntil: M215 },
    );
  }, 300_000);

  it("first sync creates CONNECTED and fills lastSuccessfulSyncAt", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      const before = await svc.listConnections(userId);
      const hk = before.providers.find((p) => p.source === "HEALTHKIT")!;
      expect(hk.connectionState).toBe("NOT_CONNECTED");

      const result = await svc.syncSteps(
        userId,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 6400,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );
      expect(result.accepted).toBe(true);
      expect(result.today.steps).toBe(6400);

      const conn = await pool.query(
        `SELECT status, "lastSuccessfulSyncAt" FROM "ActivityProviderConnection"
         WHERE "userId" = $1::uuid AND "sourceType" = 'HEALTHKIT'`,
        [userId],
      );
      expect(conn.rows).toHaveLength(1);
      expect(conn.rows[0]?.status).toBe("CONNECTED");
      expect(conn.rows[0]?.lastSuccessfulSyncAt).toBeTruthy();

      const status = await svc.listConnections(userId);
      expect(status.providers.find((p) => p.source === "HEALTHKIT")?.connectionState).toBe(
        "CONNECTED",
      );
    });
  }, 300_000);

  it("idempotent replay does not duplicate connection or snapshot versions", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);
      const payload = basePayload({
        snapshots: [
          {
            localDate: today,
            steps: 1111,
            sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
          },
        ],
      });

      await svc.syncSteps(userId, payload);
      await svc.syncSteps(userId, payload);

      const connections = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityProviderConnection"
         WHERE "userId" = $1::uuid AND "sourceType" = 'HEALTHKIT'`,
        [userId],
      );
      expect(connections.rows[0]?.c).toBe(1);

      const snaps = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityDailySnapshot"
         WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(snaps.rows[0]?.c).toBe(1);
    });
  }, 300_000);

  it("disconnect keeps history and blocks new sync even with new clientInstanceId", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      await svc.syncSteps(
        userId,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 7777,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );

      const disconnected = await svc.disconnectProvider(userId, "HEALTHKIT");
      expect(disconnected.connectionState).toBe("DISCONNECTED");
      expect(disconnected.syncHealth).toBe("BLOCKED_BY_DISCONNECT");

      const snaps = await pool.query(
        `SELECT value, status FROM "ActivityDailySnapshot" WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(snaps.rows).toHaveLength(1);
      expect(Number(snaps.rows[0]?.value)).toBe(7777);

      const clients = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncClient" WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(clients.rows[0]?.c).toBe(1);

      const ops = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(ops.rows[0]?.c).toBe(1);

      const todayView = await svc.getToday(userId);
      expect(todayView.steps).toBe(7777);
      expect(todayView.dataState).toBe("SYNCED");

      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-after-disconnect",
            clientInstanceId: "brand-new-client-99",
            sequence: 2,
            snapshots: [
              {
                localDate: today,
                steps: 9999,
                sourceCalculatedAt: "2026-08-04T12:00:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("ACTIVITY_CONNECTION_DISCONNECTED");

      const snapsAfter = await pool.query(
        `SELECT value FROM "ActivityDailySnapshot"
         WHERE "userId" = $1::uuid AND status = 'ACTIVE'`,
        [userId],
      );
      expect(Number(snapsAfter.rows[0]?.value)).toBe(7777);
    });
  }, 300_000);

  it("reconnect requires consent; then sync works and history remains", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      await svc.syncSteps(
        userId,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 3000,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );
      await svc.disconnectProvider(userId, "HEALTHKIT");
      await revokeActivityConsent(pool, userId, "apple_health");

      await expect(svc.connectProvider(userId, "HEALTHKIT")).rejects.toThrow(
        "HEALTH_CONSENT_REQUIRED",
      );

      await grantActivityConsent(pool, userId, "apple_health");
      const reconnected = await svc.connectProvider(userId, "HEALTHKIT");
      expect(reconnected.connectionState).toBe("CONNECTED");

      await svc.syncSteps(
        userId,
        basePayload({
          operationId: "op-after-reconnect",
          sequence: 2,
          snapshots: [
            {
              localDate: today,
              steps: 3500,
              sourceCalculatedAt: "2026-08-04T12:30:00.000Z",
            },
          ],
        }),
      );

      const versions = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityDailySnapshot" WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(versions.rows[0]?.c).toBe(2);
      const todayView = await svc.getToday(userId);
      expect(todayView.steps).toBe(3500);
    });
  }, 300_000);

  it("consent revoke blocks sync but keeps connection and history", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      await svc.syncSteps(
        userId,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 2222,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );
      await revokeActivityConsent(pool, userId, "apple_health");

      const status = await svc.listConnections(userId);
      const hk = status.providers.find((p) => p.source === "HEALTHKIT")!;
      expect(hk.connectionState).toBe("CONNECTED");
      expect(hk.consentState).toBe("REVOKED");
      expect(hk.syncHealth).toBe("BLOCKED_BY_CONSENT");

      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-revoked",
            sequence: 2,
            snapshots: [
              {
                localDate: today,
                steps: 1,
                sourceCalculatedAt: "2026-08-04T12:00:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("HEALTH_CONSENT_REQUIRED");

      expect((await svc.getToday(userId)).steps).toBe(2222);
    });
  }, 300_000);

  it("tenant isolation for connections; HEALTH_CONNECT works; MANUAL rejected", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userA = await createUser(pool, "UTC");
      const userB = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userA, "apple_health");
      await grantActivityConsent(pool, userB, "health_connect");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      await svc.syncSteps(
        userA,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 100,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );
      await svc.syncSteps(
        userB,
        basePayload({
          source: "HEALTH_CONNECT",
          clientInstanceId: "android-client-01b",
          operationId: "op-hc",
          snapshots: [
            {
              localDate: today,
              steps: 200,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );

      const a = await svc.listConnections(userA);
      const b = await svc.listConnections(userB);
      expect(a.providers.find((p) => p.source === "HEALTHKIT")?.connectionState).toBe(
        "CONNECTED",
      );
      expect(a.providers.find((p) => p.source === "HEALTH_CONNECT")?.connectionState).toBe(
        "NOT_CONNECTED",
      );
      expect(b.providers.find((p) => p.source === "HEALTH_CONNECT")?.connectionState).toBe(
        "CONNECTED",
      );
      expect((await svc.getToday(userA)).steps).toBe(100);
      expect((await svc.getToday(userB)).steps).toBe(200);

      await expect(
        svc.syncSteps(userA, basePayload({ source: "MANUAL" })),
      ).rejects.toThrow("ACTIVITY_SOURCE_UNSUPPORTED");
      await expect(svc.connectProvider(userA, "GOOGLE_FIT")).rejects.toThrow(
        "ACTIVITY_SOURCE_UNSUPPORTED",
      );
    });
  }, 300_000);

  it("account deletion cascades Activity tables including connections", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      await svc.syncSteps(
        userId,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 50,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );

      await pool.query(`DELETE FROM "User" WHERE id = $1::uuid`, [userId]);

      const leftover = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM "ActivityProviderConnection" WHERE "userId" = $1::uuid) AS connections,
           (SELECT count(*)::int FROM "ActivityDailySnapshot" WHERE "userId" = $1::uuid) AS snaps,
           (SELECT count(*)::int FROM "ActivitySyncClient" WHERE "userId" = $1::uuid) AS clients`,
        [userId],
      );
      expect(leftover.rows[0]).toEqual({ connections: 0, snaps: 0, clients: 0 });
    });
  }, 300_000);

  it("parallel connect: one row, both succeed, no 500", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const svc = service(db, new Date("2026-08-04T12:00:00.000Z"));

      const settled = await Promise.allSettled([
        svc.connectProvider(userId, "HEALTHKIT"),
        svc.connectProvider(userId, "HEALTHKIT"),
      ]);
      expect(settled.every((item) => item.status === "fulfilled")).toBe(true);
      for (const item of settled) {
        if (item.status === "fulfilled") {
          expect(item.value.connectionState).toBe("CONNECTED");
        }
      }
      const rows = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityProviderConnection"
         WHERE "userId" = $1::uuid AND "sourceType" = 'HEALTHKIT'`,
        [userId],
      );
      expect(rows.rows[0]?.c).toBe(1);
    });
  }, 300_000);

  it("parallel first sync: one connection; no HTTP 500 unique violation", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      const settled = await Promise.allSettled([
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-parallel-a",
            clientInstanceId: "client-parallel-a",
            sequence: 1,
            snapshots: [
              {
                localDate: today,
                steps: 1111,
                sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
              },
            ],
          }),
        ),
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-parallel-b",
            clientInstanceId: "client-parallel-b",
            sequence: 1,
            snapshots: [
              {
                localDate: today,
                steps: 2222,
                sourceCalculatedAt: "2026-08-04T11:01:00.000Z",
              },
            ],
          }),
        ),
      ]);

      const fulfilled = settled.filter((item) => item.status === "fulfilled");
      const rejected = settled.filter((item) => item.status === "rejected");
      expect(fulfilled.length + rejected.length).toBe(2);
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      for (const item of rejected) {
        if (item.status === "rejected") {
          const message = String((item.reason as Error)?.message ?? item.reason);
          expect(message).not.toMatch(/unique|duplicate|23505/i);
        }
      }

      const connections = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivityProviderConnection"
         WHERE "userId" = $1::uuid AND "sourceType" = 'HEALTHKIT'`,
        [userId],
      );
      expect(connections.rows[0]?.c).toBe(1);
      expect(
        (await svc.listConnections(userId)).providers.find((p) => p.source === "HEALTHKIT")
          ?.connectionState,
      ).toBe("CONNECTED");
    });
  }, 300_000);

  it("sync vs disconnect serialization: disconnect-first blocks; sync-first keeps history", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      // Seed CONNECTED via first sync so disconnect has a row.
      await svc.syncSteps(
        userId,
        basePayload({
          operationId: "op-seed",
          snapshots: [
            {
              localDate: today,
              steps: 3000,
              sourceCalculatedAt: "2026-08-04T10:00:00.000Z",
            },
          ],
        }),
      );

      // A: disconnect commits first, then sync must be blocked without extra snapshot.
      await svc.disconnectProvider(userId, "HEALTHKIT");
      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-after-disc",
            clientInstanceId: "client-after-disc",
            sequence: 2,
            snapshots: [
              {
                localDate: today,
                steps: 9999,
                sourceCalculatedAt: "2026-08-04T12:00:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("ACTIVITY_CONNECTION_DISCONNECTED");
      const activeAfterBlock = await pool.query(
        `SELECT value FROM "ActivityDailySnapshot"
         WHERE "userId" = $1::uuid AND status = 'ACTIVE'`,
        [userId],
      );
      expect(Number(activeAfterBlock.rows[0]?.value)).toBe(3000);

      // B: reconnect, sync succeeds, then disconnect — history retained.
      await svc.connectProvider(userId, "HEALTHKIT");
      await svc.syncSteps(
        userId,
        basePayload({
          operationId: "op-before-disc",
          clientInstanceId: "client-before-disc",
          sequence: 1,
          snapshots: [
            {
              localDate: today,
              steps: 4444,
              sourceCalculatedAt: "2026-08-04T12:10:00.000Z",
            },
          ],
        }),
      );
      const disconnected = await svc.disconnectProvider(userId, "HEALTHKIT");
      expect(disconnected.connectionState).toBe("DISCONNECTED");
      expect((await svc.getToday(userId)).steps).toBe(4444);
      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-blocked-again",
            clientInstanceId: "client-blocked-again",
            sequence: 2,
            snapshots: [
              {
                localDate: today,
                steps: 1,
                sourceCalculatedAt: "2026-08-04T12:20:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("ACTIVITY_CONNECTION_DISCONNECTED");
    });
  }, 300_000);

  it("exact replay after disconnect returns stored response without writes", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      const payload = basePayload({
        operationId: "op-replay-disc",
        snapshots: [
          {
            localDate: today,
            steps: 5555,
            sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
          },
        ],
      });
      const first = await svc.syncSteps(userId, payload);
      expect(first.accepted).toBe(true);
      await svc.disconnectProvider(userId, "HEALTHKIT");

      const opsBefore = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" WHERE "userId" = $1::uuid`,
        [userId],
      );
      const replay = await svc.syncSteps(userId, payload);
      expect(replay.accepted).toBe(true);
      expect(replay.today.steps).toBe(5555);
      const opsAfter = await pool.query(
        `SELECT count(*)::int AS c FROM "ActivitySyncOperation" WHERE "userId" = $1::uuid`,
        [userId],
      );
      expect(opsAfter.rows[0]?.c).toBe(opsBefore.rows[0]?.c);

      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-replay-disc",
            snapshots: [
              {
                localDate: today,
                steps: 1,
                sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("ACTIVITY_OPERATION_PAYLOAD_CONFLICT");

      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-new-after-disc",
            sequence: 2,
            snapshots: [
              {
                localDate: today,
                steps: 9,
                sourceCalculatedAt: "2026-08-04T12:00:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("ACTIVITY_CONNECTION_DISCONNECTED");
    });
  }, 300_000);

  it("reconnect vs sync: DISCONNECTED blocks until reconnect commits", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const now = new Date("2026-08-04T12:00:00.000Z");
      const today = dateOnlyInTimeZone("UTC", now);
      const svc = service(db, now);

      await svc.syncSteps(
        userId,
        basePayload({
          snapshots: [
            {
              localDate: today,
              steps: 100,
              sourceCalculatedAt: "2026-08-04T11:00:00.000Z",
            },
          ],
        }),
      );
      await svc.disconnectProvider(userId, "HEALTHKIT");

      await expect(
        svc.syncSteps(
          userId,
          basePayload({
            operationId: "op-while-disc",
            sequence: 2,
            snapshots: [
              {
                localDate: today,
                steps: 200,
                sourceCalculatedAt: "2026-08-04T11:30:00.000Z",
              },
            ],
          }),
        ),
      ).rejects.toThrow("ACTIVITY_CONNECTION_DISCONNECTED");

      await svc.connectProvider(userId, "HEALTHKIT");
      const after = await svc.syncSteps(
        userId,
        basePayload({
          operationId: "op-after-reconnect",
          clientInstanceId: "client-reconnect",
          sequence: 1,
          snapshots: [
            {
              localDate: today,
              steps: 200,
              sourceCalculatedAt: "2026-08-04T12:00:00.000Z",
            },
          ],
        }),
      );
      expect(after.accepted).toBe(true);
      expect(after.today.steps).toBe(200);
    });
  }, 300_000);

  it("GET connections does not take FOR UPDATE (read path stays unlocked)", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = await createDb();
      const userId = await createUser(pool, "UTC");
      await grantActivityConsent(pool, userId, "apple_health");
      const svc = service(db, new Date("2026-08-04T12:00:00.000Z"));

      // Holding a transaction-scoped lock on the connection row must not block GET.
      const hold = await pool.connect();
      try {
        await hold.query("BEGIN");
        await hold.query(
          `SELECT pg_advisory_xact_lock($1, hashtext($2::text))`,
          [21601001, `${userId}:HEALTHKIT`],
        );
        const listed = await svc.listConnections(userId);
        expect(listed.providers).toHaveLength(2);
        expect(listed.providers.every((p) => p.connectionState === "NOT_CONNECTED")).toBe(true);
        await hold.query("COMMIT");
      } finally {
        hold.release();
      }
    });
  }, 300_000);
});
