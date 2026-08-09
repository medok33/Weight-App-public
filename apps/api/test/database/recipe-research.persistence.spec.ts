import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeResearchService } from '../../src/modules/recipe-platform/application/recipe-research.service';
import { RecipeExternalSourceService } from '../../src/modules/recipe-platform/application/recipe-external-source.service';
import { SEARCH_SCHEMA_VERSION } from '../../src/modules/recipe-platform/domain/recipe-search-before-generate.policy';
import { stableJsonChecksum } from '../../src/modules/recipe-platform/domain/recipe-research.policy';

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

describe('RP2-04B recipe research staging persistence', () => {
  const db = createDb();
  let research: RecipeResearchService;
  let actorId = '';
  let stamp = 0;
  let slotId: string | null = null;
  let productId: string | null = null;
  let liveCatalogChecksum = '';

  beforeAll(async () => {
    await applyMigration('202_recipe-research-staging');
    stamp = Date.now();
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
    const slot = await pool.query<{ id: string }>(
      `SELECT id FROM "RecipeCoverageSlot" WHERE active = true ORDER BY "sortRank" LIMIT 1`,
    );
    slotId = slot.rows[0]?.id ?? null;
    const product = await pool.query<{ id: string }>(
      `SELECT id FROM "Product" WHERE status = 'ACTIVE' ORDER BY "createdAt" LIMIT 1`,
    );
    productId = product.rows[0]?.id ?? null;

    // Mirror service catalog checksum for fixture decisions.
    const versions = await pool.query(
      `SELECT v.id AS "versionId", fp."exactContentHash" AS "fingerprintHash",
              l."lifecycleStatus", l."validationStatus"
       FROM "Recipe" r
       JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
       JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       LEFT JOIN "RecipeFingerprint" fp ON fp."recipeVersionId" = v.id
         AND fp."fingerprintSchemaVersion" = 'recipe-fingerprint/v1'
       ORDER BY v.id`,
    );
    const slots = await pool.query(
      `SELECT id, "slotKey", status, "publishedRecipeCount" AS published
       FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = 'coverage-core-v1' AND active = true
       ORDER BY "slotKey"`,
    );
    liveCatalogChecksum = stableJsonChecksum({
      matrixVersion: 'coverage-core-v1',
      versions: versions.rows,
      slots: slots.rows,
    });

    const sources = {
      resolveExecutableAdapter() {
        throw new Error('NETWORK_SHOULD_NOT_RUN');
      },
      async getSource() {
        return null;
      },
    } as unknown as RecipeExternalSourceService;
    research = new RecipeResearchService(db, sources);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  async function insertDecision(recommendation: string, opts?: { expired?: boolean; stale?: boolean; invalidated?: boolean }) {
    if (!slotId) throw new Error('no coverage slot');
    const ck = `ck-${stamp}-${Math.random().toString(16).slice(2)}`;
    const run = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeSearchBeforeGenerateRun" (
         "matrixVersion", "coverageSlotId", "searchSchemaVersion", "requestType",
         "inputChecksum", status, reason, "resultChecksum", "completedAt"
       ) VALUES ('coverage-core-v1',$1,$2,'RESEARCH_PREFLIGHT',$3,'COMPLETED','rp2-04b fixture',$3, now())
       RETURNING id`,
      [slotId, SEARCH_SCHEMA_VERSION, ck],
    );
    const token = `tok-${ck}`;
    const decision = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeSearchDecision" (
         "searchRunId", "coverageSlotId", "matrixVersion", recommendation,
         "inputChecksum", "resultChecksum", "catalogStateChecksum",
         token, "tokenHash", "expiresAt", "invalidatedAt", "invalidationReason"
       ) VALUES ($1,$2,'coverage-core-v1',$3,$4,$4,$5,$6, encode(digest($6,'sha256'),'hex'),
                 $7, $8, $9)
       RETURNING id`,
      [
        run.rows[0]!.id,
        slotId,
        recommendation,
        ck,
        opts?.stale ? 'stale-catalog-checksum' : liveCatalogChecksum,
        token,
        opts?.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 86_400_000),
        opts?.invalidated ? new Date() : null,
        opts?.invalidated ? 'TEST_INVALIDATED' : null,
      ],
    );
    return decision.rows[0]!.id;
  }

  it('1-6,8-13,22-26: manual request capture normalize retention without Product/Recipe growth', async () => {
    const beforeProducts = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Product"`);
    const beforeRecipes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "Recipe" WHERE COALESCE("dataClass",'PRODUCTION') = 'PRODUCTION'`,
    );
    const beforeVersions = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "RecipeVersion"`);
    const beforeAssignments = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAssignment" WHERE active = true`,
    );
    const beforeMeal = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "MealItem"`);
    const beforeShop = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "ShoppingList"`,
    ).catch(() => ({ rows: [{ n: -1 }] }));

    const key = `rp2-04b:manual:${stamp}:a`;
    const created = await research.createRequest({
      reason: 'manual staging fixture',
      idempotencyKey: key,
      actorUserId: actorId,
      actorRole: 'OWNER',
      manual: true,
    });
    expect(created.status).toBe('READY');

    const replay = await research.createRequest({
      reason: 'manual staging fixture',
      idempotencyKey: key,
      actorUserId: actorId,
      actorRole: 'OWNER',
      manual: true,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(String(replay.id)).toBe(String(created.id));

    const run = await research.runRequest({
      requestId: String(created.id),
      actorUserId: actorId,
      actorRole: 'OWNER',
      idempotencyKey: `rp2-04b:run:${stamp}:a`,
      manualPayload: {
        title: `RP204B Manual ${stamp}`,
        ingredients: [
          { name: 'курица', amountText: '200', unitText: 'г' },
          { name: `unknown-product-${stamp}`, amountText: 'abc', unitText: 'ведро' },
        ],
        steps: [{ ordinal: 1, text: 'Готовить' }],
        servings: 2,
      },
    });
    expect(run.candidate?.id).toBeTruthy();
    const runRow = await pool.query<{ resultJson: { networkCalls?: number } }>(
      `SELECT "resultJson" FROM "RecipeResearchRun" WHERE id = $1`,
      [run.runId],
    );
    expect(runRow.rows[0]?.resultJson?.networkCalls ?? 0).toBe(0);

    const candidateId = String(run.candidate!.id);
    const normalized = await research.normalizeCandidate({
      candidateId,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(Array.isArray(normalized.normalized)).toBe(true);
    expect(Number((normalized.normalized as Array<{ version: number }>)[0]?.version)).toBe(1);
    expect(Array.isArray(normalized.reviewItems)).toBe(true);

    const snap = await pool.query<{
      payloadChecksum: string;
      inlinePayloadJson: unknown;
      deletionStatus: string;
    }>(`SELECT "payloadChecksum", "inlinePayloadJson", "deletionStatus" FROM "RecipeSourceRawSnapshot" WHERE id = $1`, [
      run.candidate!.rawSnapshotId,
    ]);
    expect(snap.rows[0]?.payloadChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.rows[0]?.deletionStatus).toBe('ACTIVE');
    expect(snap.rows[0]?.inlinePayloadJson).toBeTruthy();

    await pool.query(
      `UPDATE "RecipeSourceRawSnapshot" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [run.candidate!.rawSnapshotId],
    );
    const retention = await research.runRetentionJob({ actorUserId: actorId });
    expect(retention.redacted).toBeGreaterThanOrEqual(1);
    const afterSnap = await pool.query<{
      inlinePayloadJson: unknown;
      payloadChecksum: string;
      deletionStatus: string;
    }>(`SELECT "inlinePayloadJson", "payloadChecksum", "deletionStatus" FROM "RecipeSourceRawSnapshot" WHERE id = $1`, [
      run.candidate!.rawSnapshotId,
    ]);
    expect(afterSnap.rows[0]?.inlinePayloadJson).toBeNull();
    expect(afterSnap.rows[0]?.payloadChecksum).toBe(snap.rows[0]!.payloadChecksum);
    expect(['DELETED', 'RETAINED_METADATA']).toContain(afterSnap.rows[0]!.deletionStatus);

    const retention2 = await research.runRetentionJob({ actorUserId: actorId });
    expect(retention2.redacted).toBe(0);

    const afterProducts = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Product"`);
    const afterRecipes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "Recipe" WHERE COALESCE("dataClass",'PRODUCTION') = 'PRODUCTION'`,
    );
    const afterVersions = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "RecipeVersion"`);
    const afterAssignments = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAssignment" WHERE active = true`,
    );
    const afterMeal = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "MealItem"`);
    expect(afterProducts.rows[0]!.n).toBe(beforeProducts.rows[0]!.n);
    expect(afterRecipes.rows[0]!.n).toBe(beforeRecipes.rows[0]!.n);
    expect(afterVersions.rows[0]!.n).toBe(beforeVersions.rows[0]!.n);
    expect(afterAssignments.rows[0]!.n).toBe(beforeAssignments.rows[0]!.n);
    expect(afterMeal.rows[0]!.n).toBe(beforeMeal.rows[0]!.n);
    if (beforeShop.rows[0]!.n >= 0) {
      const afterShop = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "ShoppingList"`);
      expect(afterShop.rows[0]!.n).toBe(beforeShop.rows[0]!.n);
    }
  }, 120_000);

  it('1-2: RESEARCH_REQUIRED and CREATE_FAMILY_VARIANT requests consume decision atomically', async () => {
    if (!slotId) return;
    const researchDecisionId = await insertDecision('RESEARCH_REQUIRED');
    const created = await research.createRequest({
      searchDecisionId: researchDecisionId,
      reason: 'from RESEARCH_REQUIRED',
      idempotencyKey: `rp2-04b:dec-rr:${stamp}`,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(created.status).toBe('READY');
    const used = await pool.query<{ usedAt: Date | null }>(
      `SELECT "usedAt" FROM "RecipeSearchDecision" WHERE id = $1`,
      [researchDecisionId],
    );
    expect(used.rows[0]?.usedAt).toBeTruthy();
    await expect(
      research.createRequest({
        searchDecisionId: researchDecisionId,
        reason: 'reuse',
        idempotencyKey: `rp2-04b:dec-rr-reuse:${stamp}`,
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/RECIPE_RESEARCH_DECISION_ALREADY_USED/);

    const familyId = await insertDecision('CREATE_FAMILY_VARIANT');
    const family = await research.createRequest({
      searchDecisionId: familyId,
      reason: 'from CREATE_FAMILY_VARIANT',
      idempotencyKey: `rp2-04b:dec-cfv:${stamp}`,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(family.status).toBe('READY');
  }, 60_000);

  it('3-4: REVIEW_DUPLICATE_CANDIDATES / expired / invalidated / catalog-stale rejected', async () => {
    if (!slotId) return;
    const dup = await insertDecision('REVIEW_DUPLICATE_CANDIDATES');
    await expect(
      research.createRequest({
        searchDecisionId: dup,
        reason: 'should fail',
        idempotencyKey: `rp2-04b:bad:${stamp}`,
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/RECIPE_RESEARCH_DECISION_NOT_ALLOWED/);

    const expired = await insertDecision('RESEARCH_REQUIRED', { expired: true });
    await expect(
      research.createRequest({
        searchDecisionId: expired,
        reason: 'expired',
        idempotencyKey: `rp2-04b:exp:${stamp}`,
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/RECIPE_RESEARCH_DECISION_EXPIRED/);

    const invalidated = await insertDecision('RESEARCH_REQUIRED', { invalidated: true });
    await expect(
      research.createRequest({
        searchDecisionId: invalidated,
        reason: 'invalidated',
        idempotencyKey: `rp2-04b:inv:${stamp}`,
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/RECIPE_RESEARCH_DECISION_INVALIDATED/);

    const stale = await insertDecision('RESEARCH_REQUIRED', { stale: true });
    await expect(
      research.createRequest({
        searchDecisionId: stale,
        reason: 'stale',
        idempotencyKey: `rp2-04b:stale:${stamp}`,
        actorUserId: actorId,
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/RECIPE_RESEARCH_DECISION_CATALOG_STALE/);
  }, 60_000);

  it('14-20: renormalization v2 after manual review resolution', async () => {
    if (!productId) return;
    const created = await research.createRequest({
      reason: 'review remap',
      idempotencyKey: `rp2-04b:review:${stamp}`,
      actorUserId: actorId,
      actorRole: 'OWNER',
      manual: true,
    });
    const unknownName = `manual-unknown-${stamp}`;
    const run = await research.runRequest({
      requestId: String(created.id),
      actorUserId: actorId,
      actorRole: 'OWNER',
      idempotencyKey: `rp2-04b:review-run:${stamp}`,
      manualPayload: {
        title: `Review ${stamp}`,
        ingredients: [{ name: unknownName, amountText: '10', unitText: 'г' }],
        steps: [{ ordinal: 1, text: 'x' }],
        servings: 1,
      },
    });
    const candidateId = String(run.candidate!.id);
    const v1 = await research.normalizeCandidate({
      candidateId,
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    const open = (v1.reviewItems as Array<{ id: string; type: string; status: string }>).find(
      (i) => i.type === 'UNKNOWN_PRODUCT' && i.status === 'OPEN',
    );
    expect(open?.id).toBeTruthy();
    await research.resolveReviewItem({
      reviewItemId: open!.id,
      actorUserId: actorId,
      actorRole: 'OWNER',
      reason: 'mapped to existing product',
      productId,
    });
    const versions = await pool.query<{ version: number }>(
      `SELECT version FROM "RecipeNormalizedCandidate" WHERE "candidateId" = $1 ORDER BY version`,
      [candidateId],
    );
    expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);
    const item = await pool.query<{ status: string; reason: string | null }>(
      `SELECT status, reason FROM "RecipeCandidateReviewItem" WHERE id = $1`,
      [open!.id],
    );
    expect(item.rows[0]?.status).toBe('RESOLVED');
    expect(item.rows[0]?.reason).toBeTruthy();
  }, 120_000);

  it('blocks USER role from createRequest', async () => {
    await expect(
      research.createRequest({
        reason: 'user probe',
        idempotencyKey: `rp2-04b:user:${stamp}`,
        actorUserId: actorId,
        actorRole: 'USER',
        manual: true,
      }),
    ).rejects.toThrow(/OWNER_ACCESS_FORBIDDEN/);
  });
});
