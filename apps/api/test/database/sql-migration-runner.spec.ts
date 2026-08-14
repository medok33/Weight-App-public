import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import {
  assertUniqueMigrationNumbers,
  checksumSql,
  ensureLedger,
  listMigrationNames,
  runSqlMigrations,
  assertSchemaReady,
  ADVISORY_LOCK_KEY,
  assertNoLateMigrationInsertion,
} from '../../scripts/lib/sql-migration-runner.mjs';

describe('sql migration runner contract', () => {
  it('rejects duplicate migration numbers', () => {
    expect(() => assertUniqueMigrationNumbers(['094_a', '094_b'])).toThrow(/MIGRATION_NUMBER_DUPLICATE/);
  });

  it('checksums normalize CRLF', () => {
    expect(checksumSql('a\r\nb')).toBe(checksumSql('a\nb'));
    expect(checksumSql('a\nb')).toBe(createHash('sha256').update('a\nb').digest('hex'));
  });

  it('lists migration folders sorted', () => {
    const root = mkdtempSync(join(tmpdir(), 'mig-list-'));
    mkdirSync(join(root, '136_b'));
    writeFileSync(join(root, '136_b', 'migration.sql'), 'SELECT 1;');
    mkdirSync(join(root, '094_a'));
    writeFileSync(join(root, '094_a', 'migration.sql'), 'SELECT 1;');
    expect(listMigrationNames(root)).toEqual(['094_a', '136_b']);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a previously absent lower-numbered migration after a higher migration was applied', () => {
    expect(() => assertNoLateMigrationInsertion(['221_a', '222_brain', '223_price'], ['221_a', '223_price']))
      .toThrow(/MIGRATION_LATE_INSERTION:222_brain/);
    expect(() => assertNoLateMigrationInsertion(['221_a', '223_price'], ['221_a', '223_price'])).not.toThrow();
  });
});

const DATABASE_URL = process.env.DATABASE_URL_MIGRATE_TEST || process.env.DATABASE_URL;

describe.runIf(Boolean(DATABASE_URL))('sql migration runner against postgres', () => {
  async function withTempDb(run) {
    const admin = new pg.Client({
      connectionString: DATABASE_URL.replace(/\/[^/]+(\?|$)/, '/postgres$1'),
    });
    const dbName = `mig_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const root = mkdtempSync(join(tmpdir(), 'mig-run-'));
    try {
      await run(client, root);
    } finally {
      await client.end().catch(() => undefined);
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }

  function writeMig(root, name, sql) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'migration.sql'), sql);
  }

  it('applies once then no-ops; checksum mismatch fails; bad SQL surfaces', async () => {
    await withTempDb(async (client, root) => {
      writeMig(root, '001_init', 'CREATE TABLE t1 (id int PRIMARY KEY);');
      const first = await runSqlMigrations(client, { migrationsRoot: root });
      expect(first.applied).toHaveLength(1);
      const second = await runSqlMigrations(client, { migrationsRoot: root });
      expect(second.applied).toHaveLength(0);
      expect(second.skipped).toEqual(['001_init']);

      writeFileSync(join(root, '001_init', 'migration.sql'), 'CREATE TABLE t1 (id int PRIMARY KEY); -- changed');
      await expect(runSqlMigrations(client, { migrationsRoot: root })).rejects.toThrow(/MIGRATION_CHECKSUM_MISMATCH/);

      writeFileSync(join(root, '001_init', 'migration.sql'), 'CREATE TABLE t1 (id int PRIMARY KEY);');
      writeMig(root, '002_bad', 'CREATE TABLE totally_broken (;;;);');
      await expect(runSqlMigrations(client, { migrationsRoot: root })).rejects.toThrow(/MIGRATION_FAILED:002_bad/);
    });
  }, 15_000);

  it('concurrent runners serialize via advisory lock', async () => {
    await withTempDb(async (client, root) => {
      writeMig(
        root,
        '001_slow',
        `CREATE TABLE IF NOT EXISTS concurrent_marker(id int PRIMARY KEY);
         INSERT INTO concurrent_marker(id) VALUES (1) ON CONFLICT DO NOTHING;
         SELECT pg_sleep(0.4);`,
      );

      const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
      const base = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

      const runOne = async () => {
        const c = new pg.Client({ connectionString: base });
        await c.connect();
        try {
          return await runSqlMigrations(c, { migrationsRoot: root });
        } finally {
          await c.end();
        }
      };

      const [a, b] = await Promise.all([runOne(), runOne()]);
      const appliedCount = [a, b].filter((r) => r.applied.length === 1).length;
      const skippedBoth = a.skipped.includes('001_slow') && b.skipped.includes('001_slow');
      expect(appliedCount === 1 || skippedBoth).toBe(true);
      const rows = await client.query('SELECT count(*)::int AS c FROM concurrent_marker');
      expect(rows.rows[0].c).toBe(1);
      expect(ADVISORY_LOCK_KEY).toBeTypeOf('number');
    });
  }, 15_000);

  it('ensureLedger + drift gate', async () => {
    await withTempDb(async (client) => {
      await ensureLedger(client);
      await expect(assertSchemaReady(client, ['SchemaMigrationLedger'])).resolves.toMatchObject({ missing: [] });
      await expect(assertSchemaReady(client, ['NopeTable'])).rejects.toThrow(/SCHEMA_DRIFT/);
    });
  }, 15_000);
});
