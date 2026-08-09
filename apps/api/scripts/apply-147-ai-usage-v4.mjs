import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/147_ai-usage-v4-fields/migration.sql'),
  'utf8',
);
await client.query(sql);
const cols = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'AIUsageLog'
     AND column_name IN ('tier','thinkingEnabled','totalTokens','estimatedCost','latencyMs','success')
   ORDER BY 1`,
);
console.log('AIUsageLog cols:', cols.rows.map((r) => r.column_name).join(','));
await client.end();
