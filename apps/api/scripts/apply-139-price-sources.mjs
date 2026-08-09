import fs from 'node:fs';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});
await client.connect();
const sql = fs.readFileSync('prisma/migrations/139_price-observation-sources/migration.sql', 'utf8');
await client.query(sql);
const result = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'PriceObservation'
     AND column_name IN ('sourceType','sourceName','currency','retailerId','collectedAt')
   ORDER BY 1`,
);
console.log(result.rows);
await client.end();
