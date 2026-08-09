import fs from 'node:fs';
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});
await client.connect();
for (const file of ['139_price-observation-sources', '140_retailer-type-key', '141_price-intelligence-engine']) {
  const sql = fs.readFileSync(`prisma/migrations/${file}/migration.sql`, 'utf8');
  await client.query(sql);
}
const retailers = await client.query(
  `SELECT code, name, region, active FROM "Retailer" WHERE code IN ('MAGNIT','PYATEROCHKA','VKUSVILL') ORDER BY code`,
);
console.log(retailers.rows);
await client.end();
