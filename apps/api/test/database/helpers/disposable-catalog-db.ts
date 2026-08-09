/**
 * Fail-closed disposable PostgreSQL helpers for catalog/workout persistence tests.
 * Never falls back to shared weight_app.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { URL } from "node:url";
import { Pool } from "pg";
import { afterAll, expect } from "vitest";
import { PrismaService, type SqlQuery } from "../../../src/infrastructure/database/prisma.service";
import { runSqlMigrations } from "../../../scripts/lib/sql-migration-runner.mjs";
import {
  assertDisposableDatabaseUrl,
  confirmSafeDisposableDatabase,
  inspectDatabaseUrl,
} from "../../../src/test-support/assert-disposable-database";

export type DisposableMigratedDb = {
  pool: Pool;
  connectionString: string;
  createDb: () => PrismaService;
  cleanup: () => Promise<void>;
};

type DisposableTemplate = {
  database: string;
  adminConnectionString: string;
  ownedByTestFile: boolean;
};

let reusableTemplate: Promise<DisposableTemplate> | null = null;

function progress(stage: string): void {
  if (process.env.WEIGHT_APP_DIAGNOSTIC_PROGRESS === "1") console.log(`DISPOSABLE_DB_STAGE ${stage}`);
}

async function createReusableTemplate(): Promise<DisposableTemplate> {
  const baseConnectionString = process.env.DATABASE_URL;
  assertDisposableDatabaseUrl(baseConnectionString);
  confirmSafeDisposableDatabase(baseConnectionString);
  const canonicalMode = process.env.WEIGHT_APP_DISPOSABLE_MODE === '1';
  const runtimeSuffix = process.env.WEIGHT_APP_RUNTIME_ID?.slice(3).replaceAll('-', '_');
  const canonicalTemplate = runtimeSuffix ? `wt_cat_${runtimeSuffix}_template` : null;
  const externalTemplate = process.env.DISPOSABLE_CATALOG_TEMPLATE_DATABASE;
  if (externalTemplate) {
    const valid = canonicalMode
      ? externalTemplate === canonicalTemplate
      : /^wt_cat_template_[a-z0-9_]+$/i.test(externalTemplate);
    if (!valid) {
      throw new Error("UNSAFE_DATABASE_TARGET:CATALOG_TEMPLATE_NAME_INVALID");
    }
    const adminConnectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
    progress(`USE_RUNTIME_TEMPLATE ${externalTemplate}`);
    return { database: externalTemplate, adminConnectionString, ownedByTestFile: false };
  }
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const database = canonicalMode
    ? `${canonicalTemplate}_${token}`
    : `wt_cat_template_${Date.now()}_${token}`;
  const adminConnectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const connectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
  const admin = new Pool({ connectionString: adminConnectionString });
  admin.on("error", () => undefined);
  let pool: Pool | undefined;
  try {
    progress(`CREATE_TEMPLATE ${database}`);
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new Pool({ connectionString });
    pool.on("error", () => undefined);
    const client = await pool.connect();
    try {
      progress(`MIGRATE_TEMPLATE ${database}`);
      await runSqlMigrations(client, { migrationsRoot: resolve(process.cwd(), "prisma/migrations") });
    } finally {
      client.release();
    }
    await pool.end();
    pool = undefined;
    return { database, adminConnectionString, ownedByTestFile: true };
  } catch (error) {
    await pool?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => undefined);
    throw error;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

afterAll(async () => {
  if (!reusableTemplate) return;
  const template = await reusableTemplate.catch(() => null);
  reusableTemplate = null;
  if (!template?.ownedByTestFile) return;
  const admin = new Pool({ connectionString: template.adminConnectionString });
  try {
    progress(`CLEANUP_TEMPLATE ${template.database}`);
    await admin.query(`DROP DATABASE IF EXISTS "${template.database}" WITH (FORCE)`);
  } finally {
    await admin.end().catch(() => undefined);
  }
});

function assertDisposableChildDatabase(connectionString: string): void {
  const baseConnectionString = process.env.DATABASE_URL;
  assertDisposableDatabaseUrl(baseConnectionString);
  const base = inspectDatabaseUrl(baseConnectionString, process.env);
  let child: { host: string; port: number; database: string } | null = null;
  try {
    const childUrl = new URL(connectionString);
    child = {
      host: childUrl.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1"),
      port: Number(childUrl.port || 5432),
      database: decodeURIComponent(childUrl.pathname.replace(/^\//, "").split("/")[0] ?? ""),
    };
  } catch {
    child = null;
  }
  const expectedChild = base.ok
    ? (process.env.WEIGHT_APP_DISPOSABLE_MODE === '1'
      ? new RegExp(`^wt_cat_${process.env.WEIGHT_APP_RUNTIME_ID?.slice(3).replaceAll('-', '_')}_[a-z0-9_]{2,24}$`, 'i')
      : /^wt_cat_[a-z0-9_]+$/i)
    : null;
  if (base.ok === false || !child || child.host !== base.host || child.port !== base.port || !expectedChild?.test(child.database)) {
    const baseSummary = base.ok ? `${base.host}:${base.port}/${base.database}` : base.reason;
    const childSummary = child ? `${child.host}:${child.port}/${child.database}` : "INVALID_URL";
    throw new Error(`UNSAFE_DATABASE_TARGET:DISPOSABLE_CHILD_DATABASE_REQUIRED:${baseSummary}:${childSummary}`);
  }
}

function disposableChildDatabaseName(baseConnectionString: string): string {
  const base = inspectDatabaseUrl(baseConnectionString, process.env);
  if (base.ok === false) throw new Error(`UNSAFE_DATABASE_TARGET:${base.reason}`);
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  return process.env.WEIGHT_APP_DISPOSABLE_MODE === '1'
    ? `wt_cat_${process.env.WEIGHT_APP_RUNTIME_ID!.slice(3).replaceAll('-', '_')}_${token}`
    : `wt_cat_${Date.now()}_${token}`;
}

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

export async function withDisposableMigratedDb<T>(
  fn: (ctx: { pool: Pool; connectionString: string; createDb: () => PrismaService }) => Promise<T>,
  migrateOptions?: { stopBefore?: string; onlyUntil?: string },
): Promise<T> {
  const baseConnectionString = process.env.DATABASE_URL;
  assertDisposableDatabaseUrl(baseConnectionString);
  confirmSafeDisposableDatabase(baseConnectionString);

  const dbName = disposableChildDatabaseName(baseConnectionString);
  const adminConnectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const connectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const admin = new Pool({ connectionString: adminConnectionString });
  admin.on("error", () => undefined);
  let pool: Pool | undefined;

  try {
    if (migrateOptions) {
      progress(`CREATE_DATABASE ${dbName}`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
    } else {
      reusableTemplate ??= createReusableTemplate();
      const template = await reusableTemplate;
      progress(`CLONE_DATABASE ${dbName} FROM ${template.database}`);
      await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${template.database}"`);
    }
    progress(`CONNECT_DATABASE ${dbName}`);
    pool = new Pool({ connectionString });
    pool.on("error", () => undefined);
    if (migrateOptions) {
      const migrationClient = await pool.connect();
      try {
        progress(`MIGRATE_DATABASE ${dbName}`);
        await runSqlMigrations(migrationClient, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
          ...migrateOptions,
        });
      } finally {
        migrationClient.release();
      }
    }
    progress(`CALL_TEST_BODY ${dbName}`);
    return await fn({ pool, connectionString, createDb: () => createDb(pool!) });
  } finally {
    progress(`CLEANUP_DATABASE ${dbName}`);
    if (pool) {
      try {
        await pool.end();
      } catch {
        // ignore
      }
    }
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } catch {
      // ignore cleanup races
    }
    try {
      await admin.end();
    } catch {
      // ignore
    }
  }
}

export async function createDisposableMigratedDb(
  migrateOptions?: { stopBefore?: string; onlyUntil?: string },
): Promise<DisposableMigratedDb> {
  const baseConnectionString = process.env.DATABASE_URL;
  assertDisposableDatabaseUrl(baseConnectionString);
  confirmSafeDisposableDatabase(baseConnectionString);

  const dbName = disposableChildDatabaseName(baseConnectionString);
  const adminConnectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const connectionString = baseConnectionString.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const admin = new Pool({ connectionString: adminConnectionString });
  admin.on("error", () => undefined);
  let pool: Pool | undefined;
  let cleaned = false;
  const progress = (stage: string) => {
    if (process.env.WEIGHT_APP_DIAGNOSTIC_PROGRESS === "1") console.log(`DISPOSABLE_DB_STAGE ${stage}`);
  };

  try {
    progress(`CREATE_DATABASE ${dbName}`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    pool = new Pool({ connectionString });
    pool.on("error", () => undefined);
    const migrationClient = await pool.connect();
    try {
      progress(`MIGRATE_DATABASE ${dbName}`);
      await runSqlMigrations(migrationClient, {
        migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        ...(migrateOptions ?? {}),
      });
    } finally {
      migrationClient.release();
    }
    return {
      pool,
      connectionString,
      createDb: () => createDb(pool!),
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        progress(`CLEANUP_DATABASE ${dbName}`);
        await pool?.end().catch(() => undefined);
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
        await admin.end().catch(() => undefined);
      },
    };
  } catch (error) {
    await pool?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    throw error;
  }
}

export async function resetDisposableDatabase(
  connectionString: string,
  pool: Pool,
  options: { tables?: readonly string[] } = {},
): Promise<void> {
  assertDisposableChildDatabase(connectionString);
  const tables = options.tables ?? (await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'SchemaMigrationLedger' ORDER BY tablename`,
  )).rows.map((row) => row.tablename);
  if (!tables.length || tables.some((table) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || table === 'SchemaMigrationLedger')) {
    throw new Error('UNSAFE_DATABASE_TARGET:RESET_TABLE_ALLOWLIST_INVALID');
  }
  const existing = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [tables],
  );
  if (existing.rows.length !== tables.length) throw new Error('UNSAFE_DATABASE_TARGET:RESET_TABLE_MISSING');
  await pool.query(`TRUNCATE TABLE ${tables.map((table) => `public."${table}"`).join(', ')} RESTART IDENTITY`);
  const ledger = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "SchemaMigrationLedger"`);
  if (Number(ledger.rows[0]?.count ?? 0) === 0) throw new Error("UNSAFE_DATABASE_TARGET:MIGRATION_LEDGER_MISSING_AFTER_RESET");
}

export async function assertCanonicalPublished(pool: Pool): Promise<void> {
  const published = await pool.query<{ code: string }>(
    `SELECT code FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
  );
  expect(published.rows).toHaveLength(1);
  expect(published.rows[0]?.code).toBe("workout-catalog-canonical-01b");

  const counts = await pool.query<{ items: string; eligible: string }>(
    `SELECT COUNT(i.id)::text AS items,
            COUNT(i.id) FILTER (
              WHERE i."enabledForGenerator"
                AND r.status = 'APPROVED'
                AND r."exerciseId" = i."exerciseId"
                AND e."familyId" IS NOT DISTINCT FROM i."familyId"
                AND e."isActive" = true
                AND e.key IS NOT NULL
            )::text AS eligible
     FROM "WorkoutCatalogRelease" rel
     LEFT JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
     LEFT JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     LEFT JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE rel.code = 'workout-catalog-canonical-01b'
     GROUP BY rel.id`,
  );
  expect(Number(counts.rows[0]?.items)).toBe(84);
  expect(Number(counts.rows[0]?.eligible)).toBe(84);
}
