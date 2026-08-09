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

describe('STEP_215 Food.ru fixture research persistence', () => {
  const db = createDb();
  const adapters = new RecipeSourceAdapterRegistry();
  const sources = new RecipeExternalSourceService(db, adapters);
  const research = new RecipeResearchService(db, sources);
  let actorId = '';
  const suffix = Date.now().toString(36);
  let recipeBefore = 0;
  let productBefore = 0;
  let foodRuFixtureId = '';

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

    const created = await sources.createSource({
      actorUserId: actorId,
      actorRole: 'OWNER',
      code: `food_ru_fx_${suffix}`,
      name: 'Food.ru fixture',
      baseUrl: 'https://food.ru',
      adapterType: 'FOOD_RU',
      collectionMode: 'DISABLED',
      dataClass: 'TEST_ONLY',
      rateLimitPerMinute: 10,
    });
    foodRuFixtureId = created.id;
    await sources.addEvidence({
      sourceId: foodRuFixtureId,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'OWNER_DECISION',
      decision: 'ALLOW',
      notes: 'fixture allow',
    });
    await sources.addEvidence({
      sourceId: foodRuFixtureId,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'TERMS_REVIEW',
      decision: 'ALLOW',
      notes: 'fixture terms',
    });
    await sources.reviewSource({
      sourceId: foodRuFixtureId,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'PUBLIC_RESEARCH_ALLOWED',
      reason: 'fixture research',
      collectionMode: 'CONTROLLED_HTML_RESEARCH',
      reviewExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
  }, 90_000);

  afterAll(async () => {
    if (foodRuFixtureId) {
      await pool.query(`DELETE FROM "RecipeCandidateReviewItem" WHERE "candidateId" IN (
        SELECT id FROM "RecipeSourceCandidate" WHERE "sourceId" = $1)`, [foodRuFixtureId]);
      await pool.query(`DELETE FROM "RecipeNormalizedCandidate" WHERE "candidateId" IN (
        SELECT id FROM "RecipeSourceCandidate" WHERE "sourceId" = $1)`, [foodRuFixtureId]);
      await pool.query(`DELETE FROM "RecipeSourceCandidate" WHERE "sourceId" = $1`, [foodRuFixtureId]);
      await pool.query(`DELETE FROM "RecipeSourceRawSnapshot" WHERE "sourceId" = $1`, [foodRuFixtureId]);
      await pool.query(`DELETE FROM "RecipeResearchRun" WHERE "sourceId" = $1`, [foodRuFixtureId]);
      await pool.query(`DELETE FROM "RecipeSourcePolicyEvidence" WHERE "sourceId" = $1`, [
        foodRuFixtureId,
      ]);
      await pool.query(`DELETE FROM "RecipeExternalSource" WHERE id = $1`, [foodRuFixtureId]);
    }
    await pool.end();
  });

  it('fixture fetch persists run/candidate/snapshot with networkCalls=0; live blocked; catalogs unchanged', async () => {
    const seeded = await pool.query<{ code: string; adapterType: string; enabled: boolean }>(
      `SELECT code, "adapterType", enabled FROM "RecipeExternalSource"
       WHERE code IN ('food_ru','iamcook','russianfood') ORDER BY code`,
    );
    expect(seeded.rows.find((r) => r.code === 'food_ru')?.adapterType).toBe('NOT_CONFIGURED');
    expect(seeded.rows.find((r) => r.code === 'iamcook')?.adapterType).toBe('NOT_CONFIGURED');
    expect(seeded.rows.find((r) => r.code === 'russianfood')?.adapterType).toBe('NOT_CONFIGURED');
    expect(seeded.rows.every((r) => r.enabled === false)).toBe(true);

    const health = await sources.configurationHealthCheck({
      sourceId: foodRuFixtureId,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(health.networkCalls).toBe(0);
    expect(health.ok).toBe(true);

    const search = await sources.runTestSearch({
      sourceId: foodRuFixtureId,
      actorUserId: actorId,
      actorRole: 'OWNER',
      search: {
        primaryProductIds: ['synthetic'],
        locale: 'ru',
        resultLimit: 2,
        correlationId: `pg-foodru-search-${suffix}`,
      },
    });
    expect(search.networkCalls).toBe(0);
    expect(search.liveExecutionStatus).toBe('POLICY_BLOCKED');
    expect(search.cards.length).toBeGreaterThan(0);

    const live = await sources.runLiveBlockedProbe({
      sourceId: foodRuFixtureId,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(live.blocked).toBe(true);
    expect(live.networkCalls).toBe(0);

    const productionFoodRu = (
      await pool.query(`SELECT * FROM "RecipeExternalSource" WHERE code = 'food_ru'`)
    ).rows[0] as never;
    expect(() => sources.resolveFixtureExecutableAdapter(productionFoodRu, actorId)).toThrow(
      RecipeSourceAdapterError,
    );

    const request = await research.createRequest({
      manual: true,
      reason: 'STEP_215 Food.ru fixture',
      idempotencyKey: `step215-req-${suffix}`,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });

    const run = await research.runRequest({
      requestId: request.id,
      sourceId: foodRuFixtureId,
      externalId: 'synthetic-chicken-buckwheat',
      operation: 'FETCH_CANDIDATE',
      actorUserId: actorId,
      actorRole: 'OWNER',
      idempotencyKey: `step215-run-${suffix}`,
    });
    expect(run.candidate?.id).toBeTruthy();

    const normalized = await research.normalizeCandidate({
      candidateId: run.candidate.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(normalized).toBeTruthy();

    const recipeAfter = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Recipe"`)).rows[0]?.c ?? 0,
    );
    const productAfter = Number(
      (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Product"`)).rows[0]?.c ?? 0,
    );
    expect(recipeAfter).toBe(recipeBefore);
    expect(productAfter).toBe(productBefore);

    // cleanup request row
    await pool.query(`DELETE FROM "RecipeCandidateReviewItem" WHERE "candidateId" = $1`, [
      run.candidate.id,
    ]);
    await pool.query(`DELETE FROM "RecipeNormalizedCandidate" WHERE "candidateId" = $1`, [
      run.candidate.id,
    ]);
    await pool.query(`DELETE FROM "RecipeSourceCandidate" WHERE id = $1`, [run.candidate.id]);
    await pool.query(`DELETE FROM "RecipeSourceRawSnapshot" WHERE "runId" = $1`, [run.runId]);
    await pool.query(`DELETE FROM "RecipeResearchRun" WHERE id = $1`, [run.runId]);
    await pool.query(`DELETE FROM "RecipeResearchRequest" WHERE id = $1`, [request.id]);
  }, 90_000);
});
