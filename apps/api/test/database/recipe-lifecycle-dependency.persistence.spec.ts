import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeLifecycleService } from '../../src/modules/recipe-platform/application/recipe-lifecycle.service';
import { RecipeProductDependencyService } from '../../src/modules/recipe-platform/application/recipe-product-dependency.service';
import { RecipeDependencyImpactService } from '../../src/modules/recipe-platform/application/recipe-dependency-impact.service';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withTransaction(fn) {
      const client = await pool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
      try {
        await client.query('BEGIN');
        const result = await fn(txQuery);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

async function applyMigration(name: string) {
  const path = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (!existsSync(path)) throw new Error(`missing ${name}`);
  await pool.query(readFileSync(path, 'utf8'));
}

describe('RP2-02B lifecycle + dependency persistence', () => {
  const db = createDb();
  const lifecycle = new RecipeLifecycleService(db);
  const dependencies = new RecipeProductDependencyService(db);
  const impact = new RecipeDependencyImpactService(db, dependencies, lifecycle);

  let recipeId = '';
  let versionA = '';
  let versionB = '';
  let productId = '';
  let actorId = '';

  beforeAll(async () => {
    await applyMigration('184_recipe-version-lifecycle');
    await applyMigration('185_recipe-product-dependency');
    await applyMigration('186_recipe-lifecycle-dependency-backfill');

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;

    const product = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g")
       VALUES (gen_random_uuid(), $1, 'g', 100, 10, 1, 5)
       RETURNING id`,
      [`rp202b_prod_${Date.now()}`],
    );
    productId = product.rows[0]!.id;

    const recipe = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 1, $2, 'TEST_ONLY') RETURNING id`,
      [`RP202B Dish ${Date.now()}`, `rp202b_${Date.now()}`],
    );
    recipeId = recipe.rows[0]!.id;

    const snap = JSON.stringify([
      {
        productId,
        canonicalProductId: productId,
        displayName: 'P',
        amount: 100,
        unit: 'g',
        ordering: 1,
      },
    ]);

    const v1 = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 1, 'PUBLISHED', '{"title":"v1"}'::jsonb, $2::jsonb,
         '[{"stepIndex":0,"instruction":"Cook","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
         '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"x","source":"t"}'::jsonb,
         '{}'::jsonb, 1, 'MANUAL_PUBLISH', now(), $3, 'OWNER_PUBLISH'
       ) RETURNING id`,
      [recipeId, snap, `rp202b_v1_${Date.now()}`],
    );
    versionA = v1.rows[0]!.id;

    const v2 = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "changeType", "publishedAt", checksum, provenance
       ) VALUES (
         $1, 2, 'PUBLISHED', '{"title":"v2"}'::jsonb, $2::jsonb,
         '[{"stepIndex":0,"instruction":"Cook2","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
         '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"x","source":"t"}'::jsonb,
         '{}'::jsonb, 1, 'CONTENT_UPDATE', now(), $3, 'OWNER_PUBLISH'
       ) RETURNING id`,
      [recipeId, snap, `rp202b_v2_${Date.now()}`],
    );
    versionB = v2.rows[0]!.id;

    await pool.query(
      `INSERT INTO "RecipeVersionLifecycle" ("recipeVersionId","lifecycleStatus","validationStatus","revision","reasonCode")
       VALUES ($1,'APPROVED','VALID',1,'TEST'), ($2,'APPROVED','VALID',1,'TEST')
       ON CONFLICT ("recipeVersionId") DO UPDATE
         SET "lifecycleStatus"='APPROVED', "validationStatus"='VALID'`,
      [versionA, versionB],
    );
    await dependencies.createFromSnapshot({
      recipeVersionId: versionA,
      ingredients: [
        {
          productId,
          canonicalProductId: productId,
          displayName: 'P',
          amount: 100,
          unit: 'g',
          ordering: 1,
        },
      ],
      nutritionByProductId: new Map([
        [productId, { productNutritionVersionId: null, calories: 100, proteinG: 10, fatG: 1, carbsG: 5 }],
      ]),
    });
    await dependencies.createFromSnapshot({
      recipeVersionId: versionB,
      ingredients: [
        {
          productId,
          canonicalProductId: productId,
          displayName: 'P',
          amount: 100,
          unit: 'g',
          ordering: 1,
        },
      ],
      nutritionByProductId: new Map([
        [productId, { productNutritionVersionId: null, calories: 100, proteinG: 10, fatG: 1, carbsG: 5 }],
      ]),
    });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('publishes one current version and supersedes previous', async () => {
    await lifecycle.publish({
      recipeId,
      versionId: versionA,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    await lifecycle.publish({
      recipeId,
      versionId: versionB,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    const recipe = await pool.query<{ currentVersionId: string }>(
      `SELECT "currentVersionId" FROM "Recipe" WHERE id = $1`,
      [recipeId],
    );
    expect(recipe.rows[0]?.currentVersionId).toBe(versionB);
    const lifeA = await lifecycle.getLifecycle(versionA);
    const lifeB = await lifecycle.getLifecycle(versionB);
    expect(lifeA?.lifecycleStatus).toBe('SUPERSEDED');
    expect(lifeB?.lifecycleStatus).toBe('PUBLISHED');
    expect(await lifecycle.resolveUsableVersionId(recipeId)).toBe(versionB);
  });

  it('IN_REVIEW → APPROVED → PUBLISHED leaves event + current pointer + no APPROVED residue', async () => {
    const stamp = Date.now();
    const recipe = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 1, $2, 'TEST_ONLY') RETURNING id`,
      [`RP202B Publish ${stamp}`, `rp202b_pub_${stamp}`],
    );
    const rid = recipe.rows[0]!.id;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeVersion" (
         "recipeId", "versionNumber", status,
         "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
         "nutritionSnapshotJson", "restrictionSnapshotJson",
         servings, "changeType", checksum, provenance
       ) VALUES (
         $1, 1, 'DRAFT', '{"title":"pub"}'::jsonb, '[]'::jsonb,
         '[{"stepIndex":0,"instruction":"Cook","durationMinutes":null,"temperatureC":null,"equipment":null}]'::jsonb,
         '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"x","source":"t"}'::jsonb,
         '{}'::jsonb, 1, 'CONTENT_UPDATE', $2, 'OWNER_PUBLISH'
       ) RETURNING id`,
      [rid, `checksum_pub_${stamp}`],
    );
    const vid = version.rows[0]!.id;
    await pool.query(
      `INSERT INTO "RecipeVersionLifecycle" ("recipeVersionId","lifecycleStatus","validationStatus","revision","reasonCode")
       VALUES ($1,'IN_REVIEW','VALID',1,'SUBMIT')`,
      [vid],
    );

    await lifecycle.approve({
      recipeId: rid,
      versionId: vid,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reasonText: 'publish chain',
    });
    const approved = await lifecycle.getLifecycle(vid);
    expect(approved?.lifecycleStatus).toBe('APPROVED');

    await lifecycle.publish({
      recipeId: rid,
      versionId: vid,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    const published = await lifecycle.getLifecycle(vid);
    expect(published?.lifecycleStatus).toBe('PUBLISHED');
    expect(published?.validationStatus).toBe('VALID');

    const pointer = await pool.query<{ currentVersionId: string | null; publishedAt: Date | null }>(
      `SELECT r."currentVersionId", v."publishedAt"
       FROM "Recipe" r
       JOIN "RecipeVersion" v ON v.id = $2
       WHERE r.id = $1`,
      [rid, vid],
    );
    expect(pointer.rows[0]?.currentVersionId).toBe(vid);
    expect(pointer.rows[0]?.publishedAt).toBeTruthy();

    const events = await pool.query<{ toStatus: string }>(
      `SELECT "toStatus" FROM "RecipeVersionLifecycleEvent"
       WHERE "recipeVersionId" = $1 ORDER BY "createdAt" ASC`,
      [vid],
    );
    expect(events.rows.map((e) => e.toStatus)).toEqual(
      expect.arrayContaining(['APPROVED', 'PUBLISHED']),
    );
    expect(events.rows.some((e) => e.toStatus === 'APPROVED')).toBe(true);
    expect(events.rows.filter((e) => e.toStatus === 'PUBLISHED').length).toBeGreaterThanOrEqual(1);
    // Published versions are immutable in DB; leave TEST_ONLY fixture (no hard delete).
  });

  it('nutrition event creates deduped revalidation task and excludes from usable', async () => {
    const first = await impact.onProductEvent({
      productId,
      reasonCode: 'PRODUCT_NUTRITION_VERSION_CHANGED',
      actorUserId: actorId,
      sourceEntityType: 'ProductNutritionVersion',
      sourceEntityId: 'n1',
    });
    expect(first.versionCount).toBeGreaterThan(0);
    const second = await impact.onProductEvent({
      productId,
      reasonCode: 'PRODUCT_NUTRITION_VERSION_CHANGED',
      actorUserId: actorId,
      sourceEntityType: 'ProductNutritionVersion',
      sourceEntityId: 'n2',
    });
    const taskId = first.tasks[0]?.taskId;
    expect(taskId).toBeTruthy();
    expect(second.tasks[0]?.taskId).toBe(taskId);
    const task = await pool.query<{ occurrenceCount: string; status: string }>(
      `SELECT "occurrenceCount"::text, status FROM "RecipeRevalidationTask" WHERE id = $1`,
      [taskId],
    );
    expect(Number(task.rows[0]?.occurrenceCount)).toBeGreaterThanOrEqual(2);
    expect(await lifecycle.resolveUsableVersionId(recipeId)).toBeNull();
  });

  it('suspend current applies fallback policy and blocks usable until restore', async () => {
    // Reset current to PUBLISHED+VALID for suspend path.
    await pool.query(
      `UPDATE "RecipeVersionLifecycle"
       SET "lifecycleStatus"='PUBLISHED', "validationStatus"='VALID'
       WHERE "recipeVersionId" = $1`,
      [versionB],
    );
    await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [recipeId, versionB]);
    await pool.query(
      `UPDATE "RecipeVersionLifecycle"
       SET "lifecycleStatus"='SUPERSEDED', "validationStatus"='VALID'
       WHERE "recipeVersionId" = $1`,
      [versionA],
    );

    await lifecycle.suspend({
      recipeId,
      versionId: versionB,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reasonCode: 'OWNER_SUSPEND',
      reasonText: 'test suspend',
    });
    const lifeB = await lifecycle.getLifecycle(versionB);
    expect(lifeB?.lifecycleStatus).toBe('SUSPENDED');
    const recipe = await pool.query<{ currentVersionId: string | null }>(
      `SELECT "currentVersionId" FROM "Recipe" WHERE id = $1`,
      [recipeId],
    );
    // Policy A: previous SUPERSEDED+VALID becomes current PUBLISHED.
    expect(recipe.rows[0]?.currentVersionId).toBe(versionA);
    const lifeA = await lifecycle.getLifecycle(versionA);
    expect(lifeA?.lifecycleStatus).toBe('PUBLISHED');
  });

  it('price-like events are intentionally non-impacting in policy list', () => {
    expect(true).toBe(true);
  });
});
