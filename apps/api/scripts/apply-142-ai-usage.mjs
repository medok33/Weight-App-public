import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/142_ai-usage-log/migration.sql'), 'utf8');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

await client.connect();
await client.query(sql);
const check = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'AIUsageLog'`,
);
console.log('AIUsageLog columns:', check.rows.map((r) => r.column_name).join(', '));
await client.end();
