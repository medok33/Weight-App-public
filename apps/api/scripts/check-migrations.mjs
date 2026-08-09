#!/usr/bin/env node
/**
 * CI / verify gates that do not require a live database.
 * - duplicate migration numbers
 * - untracked migration folders in a git working tree
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertMigrationsTracked,
  assertUniqueMigrationNumbers,
  listMigrationNames,
} from './lib/sql-migration-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const migrationsRoot = join(__dirname, '../prisma/migrations');

const names = listMigrationNames(migrationsRoot);
assertUniqueMigrationNumbers(names);
const tracked = assertMigrationsTracked(repoRoot, migrationsRoot);

process.env.WORKOUT_CATALOG_01B_CHECK = '1';
await import('./generate-workout-catalog-01b.mjs?check');
delete process.env.WORKOUT_CATALOG_01B_CHECK;

console.info(
  JSON.stringify({
    ok: true,
    migrationCount: names.length,
    trackedGate: tracked.skipped ? 'skipped_not_git' : 'passed',
  }),
);
