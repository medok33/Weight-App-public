import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/159_pantry/migration.sql'),
  'utf8',
);
await client.query(sql);
const tables = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('Pantry','PantryItem')`,
);
console.info('TABLES', tables.rows.map((r) => r.tablename).join(','));
await client.end();
