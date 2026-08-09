import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeExternalSourceService } from '../../src/modules/recipe-platform/application/recipe-external-source.service';
import { RecipeResearchService } from '../../src/modules/recipe-platform/application/recipe-research.service';
import { RecipeSourceAdapterRegistry } from '../../src/modules/recipe-platform/application/recipe-source-adapter.registry';
import { RecipeSourceAdapterError } from '../../src/modules/recipe-platform/domain/recipe-source-adapter.contract';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(_k1: number, _k2: string, fn: () => Promise<unknown>) {
      return { acquired: true, result: await fn() };
    },
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

async function prepareFixtureSource(
  sources: RecipeExternalSourceService,
  actorId: string,
  input: { code: string; name: string; baseUrl: string; adapterType: string },
) {
  const created = await sources.createSource({
    actorUserId: actorId,
    actorRole: 'OWNER',
    code: input.code,
    name: input.name,
    baseUrl: input.baseUrl,
    adapterType: input.adapterType,
    collectionMode: 'DISABLED',
    dataClass: 'TEST_ONLY',
    rateLimitPerMinute: 10,
  });
  await sources.addEvidence({
    sourceId: created.id,
    actorUserId: actorId,
    actorRole: 'OWNER',
    evidenceType: 'OWNER_DECISION',
    decision: 'ALLOW',
    notes: 'fixture allow',
  });
  await sources.addEvidence({
    sourceId: created.id,
    actorUserId: actorId,
    actorRole: 'OWNER',
    evidenceType: 'TERMS_REVIEW',
    decision: 'ALLOW',
    notes: 'fixture terms',
  });
  await sources.reviewSource({
    sourceId: created.id,
    actorUserId: actorId,
    actorRole: 'OWNER',
    toStatus: 'PUBLIC_RESEARCH_ALLOWED',
    reason: 'fixture research',
    collectionMode: 'CONTROLLED_HTML_RESEARCH',
    reviewExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  return created.id;
}

describe('STEP_215C multi-source fixture research persistence', () => {
  const db = createDb();
  const adapters = new RecipeSourceAdapterRegistry();
  const sources = new RecipeExternalSourceService(db, adapters);
  const research = new RecipeResearchService(db, sources);
  let actorId = '';
  const suffix = Date.now().toString(36);
  let recipeBefore = 0;
  let productBefore = 0;
  let aliasBefore = 0;
  const sourceIds: string[] = [];

  beforeAll(async () => {
    await applyMigration('201_recipe-external-source-registry');
    await applyMigration('202_recipe-research-staging');
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
    recipeBefore = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Recipe"`)).rows[0]?.c ?? 0,
    );
    productBefore = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Product"`)).rows[0]?.c ?? 0,
    );
    aliasBefore = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "ProductAlias"`)).rows[0]?.c ??
        0,
    );

    sourceIds.push(
      await prepareFixtureSource(sources, actorId, {
        code: `food_ru_ms_${suffix}`,
        name: 'Food.ru multi',
        baseUrl: 'https://food.ru',
        adapterType: 'FOOD_RU',
      }),
      await prepareFixtureSource(sources, actorId, {
        code: `iamcook_ms_${suffix}`,
        name: 'IamCook multi',
        baseUrl: 'https://www.iamcook.ru',
        adapterType: 'IAMCOOK',
      }),
      await prepareFixtureSource(sources, actorId, {
        code: `russianfood_ms_${suffix}`,
        name: 'RussianFood multi',
        baseUrl: 'https://www.russianfood.com',
        adapterType: 'RUSSIANFOOD',
      }),
    );
  }, 120_000);

  afterAll(async () => {
    for (const id of sourceIds) {
      await pool.query(`DELETE FROM "RecipeCandidateReviewItem" WHERE "candidateId" IN (
        SELECT id FROM "RecipeSourceCandidate" WHERE "sourceId" = $1)`, [id]);
      await pool.query(`DELETE FROM "RecipeNormalizedCandidate" WHERE "candidateId" IN (
        SELECT id FROM "RecipeSourceCandidate" WHERE "sourceId" = $1)`, [id]);
      await pool.query(`DELETE FROM "RecipeSourceCandidate" WHERE "sourceId" = $1`, [id]);
      await pool.query(`DELETE FROM "RecipeSourceRawSnapshot" WHERE "sourceId" = $1`, [id]);
      await pool.query(
        `DELETE FROM "RecipeResearchRequest" WHERE id IN (
          SELECT "requestId" FROM "RecipeResearchRun" WHERE "sourceId" = $1)`,
        [id],
      );
      await pool.query(`DELETE FROM "RecipeResearchRun" WHERE "sourceId" = $1`, [id]);
      await pool.query(`DELETE FROM "RecipeSourcePolicyEvidence" WHERE "sourceId" = $1`, [id]);
      await pool.query(`DELETE FROM "RecipeExternalSource" WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('three sources persist distinct candidates; live blocked; catalogs unchanged', async () => {
    const seeded = await pool.query<{ code: string; adapterType: string; enabled: boolean }>(
      `SELECT code, "adapterType", enabled FROM "RecipeExternalSource"
       WHERE code IN ('food_ru','iamcook','russianfood') ORDER BY code`,
    );
    expect(seeded.rows.every((r) => r.adapterType === 'NOT_CONFIGURED')).toBe(true);
    expect(seeded.rows.every((r) => r.enabled === false)).toBe(true);

    const candidates = [];
    const requestIds: string[] = [];
    for (const sourceId of sourceIds) {
      const request = await research.createRequest({
        reason: `STEP_215C multi-source parity ${sourceId.slice(0, 8)}`,
        idempotencyKey: `ms-req-${sourceId.slice(0, 8)}-${suffix}`,
        actorUserId: actorId,
        actorRole: 'OWNER',
        manual: true,
      });
      requestIds.push(request.id);
      const run = await research.runRequest({
        requestId: request.id,
        sourceId,
        externalId: 'parity-chicken-buckwheat-salad',
        operation: 'FETCH_CANDIDATE',
        actorUserId: actorId,
        actorRole: 'OWNER',
        idempotencyKey: `ms-run-${sourceId}-${suffix}`,
      });
      expect(run.candidate?.id).toBeTruthy();
      candidates.push(run.candidate.id);
      await research.normalizeCandidate({
        candidateId: run.candidate.id,
        actorUserId: actorId,
        actorRole: 'OWNER',
      });
    }

    expect(new Set(candidates).size).toBe(3);

    const rows = await pool.query<{ sourceId: string; externalId: string; parserVersion: string }>(
      `SELECT "sourceId", "externalId", "parserVersion" FROM "RecipeSourceCandidate"
       WHERE id = ANY($1::uuid[])`,
      [candidates],
    );
    expect(rows.rows).toHaveLength(3);
    expect(new Set(rows.rows.map((r) => r.sourceId)).size).toBe(3);
    expect(rows.rows.every((r) => r.externalId === 'parity-chicken-buckwheat-salad')).toBe(true);

    // same-source duplicate: reopen request status and re-fetch same externalId
    await pool.query(
      `UPDATE "RecipeResearchRequest" SET status = 'READY', "updatedAt" = now() WHERE id = $1`,
      [requestIds[0]],
    );
    const dup = await research.runRequest({
      requestId: requestIds[0]!,
      sourceId: sourceIds[0],
      externalId: 'parity-chicken-buckwheat-salad',
      operation: 'FETCH_CANDIDATE',
      actorUserId: actorId,
      actorRole: 'OWNER',
      idempotencyKey: `ms-dup-${suffix}`,
    });
    expect(dup.candidate.id).toBe(candidates[0]);

    // cross-source: three candidates with same externalId remain distinct
    const sameExternal = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "RecipeSourceCandidate"
       WHERE "externalId" = 'parity-chicken-buckwheat-salad'
         AND "sourceId" = ANY($1::uuid[])`,
      [sourceIds],
    );
    expect(Number(sameExternal.rows[0]?.c)).toBe(3);

    for (const sourceId of sourceIds) {
      await expect(
        sources.runLiveBlockedProbe({
          sourceId,
          actorUserId: actorId,
          actorRole: 'OWNER',
        }),
      ).resolves.toMatchObject({ blocked: true, networkCalls: 0 });
    }

    const recipeAfter = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Recipe"`)).rows[0]?.c ?? 0,
    );
    const productAfter = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Product"`)).rows[0]?.c ?? 0,
    );
    const aliasAfter = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "ProductAlias"`)).rows[0]?.c ??
        0,
    );
    expect(recipeAfter).toBe(recipeBefore);
    expect(productAfter).toBe(productBefore);
    expect(aliasAfter).toBe(aliasBefore);
  });

  it('rejects live before socket via adapter', async () => {
    const adapter = adapters.getOrThrow('IAMCOOK');
    await expect(
      adapter.fetchCandidate('synthetic-chicken-buckwheat', {
        sourceId: sourceIds[1]!,
        sourceCode: 'iamcook',
        adapterType: 'IAMCOOK',
        parserVersion: 'iamcook/v1',
        collectionMode: 'CONTROLLED_HTML_RESEARCH',
        correlationId: 'live-block',
        actorUserId: actorId,
        allowlistedHostnames: ['www.iamcook.ru'],
        requestTimeoutMs: 5000,
        rateLimitPerMinute: 10,
        testMode: false,
      }),
    ).rejects.toBeInstanceOf(RecipeSourceAdapterError);
  });
});
