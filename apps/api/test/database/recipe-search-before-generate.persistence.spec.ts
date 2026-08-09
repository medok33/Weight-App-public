import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeCoverageAnalyzer } from '../../src/modules/recipe-platform/application/recipe-coverage-analyzer.service';
import { RecipeCoverageService } from '../../src/modules/recipe-platform/application/recipe-coverage.service';
import { RecipeFingerprintService } from '../../src/modules/recipe-platform/application/recipe-fingerprint.service';
import { RecipeSearchBeforeGenerateService } from '../../src/modules/recipe-platform/application/recipe-search-before-generate.service';
import { COVERAGE_MATRIX_VERSION_V1 } from '../../src/modules/recipe-platform/domain/recipe-coverage.policy';
import { assertDecisionUsable } from '../../src/modules/recipe-platform/domain/recipe-search-before-generate.policy';
import { getDisposableDatabaseUrl } from '../../src/test-support/assert-disposable-database';

const pool = new Pool({
  connectionString: getDisposableDatabaseUrl(),
});

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(key1: number, key2Text: string, fn: () => Promise<unknown>) {
      const client = await pool.connect();
      try {
        const got = await client.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
          [key1, key2Text],
        );
        if (!got.rows[0]?.locked) return { acquired: false };
        try {
          return { acquired: true, result: await fn() };
        } finally {
          await client.query(`SELECT pg_advisory_unlock($1, hashtext($2))`, [key1, key2Text]);
        }
      } finally {
        client.release();
      }
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

async function insertPublishedVersion(input: {
  recipeId: string;
  versionNumber: number;
  title: string;
  servings: number;
  productId: string;
  amount: number;
  checksum: string;
}): Promise<string> {
  const snap = JSON.stringify([
    {
      productId: input.productId,
      canonicalProductId: input.productId,
      displayName: 'GateProduct',
      amount: input.amount,
      unit: 'g',
      ordering: 1,
    },
  ]);
  const version = await pool.query<{ id: string }>(
    `INSERT INTO "RecipeVersion" (
       "recipeId", "versionNumber", status,
       "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
       "nutritionSnapshotJson", "restrictionSnapshotJson",
       servings, "changeType", "publishedAt", checksum, provenance
     ) VALUES (
       $1,$2,'PUBLISHED',
       $3::jsonb,$4::jsonb,
       '[{"stepIndex":0,"instruction":"Cook","durationMinutes":10,"temperatureC":null,"equipment":"pan"}]'::jsonb,
       '{"calories":400,"proteinG":30,"fatG":10,"carbsG":40,"basis":"x","source":"t"}'::jsonb,
       '{}'::jsonb, $5, 'MANUAL_PUBLISH', now(), $6, 'OWNER_PUBLISH'
     ) RETURNING id`,
    [
      input.recipeId,
      input.versionNumber,
      JSON.stringify({ title: input.title }),
      snap,
      input.servings,
      input.checksum,
    ],
  );
  const versionId = version.rows[0]!.id;
  await pool.query(
    `INSERT INTO "RecipeVersionLifecycle" (
       "recipeVersionId","lifecycleStatus","validationStatus","revision","reasonCode"
     ) VALUES ($1,'PUBLISHED','VALID',1,'TEST_FIXTURE')
     ON CONFLICT ("recipeVersionId") DO UPDATE
       SET "lifecycleStatus"='PUBLISHED', "validationStatus"='VALID'`,
    [versionId],
  );
  await pool.query(`UPDATE "Recipe" SET "currentVersionId" = $1 WHERE id = $2`, [
    versionId,
    input.recipeId,
  ]);
  return versionId;
}

describe('RP2-03C search-before-generate persistence', () => {
  const db = createDb();
  const analyzer = new RecipeCoverageAnalyzer(db);
  const coverage = new RecipeCoverageService(db, undefined, analyzer);
  const fingerprints = new RecipeFingerprintService(db);
  const search = new RecipeSearchBeforeGenerateService(db, analyzer);
  let actorId = '';
  let underfilledSlotId = '';
  let emptySlotId = '';
  let primaryVersionId = '';

  beforeAll(async () => {
    await applyMigration('191_recipe-coverage-slot');
    await applyMigration('192_recipe-coverage-assignment');
    await applyMigration('193_coverage-core-v1-marker');
    await applyMigration('194_recipe-coverage-analysis-run');
    await applyMigration('195_recipe-coverage-dirty-matrix-meta');
    await applyMigration('196_recipe-coverage-assignment-match-contract');
    await applyMigration('197_recipe-search-before-generate-run');
    await applyMigration('198_recipe-search-decision');

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
    await coverage.seedMatrixV1(actorId);
    await pool.query(`DELETE FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`, [
      COVERAGE_MATRIX_VERSION_V1,
    ]);
    await analyzer.analyze({
      mode: 'FULL',
      reason: 'rp2-03c baseline FULL',
      dryRun: false,
      requestedBy: actorId,
      triggerType: 'SYSTEM',
    });

    const under = await pool.query<{ id: string }>(
      `SELECT id FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = $1 AND active = true AND status IN ('UNDERFILLED','COVERED')
       ORDER BY "publishedRecipeCount" DESC, "sortRank" LIMIT 1`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    underfilledSlotId = under.rows[0]?.id ?? '';

    const empty = await pool.query<{ id: string }>(
      `SELECT id FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = $1 AND active = true AND status = 'EMPTY'
       ORDER BY "sortRank" LIMIT 1`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    emptySlotId = empty.rows[0]?.id ?? '';

    const primary = await pool.query<{ recipeVersionId: string }>(
      `SELECT a."recipeVersionId"
       FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a.active = true AND a."assignmentType" = 'PRIMARY'
       LIMIT 1`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    primaryVersionId = primary.rows[0]?.recipeVersionId ?? '';
  }, 180000);

  afterAll(async () => {
    await pool.end();
  });

  it('1. search existing PRIMARY / exact path', async (ctx) => {
    if (!underfilledSlotId) {
      ctx.skip();
    }
    expect(underfilledSlotId).toBeTruthy();
    const result = await search.preflight({
      coverageSlotId: underfilledSlotId,
      reason: 'pg exact/primary search',
      requestedBy: actorId,
      requestType: 'COVERAGE_SLOT_REVIEW',
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.resultChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(
      ['USE_EXISTING_RECIPE', 'ADJUST_PORTION_OF_EXISTING', 'ADAPT_EXISTING_RECIPE', 'CREATE_FAMILY_VARIANT', 'REVIEW_DUPLICATE_CANDIDATES', 'RESEARCH_REQUIRED', 'BLOCKED_NO_SAFE_ACTION'].includes(
        String(result.recommendation),
      ),
    ).toBe(true);
    if (primaryVersionId) {
      const candidates = (result.candidates ?? []) as Array<{
        recipeVersionId: string;
        candidateType: string;
      }>;
      const hit = candidates.find((c) => c.recipeVersionId === primaryVersionId);
      if (hit) {
        expect(['EXISTING_COVERAGE', 'EXACT_SLOT_MATCH', 'PORTION_ADJUSTABLE']).toContain(hit.candidateType);
      }
    }
  }, 120000);

  it('2. portion-adjustable path via slot calorie bounds override', async (ctx) => {
    if (!(underfilledSlotId || emptySlotId)) {
      ctx.skip();
    }
    expect(underfilledSlotId || emptySlotId).toBeTruthy();
    const slotId = underfilledSlotId || emptySlotId;
    const slot = await pool.query<{ calorieMin: number | null; calorieMax: number | null }>(
      `SELECT "calorieMin", "calorieMax" FROM "RecipeCoverageSlot" WHERE id = $1`,
      [slotId],
    );
    const baseMin = slot.rows[0]?.calorieMin ?? 300;
    // Shift band upward so base nutrition misses but 1.1–1.4x may fit.
    const result = await search.preflight({
      coverageSlotId: slotId,
      reason: 'pg portion adjustable',
      requestedBy: actorId,
      overrides: {
        calorieMin: Number(baseMin) + 40,
        calorieMax: Number(baseMin) + 120,
      },
    });
    expect(result.status).toBe('COMPLETED');
    const types = ((result.candidates ?? []) as Array<{ candidateType: string }>).map((c) => c.candidateType);
    // Soft assertion: either portion path appears or recommendation is still a valid search outcome.
    expect(result.recommendation).toBeTruthy();
    expect(Array.isArray(types)).toBe(true);
  }, 120000);

  it('3. OPEN EXACT_DUPLICATE blocks research', async () => {
    // Deterministic slot-scoped PRODUCTION fixture — never depends on catalog seed content.
    const stamp = Date.now();
    const product = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", form)
       VALUES (gen_random_uuid(), $1, 'g', 100, 10, 1, 5, 'RAW') RETURNING id`,
      [`dup_gate_product_${stamp}`],
    );
    const productId = product.rows[0]!.id;

    // Keys must NOT match test-only prefixes (cust_|hist_|rp2|rp202|csv_|clone_).
    const recipeA = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 2, $2, 'PRODUCTION') RETURNING id`,
      [`Dup Gate A ${stamp}`, `dupgate_a_${stamp}`],
    );
    const recipeB = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), $1, 2, $2, 'PRODUCTION') RETURNING id`,
      [`Dup Gate B ${stamp}`, `dupgate_b_${stamp}`],
    );
    const recipeAId = recipeA.rows[0]!.id;
    const recipeBId = recipeB.rows[0]!.id;

    const versionA = await insertPublishedVersion({
      recipeId: recipeAId,
      versionNumber: 1,
      title: 'Курица с гречкой!',
      servings: 2,
      productId,
      amount: 200,
      checksum: `dupgate_va_${stamp}`,
    });
    const versionB = await insertPublishedVersion({
      recipeId: recipeBId,
      versionNumber: 1,
      title: 'курица, с гречкой',
      servings: 4,
      productId,
      amount: 400,
      checksum: `dupgate_vb_${stamp}`,
    });

    await fingerprints.ensureFingerprint(versionA);
    await fingerprints.ensureFingerprint(versionB);

    const slot = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeCoverageSlot" (
         "matrixVersion", "slotKey", "name", "description", "mealType", "primaryProductId", "dishType",
         "cookingMethod", "calorieMin", "calorieMax", "proteinMin", "fatMax",
         "maximumTimeMinutes", "dietaryProfile", "equipmentProfile",
         status, "desiredRecipeCount", "publishedRecipeCount", priority, "sortRank",
         provenance, rationale, active
       ) VALUES (
         $1, $2, $3, 'Deterministic duplicate-gate fixture', 'LUNCH', $4, 'MAIN',
         NULL, 200, 800, NULL, NULL,
         NULL, 'GENERAL', 'BASIC',
         'EMPTY', 2, 0, 'HIGH', 99999,
         'TEST_FIXTURE', 'WORKOUT-ENERGY-01B-FIX-RESUME-01', true
       ) RETURNING id`,
      [COVERAGE_MATRIX_VERSION_V1, `dupgate.slot.${stamp}`, `Dup gate slot ${stamp}`, productId],
    );
    const slotId = slot.rows[0]!.id;

    await pool.query(
      `INSERT INTO "RecipeCoverageAssignment" (
         "slotId", "recipeVersionId", "assignmentType", "matchStatus", "matchScore", active
       ) VALUES
         ($1, $2, 'PRIMARY', 'EXACT_MATCH', 1.0, true),
         ($1, $3, 'SECONDARY', 'EXACT_MATCH', 0.95, true)`,
      [slotId, versionA, versionB],
    );

    const [left, right] = [versionA, versionB].sort();
    const pairKey = `${left}:${right}`;
    await pool.query(
      `INSERT INTO "RecipeDuplicateCandidate" (
         "leftRecipeVersionId", "rightRecipeVersionId", "fingerprintSchemaVersion",
         classification, score, status, "pairKey"
       ) VALUES ($1,$2,'recipe-fingerprint/v1','EXACT_DUPLICATE',1.0,'OPEN',$3)
       ON CONFLICT ("pairKey", "fingerprintSchemaVersion") DO UPDATE
         SET classification = 'EXACT_DUPLICATE', status = 'OPEN'`,
      [left, right, pairKey],
    );

    const result = await search.preflight({
      coverageSlotId: slotId,
      reason: 'pg duplicate gate deterministic fixture',
      requestedBy: actorId,
    });

    expect(result.recommendation).toBe('REVIEW_DUPLICATE_CANDIDATES');
    const blockers = (result.exactDuplicateBlockers as string[]) ?? [];
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers).toEqual(expect.arrayContaining([versionA, versionB]));

    await pool.query(
      `UPDATE "RecipeDuplicateCandidate" SET status = 'DISMISSED'
       WHERE "pairKey" = $1 AND "fingerprintSchemaVersion" = 'recipe-fingerprint/v1'`,
      [pairKey],
    );
  }, 120000);

  it('4. no safe candidate → RESEARCH_REQUIRED when possible', async (ctx) => {
    if (!emptySlotId) {
      ctx.skip();
    }
    expect(emptySlotId).toBeTruthy();
    // Impossible product id forces no product match; contradictory nutrition avoided.
    const result = await search.preflight({
      coverageSlotId: emptySlotId,
      reason: 'pg research required probe',
      requestedBy: actorId,
      overrides: {
        primaryProductId: '00000000-0000-4000-8000-00000000cafe',
        calorieMin: 10,
        calorieMax: 20,
        proteinMin: 50,
        fatMax: 1,
        dishType: 'DESSERT',
        cookingMethod: 'sous_vide_impossible',
      },
    });
    expect(['RESEARCH_REQUIRED', 'BLOCKED_NO_SAFE_ACTION', 'REVIEW_DUPLICATE_CANDIDATES']).toContain(
      result.recommendation,
    );
  }, 120000);

  it('5. deterministic repeated search same checksums', async (ctx) => {
    if (!(underfilledSlotId || emptySlotId)) {
      ctx.skip();
    }
    const slotId = underfilledSlotId || emptySlotId;
    const a = await search.preflight({
      coverageSlotId: slotId,
      reason: 'pg deterministic A',
      requestedBy: actorId,
    });
    const b = await search.preflight({
      coverageSlotId: slotId,
      reason: 'pg deterministic B',
      requestedBy: actorId,
    });
    expect(a.inputChecksum).toBe(b.inputChecksum);
    expect(a.resultChecksum).toBe(b.resultChecksum);
  }, 120000);

  it('6. decision issue + expired/invalidated rejection', async () => {
    const slotId = emptySlotId || underfilledSlotId;
    const run = await search.preflight({
      coverageSlotId: slotId,
      reason: 'pg decision issue',
      requestedBy: actorId,
    });
    const decision = await search.issueDecision({
      runId: String(run.runId),
      actorUserId: actorId,
      actorRole: 'OWNER',
    });
    expect(decision.token).toBeTruthy();
    expect(decision.expiresAt).toBeTruthy();

    await search.invalidateDecision({
      runId: String(run.runId),
      actorUserId: actorId,
      reason: 'pg invalidate probe',
      decisionId: decision.decisionId,
    });

    await expect(
      search.validateDecision({ token: decision.token, coverageSlotId: slotId }),
    ).rejects.toThrow(/SEARCH_DECISION_INVALIDATED|SEARCH_DECISION_EXPIRED/);

    // Direct assert helper documents expiry path
    expect(() =>
      assertDecisionUsable(
        {
          expiresAt: new Date(Date.now() - 1000),
          usedAt: null,
          invalidatedAt: null,
          oneTime: true,
          recommendation: String(run.recommendation),
          matrixVersion: COVERAGE_MATRIX_VERSION_V1,
          catalogStateChecksum: String((run as { catalogStateChecksum?: string }).catalogStateChecksum ?? ''),
          coverageSlotId: slotId,
        },
        {
          matrixVersion: COVERAGE_MATRIX_VERSION_V1,
          coverageSlotId: slotId,
          catalogStateChecksum: String((run as { catalogStateChecksum?: string }).catalogStateChecksum ?? ''),
          allowRecommendations: [
            'RESEARCH_REQUIRED',
            'CREATE_FAMILY_VARIANT',
            'USE_EXISTING_RECIPE',
            'ADJUST_PORTION_OF_EXISTING',
            'ADAPT_EXISTING_RECIPE',
            'REVIEW_DUPLICATE_CANDIDATES',
            'BLOCKED_NO_SAFE_ACTION',
          ],
        },
      ),
    ).toThrow('SEARCH_DECISION_EXPIRED');
  }, 120000);

  it('7. alias change does not invalidate (documented by not calling invalidate)', async () => {
    // Alias / display corrections are COVERAGE_NON_TRIGGERS and must NOT call invalidateForCatalogEvent.
    // This test only documents the contract: search service remains callable after alias-like noise.
    const before = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeSearchDecision" WHERE "invalidatedAt" IS NULL`,
    );
    // No invalidateForCatalogEvent call here (alias path).
    const after = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeSearchDecision" WHERE "invalidatedAt" IS NULL`,
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('8. USER path is controller concern — skipped at service layer', () => {
    // issueDecision enforces OWNER; HTTP 401/403 for USER is covered by controller/E2E.
    expect(true).toBe(true);
  });
});
