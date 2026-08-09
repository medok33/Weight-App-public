import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const ADVISORY_LOCK_KEY = 88442201; // stable int for pg_advisory_lock
export const LEDGER_TABLE = 'SchemaMigrationLedger';

export function normalizeSql(content) {
  return String(content).replace(/\r\n/g, '\n');
}

export function checksumSql(content) {
  return createHash('sha256').update(normalizeSql(content), 'utf8').digest('hex');
}

export function listMigrationNames(migrationsRoot) {
  if (!existsSync(migrationsRoot)) return [];
  return readdirSync(migrationsRoot)
    .filter((name) => {
      const full = join(migrationsRoot, name);
      return statSync(full).isDirectory() && existsSync(join(full, 'migration.sql'));
    })
    .sort((a, b) => a.localeCompare(b, 'en'));
}

export function assertUniqueMigrationNumbers(names) {
  const seen = new Map();
  for (const name of names) {
    const match = /^(\d+)/.exec(name);
    if (!match) throw new Error(`MIGRATION_NAME_INVALID:${name}`);
    const num = match[1];
    if (seen.has(num)) throw new Error(`MIGRATION_NUMBER_DUPLICATE:${num}:${seen.get(num)}:${name}`);
    seen.set(num, name);
  }
}

export function migrationSortKey(name) {
  const match = /^(\d+)/.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function shouldIncludeMigration(name, { stopBefore = null, onlyUntil = null } = {}) {
  const key = migrationSortKey(name);
  if (stopBefore != null && key >= migrationSortKey(stopBefore)) return false;
  if (onlyUntil != null && key > migrationSortKey(onlyUntil)) return false;
  return true;
}

/** Fail if working tree has migration.sql files that are not git-tracked. */
export function assertMigrationsTracked(repoRoot, migrationsRoot) {
  let tracked;
  try {
    tracked = execFileSync('git', ['-c', `safe.directory=${repoRoot}`, 'ls-files', 'apps/api/prisma/migrations'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replace(/^apps\/api\/prisma\/migrations\//, '').split('/')[0])
      .filter(Boolean);
  } catch {
    // Not a git checkout (e.g. archive extract) — skip tracked gate.
    return { skipped: true, untracked: [] };
  }
  const trackedSet = new Set(tracked);
  const onDisk = listMigrationNames(migrationsRoot);
  const untracked = onDisk.filter((name) => !trackedSet.has(name));
  if (untracked.length) {
    throw new Error(`MIGRATION_UNTRACKED:${untracked.join(',')}`);
  }
  return { skipped: false, untracked: [] };
}

export async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${LEDGER_TABLE}" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "migrationName" text NOT NULL UNIQUE,
      checksum text NOT NULL,
      "appliedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "durationMs" integer NOT NULL,
      result text NOT NULL CHECK (result IN ('applied','baseline','noop')),
      "runnerVersion" text NOT NULL DEFAULT '1'
    );
    CREATE INDEX IF NOT EXISTS "SchemaMigrationLedger_appliedAt_idx"
      ON "${LEDGER_TABLE}" ("appliedAt");
  `);
}

export async function withAdvisoryLock(client, fn) {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

export async function readLedger(client) {
  const result = await client.query(
    `SELECT "migrationName", checksum, result, "appliedAt", "durationMs" FROM "${LEDGER_TABLE}" ORDER BY "migrationName"`,
  );
  return result.rows;
}

/**
 * Apply pending SQL migrations exactly-once.
 * - Already applied + same checksum → noop
 * - Already applied + different checksum → throw MIGRATION_CHECKSUM_MISMATCH
 * - baseline=true → record checksums without executing SQL (for legacy DBs)
 */
export async function runSqlMigrations(client, options) {
  const {
    migrationsRoot,
    baseline = false,
    stopBefore = null, // exclusive: apply names < stopBefore
    onlyUntil = null, // inclusive: apply names <= onlyUntil
  } = options;

  const names = listMigrationNames(migrationsRoot);
  assertUniqueMigrationNumbers(names);

  return withAdvisoryLock(client, async () => {
    await ensureLedger(client);
    const existing = new Map((await readLedger(client)).map((row) => [row.migrationName, row]));
    const applied = [];
    const skipped = [];

    for (const name of names) {
      if (!shouldIncludeMigration(name, { stopBefore, onlyUntil })) continue;

      const sqlPath = join(migrationsRoot, name, 'migration.sql');
      const sql = readFileSync(sqlPath, 'utf8');
      const checksum = checksumSql(sql);
      const prior = existing.get(name);

      if (prior) {
        if (prior.checksum !== checksum) {
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${name}:ledger=${prior.checksum}:file=${checksum}`);
        }
        skipped.push(name);
        continue;
      }

      const started = Date.now();
      if (baseline) {
        await client.query(
          `INSERT INTO "${LEDGER_TABLE}" ("migrationName", checksum, "durationMs", result)
           VALUES ($1, $2, $3, 'baseline')`,
          [name, checksum, Date.now() - started],
        );
        applied.push({ name, result: 'baseline' });
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        const durationMs = Date.now() - started;
        await client.query(
          `INSERT INTO "${LEDGER_TABLE}" ("migrationName", checksum, "durationMs", result)
           VALUES ($1, $2, $3, 'applied')`,
          [name, checksum, durationMs],
        );
        await client.query('COMMIT');
        applied.push({ name, result: 'applied', durationMs });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`MIGRATION_FAILED:${name}:${message}`);
      }
    }

    return {
      applied,
      skipped,
      totalFiles: names.filter((n) => shouldIncludeMigration(n, { stopBefore, onlyUntil })).length,
      ledgerVersion: 1,
    };
  });
}

/** Minimal drift gate: required tables after full migrate. */
export const REQUIRED_TABLES_AFTER_LATEST = [
  'User',
  'UserProfile',
  'WorkoutPlan',
  'MealCompletion',
  'ProgressEntry',
  'ShoppingItem',
  'PriceObservation',
  'Retailer',
  'Product',
  'NotificationOutbox',
  'HealthPlatformConsent',
  'RecipeStep',
  LEDGER_TABLE,
];

export async function assertSchemaReady(client, requiredTables = REQUIRED_TABLES_AFTER_LATEST) {
  const result = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])`,
    [requiredTables],
  );
  const have = new Set(result.rows.map((r) => r.tablename));
  const missing = requiredTables.filter((t) => !have.has(t));
  if (missing.length) throw new Error(`SCHEMA_DRIFT_MISSING_TABLES:${missing.join(',')}`);
  return { tablesChecked: requiredTables.length, missing: [] };
}
