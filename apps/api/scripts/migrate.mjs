#!/usr/bin/env node
/**
 * Canonical SQL migration runner for Weight App.
 * Usage:
 *   node apps/api/scripts/migrate.mjs
 *   node apps/api/scripts/migrate.mjs --status
 *   node apps/api/scripts/migrate.mjs --baseline   # legacy DB already applied manually
 *   node apps/api/scripts/migrate.mjs --stop-before=094_workout-plan
 *   node apps/api/scripts/migrate.mjs --only-until=135_entitlements
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  assertSchemaReady,
  assertUniqueMigrationNumbers,
  listMigrationNames,
  readLedger,
  runSqlMigrations,
} from './lib/sql-migration-runner.mjs';
import { assertDisposableConfig, isTrue } from '../../../scripts/verify/disposable-runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsRoot = resolve(__dirname, '../prisma/migrations');
const args = new Set(process.argv.slice(2));
const getArg = (prefix) => {
  const hit = [...args].find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (isTrue(process.env.WEIGHT_APP_DISPOSABLE_MODE)) {
  assertDisposableConfig(process.env);
}

const names = listMigrationNames(migrationsRoot);
assertUniqueMigrationNumbers(names);

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  if (args.has('--status')) {
    const { ensureLedger } = await import('./lib/sql-migration-runner.mjs');
    await ensureLedger(client);
    const ledger = await readLedger(client);
    const applied = new Set(ledger.map((r) => r.migrationName));
    const pending = names.filter((n) => !applied.has(n));
    console.info(JSON.stringify({ trackedFiles: names.length, ledgerRows: ledger.length, pending }, null, 2));
    process.exit(0);
  }

  const result = await runSqlMigrations(client, {
    migrationsRoot,
    baseline: args.has('--baseline'),
    stopBefore: getArg('--stop-before='),
    onlyUntil: getArg('--only-until='),
  });

  if (!args.has('--baseline') && !getArg('--stop-before=') && !getArg('--only-until=')) {
    await assertSchemaReady(client);
  }

  console.info(
    JSON.stringify(
      {
        applied: result.applied.length,
        skipped: result.skipped.length,
        totalFiles: result.totalFiles,
        ledgerVersion: result.ledgerVersion,
        namesApplied: result.applied.map((a) => a.name),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}
