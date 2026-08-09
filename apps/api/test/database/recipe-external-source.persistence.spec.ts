import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeExternalSourceService } from '../../src/modules/recipe-platform/application/recipe-external-source.service';
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

describe('RP2-04A recipe external source persistence', () => {
  const db = createDb();
  const adapters = new RecipeSourceAdapterRegistry();
  const sources = new RecipeExternalSourceService(db, adapters);
  let actorId = '';
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    await applyMigration('201_recipe-external-source-registry');
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it('1–3: create, reject duplicate code, persist evidence', async () => {
    const created = await sources.createSource({
      actorUserId: actorId,
      actorRole: 'OWNER',
      code: `manual_${suffix}`,
      name: 'Manual research source',
      baseUrl: 'https://example.com/recipes',
      adapterType: 'NOT_CONFIGURED',
      collectionMode: 'DISABLED',
      dataClass: 'PRODUCTION',
    });
    expect(created.rightsStatus).toBe('PENDING_REVIEW');
    expect(created.enabled).toBe(false);

    await expect(
      sources.createSource({
        actorUserId: actorId,
        actorRole: 'OWNER',
        code: `manual_${suffix}`,
        name: 'Dup',
        baseUrl: 'https://example.com',
      }),
    ).rejects.toThrow();

    const evidence = await sources.addEvidence({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'OWNER_DECISION',
      decision: 'ALLOW',
      notes: 'OWNER allow limited research',
    });
    expect(evidence.items.length).toBeGreaterThanOrEqual(1);

    const seeded = await pool.query<{ code: string; enabled: boolean; rightsStatus: string }>(
      `SELECT code, enabled, "rightsStatus" FROM "RecipeExternalSource"
       WHERE code IN ('food_ru','iamcook','russianfood') ORDER BY code`,
    );
    expect(seeded.rows).toHaveLength(3);
    expect(seeded.rows.every((r) => r.enabled === false && r.rightsStatus === 'PENDING_REVIEW')).toBe(
      true,
    );
  }, 60_000);

  it('4–6: PENDING cannot enable; approved can; expired review blocks execution', async () => {
    const created = await sources.createSource({
      actorUserId: actorId,
      actorRole: 'OWNER',
      code: `gate_${suffix}`,
      name: 'Gate source',
      baseUrl: 'https://example.com/gate',
      collectionMode: 'DISABLED',
    });

    await expect(
      sources.enableSource({
        sourceId: created.id,
        actorUserId: actorId,
        actorRole: 'OWNER',
        reason: 'try enable pending',
      }),
    ).rejects.toThrow(/RECIPE_SOURCE_ENABLE_BLOCKED/);

    await sources.addEvidence({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'OWNER_DECISION',
      decision: 'ALLOW',
      notes: 'allow',
    });
    await sources.addEvidence({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'TERMS_REVIEW',
      decision: 'ALLOW',
      notes: 'terms ok',
    });

    const reviewed = await sources.reviewSource({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'PUBLIC_RESEARCH_ALLOWED',
      reason: 'OWNER approved limited research',
      collectionMode: 'PUBLIC_FEED',
      reviewExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    expect(reviewed.rightsStatus).toBe('PUBLIC_RESEARCH_ALLOWED');

    const enabled = await sources.enableSource({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reason: 'enable after review',
    });
    expect(enabled.enabled).toBe(true);
    // NOT_CONFIGURED → execution still blocked
    expect(enabled.execution.automatedAllowed).toBe(false);

    await pool.query(
      `UPDATE "RecipeExternalSource" SET "reviewExpiresAt" = now() - interval '1 day' WHERE id = $1`,
      [created.id],
    );
    const expired = await sources.getSource(created.id);
    expect(expired.execution.reason).toBe('POLICY_REVIEW_EXPIRED');
  }, 60_000);

  it('7–10: suspension, disabled-by-terms, refusal, invalid restore', async () => {
    const created = await sources.createSource({
      actorUserId: actorId,
      actorRole: 'OWNER',
      code: `terms_${suffix}`,
      name: 'Terms source',
      baseUrl: 'https://example.com/terms',
    });
    await sources.addEvidence({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'OWNER_DECISION',
      decision: 'ALLOW',
      notes: 'x',
    });
    await sources.addEvidence({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'TERMS_REVIEW',
      decision: 'ALLOW',
      notes: 'x',
    });
    await sources.reviewSource({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'PUBLIC_RESEARCH_ALLOWED',
      reason: 'approve',
      collectionMode: 'PUBLIC_FEED',
    });
    await sources.enableSource({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reason: 'on',
    });

    const suspended = await sources.reviewSource({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'SUSPENDED',
      reason: 'temp hold',
      collectionMode: 'DISABLED',
    });
    expect(suspended.execution.eligibility).toBe('TEMPORARILY_SUSPENDED');
    expect(suspended.enabled).toBe(false);

    await sources.reviewSource({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'DISABLED_BY_TERMS',
      reason: 'ToS forbid crawl',
      collectionMode: 'DISABLED',
    });
    const terms = await sources.getSource(created.id);
    expect(terms.rightsStatus).toBe('DISABLED_BY_TERMS');

    await expect(
      sources.reviewSource({
        sourceId: created.id,
        actorUserId: actorId,
        actorRole: 'OWNER',
        toStatus: 'ACTIVE_LICENSED',
        reason: 'invalid restore',
      }),
    ).rejects.toThrow(/RECIPE_SOURCE_RIGHTS_TRANSITION_INVALID/);

    await sources.addEvidence({
      sourceId: created.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'REFUSAL',
      decision: 'DENY',
      notes: 'site refused',
    });
    // From DISABLED_BY_TERMS can go PENDING then refusal path separately — use another source for refusal
    const refusalSrc = await sources.createSource({
      actorUserId: actorId,
      actorRole: 'OWNER',
      code: `refuse_${suffix}`,
      name: 'Refuse source',
      baseUrl: 'https://example.com/refuse',
    });
    await sources.addEvidence({
      sourceId: refusalSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'OWNER_DECISION',
      decision: 'ALLOW',
      notes: 'x',
    });
    await sources.addEvidence({
      sourceId: refusalSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'REFUSAL',
      decision: 'DENY',
      notes: 'refused',
    });
    const refused = await sources.reviewSource({
      sourceId: refusalSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'DISABLED_BY_REFUSAL',
      reason: 'source refused automation',
      collectionMode: 'DISABLED',
    });
    expect(refused.rightsStatus).toBe('DISABLED_BY_REFUSAL');
  }, 60_000);

  it('11–14: test adapter isolation, health-check no network, resolve blocked, restart persistence', async () => {
    await expect(
      sources.createSource({
        actorUserId: actorId,
        actorRole: 'OWNER',
        code: `prod_test_${suffix}`,
        name: 'Bad bind',
        baseUrl: 'https://example.com/bad',
        adapterType: 'TEST_DETERMINISTIC',
        dataClass: 'PRODUCTION',
      }),
    ).rejects.toThrow(/TEST_ADAPTER_PRODUCTION_FORBIDDEN/);

    const testSrc = await sources.createSource({
      actorUserId: actorId,
      actorRole: 'OWNER',
      code: `test_only_${suffix}`,
      name: 'Test fixture source',
      baseUrl: 'https://example.com/test',
      adapterType: 'TEST_DETERMINISTIC',
      collectionMode: 'DISABLED',
      dataClass: 'TEST_ONLY',
      rateLimitPerMinute: 30,
    });

    const health = await sources.configurationHealthCheck({
      sourceId: testSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(health.networkCalls).toBe(0);
    expect(health.ok).toBe(true);

    await sources.addEvidence({
      sourceId: testSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'OWNER_DECISION',
      decision: 'ALLOW',
      notes: 'test',
    });
    await sources.addEvidence({
      sourceId: testSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      evidenceType: 'TERMS_REVIEW',
      decision: 'ALLOW',
      notes: 'test',
    });
    await sources.reviewSource({
      sourceId: testSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      toStatus: 'PUBLIC_RESEARCH_ALLOWED',
      reason: 'test allow',
      collectionMode: 'API',
      reviewExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await sources.enableSource({
      sourceId: testSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reason: 'enable test',
    });

    const row = await pool.query(
      `SELECT * FROM "RecipeExternalSource" WHERE id = $1`,
      [testSrc.id],
    );
    const resolved = sources.resolveExecutableAdapter(row.rows[0] as never, actorId);
    expect(resolved.adapter.adapterType).toBe('TEST_DETERMINISTIC');
    const cards = await resolved.adapter.searchByProducts(
      {
        primaryProductIds: ['p1'],
        locale: 'ru',
        resultLimit: 1,
        correlationId: 'pg-contract',
      },
      resolved.context,
    );
    expect(cards[0]?.parserVersion).toBe('test-parser/v1');

    // Disabled source cannot resolve
    await sources.disableSource({
      sourceId: testSrc.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reason: 'off',
    });
    const disabledRow = await pool.query(`SELECT * FROM "RecipeExternalSource" WHERE id = $1`, [
      testSrc.id,
    ]);
    expect(() => sources.resolveExecutableAdapter(disabledRow.rows[0] as never, actorId)).toThrow(
      RecipeSourceAdapterError,
    );

    // Restart persistence: re-read
    const again = await sources.getSource(testSrc.id);
    expect(again.enabled).toBe(false);
    expect(again.adapterType).toBe('TEST_DETERMINISTIC');
    expect(again.dataClass).toBe('TEST_ONLY');
  }, 60_000);

  it('seed idempotent / no-op second apply', async () => {
    await applyMigration('201_recipe-external-source-registry');
    const count = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "RecipeExternalSource" WHERE code IN ('food_ru','iamcook','russianfood')`,
    );
    expect(Number(count.rows[0]?.c)).toBe(3);
  }, 60_000);
});
