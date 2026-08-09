import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeFingerprintService } from '../../src/modules/recipe-platform/application/recipe-fingerprint.service';
import { RecipeMediaService } from '../../src/modules/recipe-platform/application/recipe-media.service';
import { RECIPE_FINGERPRINT_SCHEMA_V1 } from '../../src/modules/recipe-platform/domain/recipe-fingerprint.policy';

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

async function insertVersion(input: {
  recipeId: string;
  versionNumber: number;
  title: string;
  servings: number;
  productId: string;
  amount: number;
  checksum: string;
  form?: string | null;
}) {
  const snap = JSON.stringify([
    {
      productId: input.productId,
      canonicalProductId: input.productId,
      displayName: 'P',
      amount: input.amount,
      unit: 'g',
      ordering: 1,
    },
  ]);
  const row = await pool.query<{ id: string; checksum: string }>(
    `INSERT INTO "RecipeVersion" (
       "recipeId", "versionNumber", status,
       "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
       "nutritionSnapshotJson", "restrictionSnapshotJson",
       servings, "changeType", "publishedAt", checksum, provenance
     ) VALUES (
       $1,$2,'PUBLISHED',
       $3::jsonb,$4::jsonb,
       '[{"stepIndex":0,"instruction":"Cook","durationMinutes":10,"temperatureC":null,"equipment":"pan"}]'::jsonb,
       '{"calories":100,"proteinG":10,"fatG":1,"carbsG":5,"basis":"x","source":"t"}'::jsonb,
       '{}'::jsonb, $5, 'MANUAL_PUBLISH', now(), $6, 'OWNER_PUBLISH'
     ) RETURNING id, checksum`,
    [
      input.recipeId,
      input.versionNumber,
      JSON.stringify({ title: input.title }),
      snap,
      input.servings,
      input.checksum,
    ],
  );
  return row.rows[0]!;
}

describe('RP2-02C fingerprint + media persistence', () => {
  const db = createDb();
  const fingerprints = new RecipeFingerprintService(db);
  const media = new RecipeMediaService(db);

  let actorId = '';
  let productA = '';
  let productB = '';
  let recipe1 = '';
  let recipe2 = '';
  let version1 = '';
  let version2Exact = '';
  let version2Variant = '';
  let checksum1 = '';

  beforeAll(async () => {
    await applyMigration('187_recipe-fingerprint');
    await applyMigration('188_recipe-duplicate-candidate');
    await applyMigration('189_media-asset-recipe-version-media');
    await applyMigration('190_fingerprint-media-backfill-marker');

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;

    const p1 = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", form)
       VALUES (gen_random_uuid(), $1, 'g', 100, 10, 1, 5, 'RAW') RETURNING id`,
      [`rp202c_a_${Date.now()}`],
    );
    productA = p1.rows[0]!.id;
    const p2 = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", form)
       VALUES (gen_random_uuid(), $1, 'g', 120, 12, 2, 6, 'RAW') RETURNING id`,
      [`rp202c_b_${Date.now()}`],
    );
    productB = p2.rows[0]!.id;

    const r1 = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 2, $2, 'TEST_ONLY') RETURNING id`,
      [`RP202C Exact ${Date.now()}`, `rp202c_r1_${Date.now()}`],
    );
    recipe1 = r1.rows[0]!.id;
    const r2 = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 2, $2, 'TEST_ONLY') RETURNING id`,
      [`RP202C Clone ${Date.now()}`, `rp202c_r2_${Date.now()}`],
    );
    recipe2 = r2.rows[0]!.id;

    const v1 = await insertVersion({
      recipeId: recipe1,
      versionNumber: 1,
      title: 'Курица с гречкой!',
      servings: 2,
      productId: productA,
      amount: 200,
      checksum: `rp202c_v1_${Date.now()}`,
    });
    version1 = v1.id;
    checksum1 = v1.checksum;

    const vExact = await insertVersion({
      recipeId: recipe2,
      versionNumber: 1,
      title: 'курица, с гречкой',
      servings: 4,
      productId: productA,
      amount: 400,
      checksum: `rp202c_vexact_${Date.now()}`,
    });
    version2Exact = vExact.id;

    const vVar = await insertVersion({
      recipeId: recipe2,
      versionNumber: 2,
      title: 'курица с рисом',
      servings: 2,
      productId: productB,
      amount: 200,
      checksum: `rp202c_vvar_${Date.now()}`,
    });
    version2Variant = vVar.id;
  }, 120000);

  afterAll(async () => {
    await pool.end();
  });

  it('1-4: fingerprint deterministic; ingredient change alters hash; checksum of RecipeVersion unchanged', async () => {
    const a = await fingerprints.ensureFingerprint(version1);
    const b = await fingerprints.ensureFingerprint(version1);
    expect(a.exactContentHash).toBe(b.exactContentHash);
    expect(a.fingerprintSchemaVersion).toBe(RECIPE_FINGERPRINT_SCHEMA_V1);

    const scaled = await fingerprints.ensureFingerprint(version2Exact);
    expect(scaled.ingredientQuantityHash).toBe(a.ingredientQuantityHash);

    const variant = await fingerprints.ensureFingerprint(version2Variant);
    expect(variant.ingredientSetHash).not.toBe(a.ingredientSetHash);

    const checksum = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM "RecipeVersion" WHERE id = $1`,
      [version1],
    );
    expect(checksum.rows[0]!.checksum).toBe(checksum1);
  });

  it(
    '5-9: same Recipe history excluded; exact candidate; pair uniqueness',
    async () => {
    await fingerprints.scanCandidates({ limitPerVersion: 50 });
    const sameRecipeVersion = await insertVersion({
      recipeId: recipe1,
      versionNumber: 2,
      title: 'Курица с гречкой!',
      servings: 2,
      productId: productA,
      amount: 200,
      checksum: `rp202c_hist_${Date.now()}`,
    });
    await fingerprints.ensureFingerprint(sameRecipeVersion.id);
    await fingerprints.scanCandidates({ limitPerVersion: 50 });

    const histPairs = await pool.query(
      `SELECT * FROM "RecipeDuplicateCandidate"
       WHERE ("leftRecipeVersionId" = $1 AND "rightRecipeVersionId" = $2)
          OR ("leftRecipeVersionId" = $2 AND "rightRecipeVersionId" = $1)`,
      [version1, sameRecipeVersion.id],
    );
    expect(histPairs.rows.length).toBe(0);

    const exact = await pool.query(
      `SELECT * FROM "RecipeDuplicateCandidate"
       WHERE classification = 'EXACT_DUPLICATE'
         AND (
           ("leftRecipeVersionId" = $1 AND "rightRecipeVersionId" = $2)
           OR ("leftRecipeVersionId" = $2 AND "rightRecipeVersionId" = $1)
         )`,
      [version1, version2Exact],
    );
    expect(exact.rows.length).toBe(1);

    await expect(
      pool.query(
        `INSERT INTO "RecipeDuplicateCandidate" (
           "leftRecipeVersionId", "rightRecipeVersionId", "fingerprintSchemaVersion",
           classification, score, "reasonsJson", status, "pairKey"
         ) VALUES ($1,$2,$3,'EXACT_DUPLICATE',0.99,'[]'::jsonb,'OPEN',$4)`,
        [
          exact.rows[0]!.leftRecipeVersionId,
          exact.rows[0]!.rightRecipeVersionId,
          RECIPE_FINGERPRINT_SCHEMA_V1,
          exact.rows[0]!.pairKey,
        ],
      ),
    ).rejects.toThrow();
  },
    60_000,
  );

  it(
    '10-11: publication exact duplicate blocked; OWNER override audited path exists',
    async () => {
    // Ensure OPEN exact candidate exists even if prior suite runs mutated status.
    await fingerprints.ensureFingerprint(version1);
    await fingerprints.ensureFingerprint(version2Exact);
    await fingerprints.scanCandidates({ limitPerVersion: 50 });
    await pool.query(
      `UPDATE "RecipeDuplicateCandidate"
       SET status = 'OPEN'
       WHERE classification = 'EXACT_DUPLICATE'
         AND (
           ("leftRecipeVersionId" = $1 AND "rightRecipeVersionId" = $2)
           OR ("leftRecipeVersionId" = $2 AND "rightRecipeVersionId" = $1)
         )`,
      [version1, version2Exact],
    );

    await expect(
      fingerprints.evaluatePublicationGate({
        recipeId: recipe2,
        versionId: version2Exact,
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/DUPLICATE_RECIPE_CONFLICT/);

    const ok = await fingerprints.evaluatePublicationGate({
      recipeId: recipe2,
      versionId: version2Exact,
      actorUserId: actorId,
      actorRole: 'OWNER',
      overrideExactDuplicate: true,
      overrideReason: 'OWNER_QA_OVERRIDE',
    });
    expect(ok.allowed).toBe(true);
  },
    60_000,
  );

  it('12-18: media asset, link, HERO uniqueness, rights gate, takedown', async () => {
    const asset = await media.registerMetadata({
      actorUserId: actorId,
      actorRole: 'OWNER',
      sourceType: 'OWNED_UPLOAD',
      licenseType: 'ALL_RIGHTS_OWNED',
      mimeType: 'image/jpeg',
      originalFilename: 'hero.jpg',
      attributionText: 'Owner',
    });
    expect(asset.rightsStatus).toBe('PENDING_REVIEW');

    await media.linkToVersion({
      recipeId: recipe1,
      versionId: version1,
      mediaAssetId: asset.id,
      role: 'HERO',
      altText: 'Hero dish',
      actorUserId: actorId,
      actorRole: 'OWNER',
    });

    await expect(
      media.linkToVersion({
        recipeId: recipe1,
        versionId: version1,
        mediaAssetId: asset.id,
        role: 'HERO',
        altText: 'Second hero',
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow();

    await expect(media.assertPublicationMediaGate(version1)).rejects.toThrow(/MEDIA_PUBLICATION_BLOCKED/);

    await media.patchRights({
      mediaId: asset.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      rightsStatus: 'APPROVED',
      licenseType: 'ALL_RIGHTS_OWNED',
      attributionText: 'Owner',
    });
    await media.patchModeration({
      mediaId: asset.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      moderationStatus: 'APPROVED',
    });
    await expect(media.assertPublicationMediaGate(version1)).resolves.toMatchObject({ allowed: true });

    await media.takedown({
      mediaId: asset.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reason: 'LEGAL_TAKEDOWN',
    });
    const userVisible = await media.listUserVisibleForVersion(version1);
    expect(userVisible[0]?.placeholder).toBe(true);
    expect(userVisible[0]?.url).toBeNull();

    const checksum = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM "RecipeVersion" WHERE id = $1`,
      [version1],
    );
    expect(checksum.rows[0]!.checksum).toBe(checksum1);
  });

  it('19-23: OWNER resolution preserved; unauthorized rejected; backfill marker present', async () => {
    const open = await pool.query<{ id: string }>(
      `SELECT id FROM "RecipeDuplicateCandidate" WHERE status = 'OPEN' LIMIT 1`,
    );
    if (open.rows[0]) {
      await fingerprints.resolveCandidate({
        candidateId: open.rows[0].id,
        actorUserId: actorId,
        actorRole: 'OWNER',
        resolutionCode: 'DISMISSED',
        resolutionNote: 'false positive',
      });
      await fingerprints.scanCandidates({ limitPerVersion: 20 });
      const preserved = await pool.query<{ status: string }>(
        `SELECT status FROM "RecipeDuplicateCandidate" WHERE id = $1`,
        [open.rows[0].id],
      );
      expect(preserved.rows[0]!.status).toBe('DISMISSED');
    }

    await expect(
      media.takedown({
        mediaId: '00000000-0000-4000-8000-000000000099',
        actorUserId: actorId,
        actorRole: 'USER',
        reason: 'x',
      }),
    ).rejects.toThrow(/OWNER_ACCESS_FORBIDDEN/);

    const marker = await pool.query(
      `SELECT id FROM "RecipePlatformBackfillMarker" WHERE id = 'RP2_02C_MEDIA_SCAN_V1'`,
    );
    expect(marker.rows.length).toBe(1);

    // repeated migration no-op
    await applyMigration('187_recipe-fingerprint');
    await applyMigration('190_fingerprint-media-backfill-marker');
  }, 60_000);
});
