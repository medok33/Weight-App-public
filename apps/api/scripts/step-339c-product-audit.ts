import { Client } from 'pg';
import { startRuntime, migrate, stopRuntime } from '../../../scripts/verify/disposable-runtime.mjs';

(async () => {
  const env = await startRuntime();
  try {
    await migrate(env);
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    const count = async (table: string) => (await client.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
    console.log(JSON.stringify({
      products: await count('Product'),
      aliases: await count('ProductAlias'),
      nutrition: await count('ProductNutritionVersion'),
    }));
    await client.end();
  } finally {
    stopRuntime(env);
  }
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
