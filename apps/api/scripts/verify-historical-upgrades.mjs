#!/usr/bin/env node
/**
 * Package A verification: historical upgrades A/B on disposable Postgres.
 * Requires Docker + DATABASE_URL admin-capable user (creates temporary DBs).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertSchemaReady, runSqlMigrations } from './lib/sql-migration-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsRoot = resolve(__dirname, '../prisma/migrations');
const rootUrl = process.env.DATABASE_URL || 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

function adminUrl() {
  return rootUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
}

async function withDb(name, fn) {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = rootUrl.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client, url);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

async function upgradeA() {
  return withDb(`pkg_a_pre094_${Date.now()}`, async (client) => {
    const before = await runSqlMigrations(client, { migrationsRoot, stopBefore: '094_workout-plan' });
    await client.query(`INSERT INTO "User"(id, email) VALUES (gen_random_uuid(), 'pre094@example.local')`);
    const usersBefore = Number((await client.query(`SELECT count(*)::text AS c FROM "User"`)).rows[0].c);
    const after = await runSqlMigrations(client, { migrationsRoot });
    const usersAfter = Number((await client.query(`SELECT count(*)::text AS c FROM "User"`)).rows[0].c);
    await assertSchemaReady(client);
    const hasWorkout = await client.query(`SELECT to_regclass('"WorkoutPlan"') AS t`);
    const noop = await runSqlMigrations(client, { migrationsRoot });
    return {
      scenario: 'A_pre094_to_latest',
      appliedBefore094: before.applied.length,
      appliedAfter: after.applied.length,
      usersBefore,
      usersAfter,
      workoutPlan: Boolean(hasWorkout.rows[0].t),
      noopApplied: noop.applied.length,
      noopSkipped: noop.skipped.length,
    };
  });
}

async function upgradeB() {
  return withDb(`pkg_a_pre136_${Date.now()}`, async (client) => {
    const before = await runSqlMigrations(client, { migrationsRoot, stopBefore: '136_meal-completion-progress' });
    await client.query(`INSERT INTO "User"(id, email) VALUES (gen_random_uuid(), 'pre136@example.local')`);
    const usersBefore = Number((await client.query(`SELECT count(*)::text AS c FROM "User"`)).rows[0].c);
    const after = await runSqlMigrations(client, { migrationsRoot });
    const usersAfter = Number((await client.query(`SELECT count(*)::text AS c FROM "User"`)).rows[0].c);
    const meal = await client.query(`SELECT to_regclass('"MealCompletion"') AS t`);
    const locale = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='UserProfile' AND column_name='locale'`,
    );
    const noop = await runSqlMigrations(client, { migrationsRoot });
    await assertSchemaReady(client);
    return {
      scenario: 'B_pre136_to_latest',
      appliedBefore136: before.applied.length,
      appliedAfter: after.applied.length,
      usersBefore,
      usersAfter,
      mealCompletion: Boolean(meal.rows[0].t),
      localeColumn: locale.rowCount > 0,
      noopApplied: noop.applied.length,
      noopSkipped: noop.skipped.length,
    };
  });
}

const a = await upgradeA();
const b = await upgradeB();
if (a.usersBefore !== a.usersAfter || a.noopApplied !== 0 || !a.workoutPlan) {
  console.error('UPGRADE_A_FAILED', a);
  process.exit(1);
}
if (b.usersBefore !== b.usersAfter || b.noopApplied !== 0 || !b.mealCompletion || !b.localeColumn) {
  console.error('UPGRADE_B_FAILED', b);
  process.exit(1);
}
console.info(JSON.stringify({ ok: true, a, b }, null, 2));
