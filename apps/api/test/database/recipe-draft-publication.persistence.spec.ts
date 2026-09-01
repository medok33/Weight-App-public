import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { RecipePublicationService } from '../../src/modules/recipe-platform/application/recipe-publication.service';
import { RecipeLifecycleService } from '../../src/modules/recipe-platform/application/recipe-lifecycle.service';
import { RecipeVersionService } from '../../src/modules/recipe-platform/application/recipe-version.service';
import { RecipeQualityOrchestrator } from '../../src/modules/recipe-platform/application/recipe-quality.orchestrator';
import { RECIPE_CONTRACT_VERSION, type MethodSkeletonStep, type RecipeContractV1 } from '../../src/modules/recipe-platform/domain/recipe-contract.v1';
import { publicationChecksum } from '../../src/modules/recipe-platform/domain/recipe-authoring.policy';

/**
 * 07C2A-R2 direct behavioral persistence tests: DRAFT staging, replay
 * idempotency, concurrent overlap, DRAFT->PUBLISHED promotion parity,
 * supersede and immutability semantics against real PostgreSQL.
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

async function applyMigration(name: string) {
  const path = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (!existsSync(path)) throw new Error(`missing migration ${name}`);
  await pool.query(readFileSync(path, 'utf8'));
}

const skeleton: MethodSkeletonStep[] = [{ stepId: 's1', order: 1, ingredientIds: ['i1'], technique: 'boil', durationMinutes: 20, temperatureC: 190 }];

let seq = Date.now();
const uniqueKey = (label: string) => `r2_${label}_${(seq++).toString(36)}`;

function contractBase(recipeKey: string, title: string): Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'> {
  return {
    contractVersion: RECIPE_CONTRACT_VERSION,
    recipeKey,
    versionIdentity: `${recipeKey}:v1`,
    title,
    description: 'Simple',
    servings: 2,
    yieldGrams: 400,
    totalTimeMinutes: 20,
    ingredients: [{ ingredientId: 'i1', productId: 'p1', grams: 100, unit: 'g', optional: false }],
    equipment: ['pot'],
    methodSkeleton: skeleton,
    nutrition: {},
    cost: {},
    safety: { status: 'PASS' as const, reasons: [] },
    provenance: { sourceIds: [], evidenceIds: [] },
    similarity: { autoPublish: true, decision: 'CREATE', score: 0.1 },
    cookTestStatus: 'NOT_PERFORMED' as const,
    publicationState: 'DRAFT' as const,
  } as Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'>;
}

const editor = async () => ({ title: 'T', description: 'd', steps: [{ stepId: 's1', text: 'Boil for 20 minutes at 190 C.' }] });
const criticPass = async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] });

async function verified(recipeKey: string, title: string) {
  const base = contractBase(recipeKey, title);
  const result = await new RecipeQualityOrchestrator().verify({ base, editor, critic: criticPass, semanticCoverage: { requiredTerms: [] } });
  if (result.status !== 'AUTO_VERIFIED' || !result.contract || !result.receipt) throw new Error('fixture not verified');
  return result as { contract: RecipeContractV1; receipt: NonNullable<typeof result.receipt> };
}

function inputOf(contract: RecipeContractV1, receipt: unknown, extra: Record<string, unknown> = {}) {
  return {
    recipeKey: contract.recipeKey,
    title: contract.title,
    description: contract.description,
    servings: contract.servings,
    yieldGrams: contract.yieldGrams,
    ingredients: [{ id: 'i1', productId: 'p1', amount: 100, unit: 'g' }],
    steps: [{ index: 1, text: 'ok', ingredientIds: ['i1'] }],
    nutrition: { total: { kcal: 1, proteinG: 1, fatG: 1, carbohydratesG: 1 }, perServing: { kcal: 1, proteinG: 1, fatG: 1, carbohydratesG: 1 }, yieldGrams: 400, servings: 2, basis: 'CANONICAL_PRODUCT_NUTRITION' as const },
    cost: { status: 'UNAVAILABLE' },
    actorId: actorUserId,
    qualityContract: contract,
    qualityReceipt: receipt as never,
    ...extra,
  } as Parameters<RecipePublicationService['stageDraft']>[0];
}

let actorUserId = '';

async function versionState(versionId: string) {
  const row = await pool.query(
    `SELECT v.status, v."approvedBy", v."approvedAt", v."publishedAt", v.checksum,
            l."lifecycleStatus", l."validationStatus"
     FROM "RecipeVersion" v
     LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
     WHERE v.id = $1`,
    [versionId],
  );
  return row.rows[0] ?? null;
}

describe('07C2A-R2 draft boundary persistence (disposable local PostgreSQL)', () => {
  let db: PrismaService;
  let publication: RecipePublicationService;
  let lifecycle: RecipeLifecycleService;
  let versions: RecipeVersionService;

  beforeAll(async () => {
    await applyMigration('181_recipe-version');
    await applyMigration('182_meal-item-recipe-version');
    await applyMigration('183_recipe-version-immutability');
    await applyMigration('184_recipe-version-lifecycle');
    const user = await pool.query<{ id: string }>(`INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`);
    actorUserId = user.rows[0].id;
    db = new PrismaService();
    publication = new RecipePublicationService(db);
    lifecycle = new RecipeLifecycleService(db);
    versions = new RecipeVersionService(db, undefined, undefined, undefined, lifecycle);
  });

  afterAll(async () => {
    await db.onModuleDestroy();
    await pool.end();
  });

  it('01-09: verified artifact -> DRAFT with full non-published invariant set; first-ever draft is not current and not usable', async () => {
    const key = uniqueKey('first');
    const fx = await verified(key, 'First Draft');
    const staged = await publication.stageDraft(inputOf(fx.contract, fx.receipt));

    expect(staged.idempotent).toBe(false);
    expect(staged.status).toBe('DRAFT');
    const state = await versionState(staged.recipeVersionId);
    expect(state.status).toBe('DRAFT');                                   // 02
    expect(state.lifecycleStatus).toBe('IN_REVIEW');                      // 03
    expect(state.validationStatus).toBe('VALID');
    expect(state.approvedBy).toBeNull();                                  // 04
    expect(state.approvedAt).toBeNull();                                  // 05
    expect(state.publishedAt).toBeNull();                                 // 06

    const recipe = await pool.query(`SELECT "currentVersionId", name FROM "Recipe" WHERE id=$1`, [staged.recipeId]);
    expect(recipe.rows[0].currentVersionId).toBeNull();                   // 07/08: first-ever draft
    expect(await lifecycle.resolveUsableVersionId(staged.recipeId)).toBeNull(); // 09: unusable
  });

  it('10-11: existing published V1 stays current after V2 draft; staging does not leak shell metadata', async () => {
    const key = uniqueKey('v1v2');
    const fx1 = await verified(key, 'Published Title V1');
    const pub = await publication.publish(inputOf(fx1.contract, fx1.receipt));
    const recipeRow = await pool.query<{ id: string }>(`SELECT id FROM "Recipe" WHERE "recipeKey"=$1`, [key]);
    const recipeId = recipeRow.rows[0].id;

    const fx2 = await verified(key, 'Draft Title V2');
    const staged = await publication.stageDraft(inputOf(fx2.contract, fx2.receipt));

    const after = await pool.query(`SELECT "currentVersionId", name FROM "Recipe" WHERE id=$1`, [recipeId]);
    expect(after.rows[0].currentVersionId).toBe(pub.recipeVersionId);     // 10: V1 remains current
    expect(after.rows[0].name).toBe('Published Title V1');                // 11: no draft metadata leak
    expect(await lifecycle.resolveUsableVersionId(recipeId)).toBe(pub.recipeVersionId);
    const draftState = await versionState(staged.recipeVersionId);
    expect(draftState.status).toBe('DRAFT');
  });

  it('12-13: sequential stageDraft replay returns the same RecipeVersion with zero duplicates', async () => {
    const key = uniqueKey('replay');
    const fx = await verified(key, 'Replay Draft');
    const first = await publication.stageDraft(inputOf(fx.contract, fx.receipt));
    const second = await publication.stageDraft(inputOf(fx.contract, fx.receipt));
    expect(second.recipeVersionId).toBe(first.recipeVersionId);           // 12
    expect(second.idempotent).toBe(true);
    const count = await pool.query(`SELECT count(*)::int AS n FROM "RecipeVersion" v JOIN "Recipe" r ON r.id=v."recipeId" WHERE r."recipeKey"=$1`, [key]);
    expect(count.rows[0].n).toBe(1);                                      // 13
  });

  it('14-15: concurrent stageDraft replay has proven overlap and creates zero duplicates (DB authority)', async () => {
    const key = uniqueKey('concurrent');
    const fx = await verified(key, 'Concurrent Draft');
    const draftInput = inputOf(fx.contract, fx.receipt);
    const shell = await publication.stageDraft(draftInput); // shell exists now

    // Explicit barrier: hold the Recipe row lock from a dedicated client so
    // concurrent stageDraft calls demonstrably overlap inside their txns.
    const blocker = await pool.connect();
    let result: Awaited<ReturnType<RecipePublicationService['stageDraft']>> | null = null;
    try {
      await blocker.query('BEGIN');
      const checksum = publicationChecksum({ recipeKey: draftInput.recipeKey, title: draftInput.title, servings: draftInput.servings, yieldGrams: draftInput.yieldGrams, ingredients: draftInput.ingredients, steps: draftInput.steps, nutrition: draftInput.nutrition, cost: draftInput.cost });
      const lockKey = Number.parseInt(createHash('sha256').update(`recipe-artifact:${checksum}`).digest('hex').slice(0, 8), 16) & 0x7fffffff;
      await blocker.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      let settled = false;
      const inflight = publication.stageDraft(draftInput).then((value) => { settled = true; return value; });
      await new Promise((r) => setTimeout(r, 500));
      expect(settled).toBe(false);
      // Commit BEFORE asserting so a failed expectation can never leak the barrier.
      await blocker.query('COMMIT');
      result = await inflight;
      expect(result.idempotent).toBe(true);
      expect(result.recipeVersionId).toBe(shell.recipeVersionId);
    } finally {
      try { await blocker.query('ROLLBACK'); } catch { /* already closed */ }
      await blocker.release();
      if (result) expect(result.status).toBe('DRAFT');
    }

    const count = await pool.query(`SELECT count(*)::int AS n FROM "RecipeVersion" v JOIN "Recipe" r ON r.id=v."recipeId" WHERE r."recipeKey"=$1`, [key]);
    expect(count.rows[0].n).toBe(1);                                      // 15
  });

  it('29-36: stageDraft(X) -> publish(X) promotes the SAME version to full four-way PUBLISHED parity; replay is truly idempotent; previous current superseded', async () => {
    const key = uniqueKey('promote');
    const fx1 = await verified(key, 'Promote Base V1');
    const v1 = await publication.publish(inputOf(fx1.contract, fx1.receipt));

    const fx2 = await verified(key, 'Promote Draft V2');
    const staged = await publication.stageDraft(inputOf(fx2.contract, fx2.receipt));
    expect(staged.status).toBe('DRAFT');

    const published = await publication.publish(inputOf(fx2.contract, fx2.receipt)); // 29
    expect(published.recipeVersionId).toBe(staged.recipeVersionId);       // 30/31: same version, real promotion
    expect((published as { promotedFromDraft?: boolean }).promotedFromDraft).toBe(true);

    const state = await versionState(published.recipeVersionId);
    expect(state.status).toBe('PUBLISHED');                               // 31
    expect(state.lifecycleStatus).toBe('PUBLISHED');                      // 32
    expect(state.publishedAt).not.toBeNull();                             // 33

    const events = await pool.query(`SELECT "fromStatus" AS from_status, "toStatus" AS to_status FROM "RecipeVersionLifecycleEvent" WHERE "recipeVersionId"=$1 ORDER BY "createdAt"`, [published.recipeVersionId]);
    expect(events.rows.map((row) => `${row.from_status ?? 'NULL'}->${row.to_status}`)).toEqual(['NULL->IN_REVIEW', 'IN_REVIEW->APPROVED', 'APPROVED->PUBLISHED']);

    const recipe = await pool.query(`SELECT id, "currentVersionId" FROM "Recipe" WHERE "recipeKey"=$1`, [key]);
    expect(recipe.rows[0].currentVersionId).toBe(published.recipeVersionId); // 34
    expect(await lifecycle.resolveUsableVersionId(recipe.rows[0].id)).toBe(published.recipeVersionId);

    const replay = await publication.publish(inputOf(fx2.contract, fx2.receipt)); // 35
    expect(replay.idempotent).toBe(true);
    expect(replay.recipeVersionId).toBe(published.recipeVersionId);
    const postReplay = await versionState(published.recipeVersionId);
    expect(postReplay.status).toBe('PUBLISHED');

    const prev = await versionState(v1.recipeVersionId);
    expect(prev.lifecycleStatus).toBe('SUPERSEDED');                      // 36

    // 30 (negative): a DRAFT is never reported as already-published success.
    const keyNeg = uniqueKey('neg');
    const fxNeg = await verified(keyNeg, 'Negative Check');
    const stagedNeg = await publication.stageDraft(inputOf(fxNeg.contract, fxNeg.receipt));
    const pubNeg = await publication.publish(inputOf(fxNeg.contract, fxNeg.receipt));
    expect(pubNeg.idempotent).toBe(false);
    const negState = await versionState(stagedNeg.recipeVersionId);
    expect(negState.status).toBe('PUBLISHED');
  });

  it('37: createVersion(publish:false) creates a DRAFT row with IN_REVIEW/VALID and NULL publishedAt', async () => {
    const product = await pool.query<{ id: string }>(
      `INSERT INTO "Product" (id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g")
       VALUES (gen_random_uuid(), $1, 'g', 100, 10, 1, 5) RETURNING id`,
      [`r2_prod_${uniqueKey('p')}`],
    );
    const recipe = await pool.query<{ id: string }>(
      `INSERT INTO "Recipe" (id, name, servings, description, "recipeKey", "dataClass")
       VALUES (gen_random_uuid(), 'R2 Mutable Dish', 2, 'd', $1, 'TEST_ONLY') RETURNING id`,
      [uniqueKey('mutable')],
    );
    const recipeId = recipe.rows[0].id;
    await pool.query(`INSERT INTO "RecipeIngredient" ("recipeId","productId",quantity,unit) VALUES ($1,$2,100,'g')`, [recipeId, product.rows[0].id]);
    await pool.query(`INSERT INTO "RecipeStep" ("recipeId","stepIndex",instruction) VALUES ($1,0,'Mix')`, [recipeId]);

    const created = await versions.createVersion({ recipeId, actorUserId: actorUserId, actorRole: 'OWNER', publish: false });
    expect(created.status).toBe('DRAFT');                                 // 37
    const state = await versionState(created.id);
    expect(state.status).toBe('DRAFT');
    expect(state.lifecycleStatus).toBe('IN_REVIEW');
    expect(state.publishedAt).toBeNull();
    const after = await pool.query(`SELECT "currentVersionId" FROM "Recipe" WHERE id=$1`, [recipeId]);
    expect(after.rows[0].currentVersionId).toBeNull();

    // 38: explicit publishVersion produces row/lifecycle parity.
    await versions.publishVersion({ recipeId, versionId: created.id, actorUserId: actorUserId, actorRole: 'OWNER' });
    const published = await versionState(created.id);
    expect(published.status).toBe('PUBLISHED');
    expect(published.lifecycleStatus).toBe('PUBLISHED');
    expect(published.publishedAt).not.toBeNull();
    const current = await pool.query(`SELECT "currentVersionId" FROM "Recipe" WHERE id=$1`, [recipeId]);
    expect(current.rows[0].currentVersionId).toBe(created.id);
  });

  it('12-12 (audit §12): content snapshots stay immutable while status/publication transitions are allowed', async () => {
    const key = uniqueKey('immut');
    const fx = await verified(key, 'Immutability Probe');
    const staged = await publication.stageDraft(inputOf(fx.contract, fx.receipt));
    const before = await pool.query(`SELECT "contentSnapshotJson","ingredientsSnapshotJson",checksum FROM "RecipeVersion" WHERE id=$1`, [staged.recipeVersionId]);
    await publication.publish(inputOf(fx.contract, fx.receipt));
    const after = await pool.query(`SELECT "contentSnapshotJson","ingredientsSnapshotJson",checksum FROM "RecipeVersion" WHERE id=$1`, [staged.recipeVersionId]);
    expect(after.rows[0].checksum).toBe(before.rows[0].checksum);
    expect(JSON.stringify(after.rows[0].contentSnapshotJson)).toBe(JSON.stringify(before.rows[0].contentSnapshotJson));

    // Trigger must reject content mutation attempts on the published row.
    await expect(
      pool.query(`UPDATE "RecipeVersion" SET "contentSnapshotJson"='{"x":1}'::jsonb WHERE id=$1`, [staged.recipeVersionId]),
    ).rejects.toThrow('RECIPE_VERSION_IMMUTABLE');
    // 40/H03: checksum uniqueness stays DB-enforced.
    await expect(
      pool.query(
        `INSERT INTO "RecipeVersion" ("recipeId","versionNumber",status,"contentSnapshotJson","ingredientsSnapshotJson","stepsSnapshotJson","nutritionSnapshotJson","costSnapshotJson","restrictionSnapshotJson","servings","servingWeightGrams","changeType","createdBy",checksum,provenance)
         SELECT "recipeId","versionNumber"+1,'DRAFT',"contentSnapshotJson","ingredientsSnapshotJson","stepsSnapshotJson","nutritionSnapshotJson","costSnapshotJson","restrictionSnapshotJson",servings,"servingWeightGrams",'SYSTEM','r2',checksum,'SYSTEM' FROM "RecipeVersion" WHERE id=$1`,
        [staged.recipeVersionId],
      ),
    ).rejects.toThrow();
  });
});
