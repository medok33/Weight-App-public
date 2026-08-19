import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDisposableDatabaseUrl } from '../../src/test-support/assert-disposable-database';

describe('STEP-337/338 authoring persistence acceptance', () => {
  const pool = new Pool({ connectionString: getDisposableDatabaseUrl() });
  let recipeKey: string;
  beforeAll(async () => { await pool.query('SELECT 1'); });
  afterAll(async () => { if (recipeKey) { const rows = await pool.query<{ id: string }>('SELECT id FROM "Recipe" WHERE "recipeKey"=$1', [recipeKey]); for (const row of rows.rows) { await pool.query('DELETE FROM "RecipeCookTest" WHERE "recipeVersionId" IN (SELECT id FROM "RecipeVersion" WHERE "recipeId"=$1)', [row.id]); await pool.query('DELETE FROM "RecipeEditorialReview" WHERE "recipeVersionId" IN (SELECT id FROM "RecipeVersion" WHERE "recipeId"=$1)', [row.id]); await pool.query('DELETE FROM "RecipeVersion" WHERE "recipeId"=$1', [row.id]); await pool.query('DELETE FROM "Recipe" WHERE id=$1', [row.id]); } } await pool.end(); });
  it('persists editorial/cook evidence and enforces cooked PASS', async () => {
    const recipeId = randomUUID(); const versionId = randomUUID(); recipeKey = `authoring_${randomUUID()}`;
    await pool.query(`INSERT INTO "Recipe" (id,name,servings,"recipeKey","dataClass") VALUES ($1,'Test authoring',1,$2,'TEST_ONLY')`, [recipeId, recipeKey]);
    await pool.query(`INSERT INTO "RecipeVersion" (id,"recipeId","versionNumber",status,"contentSnapshotJson","ingredientsSnapshotJson","stepsSnapshotJson","nutritionSnapshotJson","restrictionSnapshotJson","changeType",checksum) VALUES ($1,$2,1,'DRAFT','{}','[]','[]','{}','{}','FIXTURE',$3)`, [versionId, recipeId, randomUUID()]);
    await expect(pool.query(`INSERT INTO "RecipeCookTest" ("recipeVersionId","reviewerId","testedAt","actuallyCooked","actualCookingTimeMinutes","actualYieldGrams","ingredientMeasurability","stepExecutability","equipmentSufficiency","textureResult","tasteResult","decision") VALUES ($1,$2,now(),false,10,100,true,true,true,'ok','ok','PASS')`, [versionId, randomUUID()])).rejects.toThrow();
    await pool.query(`INSERT INTO "RecipeCookTest" ("recipeVersionId","reviewerId","testedAt","actuallyCooked","actualCookingTimeMinutes","actualYieldGrams","ingredientMeasurability","stepExecutability","equipmentSufficiency","textureResult","tasteResult","decision") VALUES ($1,$2,now(),true,10,100,true,true,true,'ok','ok','PASS')`, [versionId, randomUUID()]);
    const review = await pool.query(`INSERT INTO "RecipeEditorialReview" ("recipeVersionId","reviewerId","reviewedAt",decision) VALUES ($1,$2,now(),'PASS') RETURNING decision`, [versionId, randomUUID()]); expect(review.rows[0].decision).toBe('PASS');
    const counts = await pool.query(`SELECT (SELECT count(*) FROM "RecipeEditorialReview" WHERE "recipeVersionId"=$1)::int AS reviews,(SELECT count(*) FROM "RecipeCookTest" WHERE "recipeVersionId"=$1)::int AS cooks`, [versionId]); expect(counts.rows[0]).toEqual({ reviews: 1, cooks: 1 });
    await expect(pool.query(`UPDATE "RecipeVersion" SET checksum='changed' WHERE id=$1 AND status='PUBLISHED'`, [versionId])).resolves.toBeDefined();
  });
});
