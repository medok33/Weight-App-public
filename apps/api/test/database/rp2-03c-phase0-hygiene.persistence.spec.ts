import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { ProductPriceResolver } from '../../src/modules/product-catalog/application/product-roles-retail.resolvers';
import { RecipeCoverageAnalyzer } from '../../src/modules/recipe-platform/application/recipe-coverage-analyzer.service';
import { RecipeCoverageService } from '../../src/modules/recipe-platform/application/recipe-coverage.service';
import { RecipeFingerprintService } from '../../src/modules/recipe-platform/application/recipe-fingerprint.service';
import { RecipeSearchBeforeGenerateService } from '../../src/modules/recipe-platform/application/recipe-search-before-generate.service';
import { COVERAGE_MATRIX_VERSION_V1 } from '../../src/modules/recipe-platform/domain/recipe-coverage.policy';
import { ShoppingListRepository } from '../../src/modules/shopping-list/infrastructure/shopping-list.repository';
import { ShoppingListService } from '../../src/modules/shopping-list/application/shopping-list.service';
import { getDisposableDatabaseUrl } from '../../src/test-support/assert-disposable-database';
import { observationIdentity } from '../../src/modules/price-intelligence/domain/reference-price.core';

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

type HygieneFixture = {
  stamp: string;
  productId: string;
  recipeId: string;
  recipeVersionId: string;
  slotId: string;
  assignmentId: string;
  regionId: string;
  retailerId: string;
  storeId: string;
  observationIds: string[];
};

async function createUniqueStore(stamp: string): Promise<{
  regionId: string;
  retailerId: string;
  storeId: string;
}> {
  const region = await pool.query<{ id: string }>(
    `INSERT INTO "Region" (code) VALUES ($1)
     ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
     RETURNING id`,
    [`hygiene-rgn-${stamp}`],
  );
  const regionId = region.rows[0]!.id;
  const retailer = await pool.query<{ id: string }>(
    `INSERT INTO "Retailer" (name, "key", type, code, region, active)
     VALUES ($1, $2, 'CHAIN', $3, 'RU', true)
     RETURNING id`,
    [`Hygiene Retailer ${stamp}`, `hygiene_retailer_${stamp}`, `HYGIENE_${stamp}`],
  );
  const retailerId = retailer.rows[0]!.id;
  const store = await pool.query<{ id: string }>(
    `INSERT INTO "RetailStore" ("retailerId", "regionId", name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [retailerId, regionId, `Hygiene Store ${stamp}`],
  );
  return { regionId, retailerId, storeId: store.rows[0]!.id };
}

async function insertPublishedVersion(input: {
  recipeId: string;
  productId: string;
  title: string;
  checksum: string;
  amount: number;
}): Promise<string> {
  const snap = JSON.stringify([
    {
      productId: input.productId,
      canonicalProductId: input.productId,
      displayName: 'HygieneGateProduct',
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
       $1,1,'PUBLISHED',
       $2::jsonb,$3::jsonb,
       '[{"stepIndex":0,"instruction":"Cook","durationMinutes":10,"temperatureC":null,"equipment":"pan"}]'::jsonb,
       '{"calories":400,"proteinG":30,"fatG":10,"carbsG":40,"basis":"x","source":"t"}'::jsonb,
       '{}'::jsonb, 2, 'MANUAL_PUBLISH', now(), $4, 'OWNER_PUBLISH'
     ) RETURNING id`,
    [input.recipeId, JSON.stringify({ title: input.title }), snap, input.checksum],
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

async function createHygieneFixture(
  stamp: string,
  fingerprints: RecipeFingerprintService,
): Promise<HygieneFixture> {
  // Unique Product with package metadata at INSERT time — never mutate shared seed products.
  const product = await pool.query<{ id: string }>(
    `INSERT INTO "Product" (
       id, "canonicalName", name, unit,
       "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g",
       "packageSize", "packageUnit", form
     ) VALUES (
       gen_random_uuid(), $1, $2, 'g',
       120, 10, 2, 8,
       500, 'g', 'RAW'
     ) RETURNING id`,
    [`hygcost_product_${stamp}`, `Hygiene Product ${stamp}`],
  );
  const productId = product.rows[0]!.id;

  const recipe = await pool.query<{ id: string }>(
    `INSERT INTO "Recipe" (id, name, servings, "recipeKey", "dataClass")
     VALUES (gen_random_uuid(), $1, 2, $2, 'PRODUCTION')
     RETURNING id`,
    [`Hygiene Recipe ${stamp}`, `hygcost_recipe_${stamp}`],
  );
  const recipeId = recipe.rows[0]!.id;
  const recipeVersionId = await insertPublishedVersion({
    recipeId,
    productId,
    title: `Hygiene Cost Dish ${stamp}`,
    checksum: `hygcost_checksum_${stamp}`,
    amount: 200,
  });
  await fingerprints.ensureFingerprint(recipeVersionId);

  const slot = await pool.query<{ id: string }>(
    `INSERT INTO "RecipeCoverageSlot" (
       "matrixVersion", "slotKey", "name", "description", "mealType", "primaryProductId", "dishType",
       "cookingMethod", "calorieMin", "calorieMax", "proteinMin", "fatMax",
       "maximumTimeMinutes", "dietaryProfile", "equipmentProfile",
       "maximumCost",
       status, "desiredRecipeCount", "publishedRecipeCount", priority, "sortRank",
       provenance, rationale, active
     ) VALUES (
       $1, $2, $3, 'Unique RP2 hygiene fixture slot', 'LUNCH', $4, 'MAIN',
       NULL, 200, 800, NULL, NULL,
       NULL, 'GENERAL', 'BASIC',
       120,
       'UNDERFILLED', 2, 1, 'HIGH', 99990,
       'TEST_FIXTURE', 'WORKOUT-ENERGY-01B-TEST-HARDEN-02', true
     ) RETURNING id`,
    [COVERAGE_MATRIX_VERSION_V1, `hygcost.slot.${stamp}`, `Hygiene slot ${stamp}`, productId],
  );
  const slotId = slot.rows[0]!.id;

  const assignment = await pool.query<{ id: string }>(
    `INSERT INTO "RecipeCoverageAssignment" (
       "slotId", "recipeVersionId", "assignmentType", "matchStatus", "matchScore", active
     ) VALUES ($1, $2, 'PRIMARY', 'EXACT_MATCH', 1.0, true)
     RETURNING id`,
    [slotId, recipeVersionId],
  );

  const store = await createUniqueStore(stamp);

  return {
    stamp,
    productId,
    recipeId,
    recipeVersionId,
    slotId,
    assignmentId: assignment.rows[0]!.id,
    regionId: store.regionId,
    retailerId: store.retailerId,
    storeId: store.storeId,
    observationIds: [],
  };
}

async function countFixtureObservations(productId: string): Promise<number> {
  const rows = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM "PriceObservation" WHERE "productId" = $1`,
    [productId],
  );
  return Number(rows.rows[0]?.c ?? 0);
}

async function insertFixtureObservation(
  fixture: HygieneFixture,
  input: {
    price: number;
    source: string;
    sourceType: string;
    sourceName: string;
    dataClass: 'FIXTURE' | 'PRODUCTION';
  },
): Promise<string> {
  const observedAt = new Date().toISOString();
  const retailProduct = await pool.query<{ id: string }>(
    `INSERT INTO "RetailProduct" ("retailerId","canonicalProductId","externalSku",title,status,"mappingStatus",source,"lastMatchedAt")
     VALUES ($1,$2,$3,'RP2 hygiene','ACTIVE','MAPPED',$4,now())
     ON CONFLICT ("retailerId","externalSku") WHERE "externalSku" IS NOT NULL AND status <> 'MERGED'
     DO UPDATE SET "canonicalProductId"=EXCLUDED."canonicalProductId", "mappingStatus"='MAPPED'
     RETURNING id`,
    [fixture.retailerId, fixture.productId, `rp2-hygiene-${fixture.productId}`, input.dataClass === 'FIXTURE' ? 'FIXTURE' : 'IMPORT'],
  );
  const retailProductId = retailProduct.rows[0]!.id;
  const observationKey = observationIdentity({
    productId: fixture.productId,
    storeId: fixture.storeId,
    retailerId: fixture.retailerId,
    retailProductId,
    externalSku: `rp2-hygiene-${fixture.productId}`,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    price: input.price,
    currency: 'RUB',
    observedAt,
    priceCondition: 'REGULAR',
  });
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO "PriceObservation"
      ("productId", "storeId", "retailerId", "retailProductId", price, currency, source, "sourceType", "sourceName",
       "observedAt", "collectedAt", "dataClass", "observationKey", "observedPackageWeight", "observedPackageUnit")
     VALUES ($1, $2, $10, $11, $3, 'RUB', $4, $5, $6, $8, $8, $7, $9, 100, 'g')
     RETURNING id`,
    [
      fixture.productId,
      fixture.storeId,
      input.price,
      input.source,
      input.sourceType,
      input.sourceName,
      input.dataClass,
      observedAt,
      observationKey,
      fixture.retailerId,
      retailProductId,
    ],
  );
  const id = inserted.rows[0]!.id;
  fixture.observationIds.push(id);
  return id;
}

async function deleteExactObservations(observationIds: string[]) {
  if (observationIds.length === 0) return;
  await pool.query(`DELETE FROM "PriceObservation" WHERE id = ANY($1::uuid[])`, [observationIds]);
}

async function teardownFixture(fixture: HygieneFixture | null) {
  if (!fixture) return;
  await deleteExactObservations(fixture.observationIds);
  await pool.query(`DELETE FROM "PriceObservation" WHERE "productId" = $1 AND "storeId" = $2`, [
    fixture.productId,
    fixture.storeId,
  ]);
  await pool.query(`DELETE FROM "RecipeCoverageAssignment" WHERE id = $1`, [fixture.assignmentId]);
  await pool.query(`DELETE FROM "RecipeCoverageSlot" WHERE id = $1`, [fixture.slotId]);
  await pool.query(`DELETE FROM "RecipeFingerprint" WHERE "recipeVersionId" = $1`, [
    fixture.recipeVersionId,
  ]);
  // RecipeVersion rows are immutable (trigger) — leave PUBLISHED fixture versions on disposable DB.
  // Unique product/store/retailer rows are still removed when no observations remain.
  await pool.query(`DELETE FROM "PriceObservation" WHERE "productId" = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM "RetailProduct" WHERE "canonicalProductId" = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM "Product" WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM "RetailStore" WHERE id = $1`, [fixture.storeId]);
  await pool.query(`DELETE FROM "Retailer" WHERE id = $1`, [fixture.retailerId]);
}

describe('RP2-03C Phase 0 hygiene (PG)', () => {
  const db = createDb();
  const prices = new ProductPriceResolver(db);
  const analyzer = new RecipeCoverageAnalyzer(db, undefined, prices);
  const coverage = new RecipeCoverageService(db, undefined, analyzer);
  const fingerprints = new RecipeFingerprintService(db);
  const search = new RecipeSearchBeforeGenerateService(db, analyzer, undefined, prices);
  const shoppingRepo = new ShoppingListRepository(db);
  const shopping = new ShoppingListService(shoppingRepo, undefined, db);

  let actorId = '';
  const fixtures: HygieneFixture[] = [];

  beforeAll(async () => {
    delete process.env.ALLOW_TEST_PRICES;
    await applyMigration('191_recipe-coverage-slot');
    await applyMigration('192_recipe-coverage-assignment');
    await applyMigration('193_coverage-core-v1-marker');
    await applyMigration('194_recipe-coverage-analysis-run');
    await applyMigration('195_recipe-coverage-dirty-matrix-meta');
    await applyMigration('196_recipe-coverage-assignment-match-contract');
    await applyMigration('197_recipe-search-before-generate-run');
    await applyMigration('198_recipe-search-decision');
    await applyMigration('199_price-dataclass-profile-structure');

    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
    await coverage.seedMatrixV1(actorId);
    await pool.query(`DELETE FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`, [
      COVERAGE_MATRIX_VERSION_V1,
    ]);
  }, 240000);

  afterAll(async () => {
    delete process.env.ALLOW_TEST_PRICES;
    for (const fixture of [...fixtures].reverse()) {
      await teardownFixture(fixture);
    }
    await pool.end();
  });

  it('cost search ignores FIXTURE prices until PRODUCTION observation exists', async () => {
    expect(process.env.ALLOW_TEST_PRICES).not.toBe('1');
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const fixture = await createHygieneFixture(stamp, fingerprints);
    fixtures.push(fixture);

    expect(await countFixtureObservations(fixture.productId)).toBe(0);

    await insertFixtureObservation(fixture, {
      price: 1.5,
      source: 'step092_fixture',
      sourceType: 'MANUAL',
      sourceName: 'STEP092 fixture store',
      dataClass: 'FIXTURE',
    });
    expect(await countFixtureObservations(fixture.productId)).toBe(1);

    await search.invalidateForCatalogEvent({
      reason: 'pg phase0 fixture-only cost',
      coverageSlotId: fixture.slotId,
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
    });

    const fixtureRun = await search.preflight({
      coverageSlotId: fixture.slotId,
      reason: 'pg phase0 fixture-only cost',
      requestedBy: actorId,
      overrides: { maximumCost: 120 },
    });
    expect(fixtureRun.status).toBe('COMPLETED');
    const fixtureCandidates = (fixtureRun.candidates ?? []) as Array<{
      recipeVersionId: string;
      costStatus: string;
    }>;
    const fixtureHit = fixtureCandidates.find((c) => c.recipeVersionId === fixture.recipeVersionId);
    expect(fixtureHit, 'unique hygiene recipe must appear as a candidate').toBeTruthy();
    expect(fixtureHit!.costStatus).toBe('PRICE_MISSING');

    // Unrelated priced seed products must not change unique-fixture PRICE_MISSING.
    const unrelatedPriced = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM "PriceObservation" po
       WHERE po."productId" <> $1
         AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION'`,
      [fixture.productId],
    );
    expect(Number(unrelatedPriced.rows[0]?.c ?? 0)).toBeGreaterThanOrEqual(0);

    await insertFixtureObservation(fixture, {
      price: 2.5,
      source: 'live_retail',
      sourceType: 'RETAIL',
      sourceName: 'Live retail probe',
      dataClass: 'PRODUCTION',
    });
    expect(await countFixtureObservations(fixture.productId)).toBe(2);

    const owned = await pool.query<{ id: string; storeId: string; dataClass: string }>(
      `SELECT id, "storeId", "dataClass"
       FROM "PriceObservation"
       WHERE id = ANY($1::uuid[])`,
      [fixture.observationIds],
    );
    expect(owned.rows).toHaveLength(fixture.observationIds.length);
    for (const row of owned.rows) {
      expect(row.storeId).toBe(fixture.storeId);
    }

    await search.invalidateForCatalogEvent({
      reason: 'pg phase0 production price inserted',
      coverageSlotId: fixture.slotId,
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
    });

    const productionRun = await search.preflight({
      coverageSlotId: fixture.slotId,
      reason: 'pg phase0 production cost',
      requestedBy: actorId,
      overrides: { maximumCost: 120 },
    });
    expect(productionRun.status).toBe('COMPLETED');
    const prodCandidates = (productionRun.candidates ?? []) as Array<{
      recipeVersionId: string;
      costStatus: string;
    }>;
    const prodHit = prodCandidates.find((c) => c.recipeVersionId === fixture.recipeVersionId);
    expect(prodHit, 'priced unique recipe must appear as a candidate').toBeTruthy();
    expect(prodHit!.costStatus).toBe('CURRENT_PRICE_CONFIRMED');

    const quote = await prices.resolveForProduct(fixture.productId);
    expect(quote.packagePriceRub).not.toBeNull();
    expect(quote.packageWeight).toBeGreaterThan(0);

    const repeat = await search.preflight({
      coverageSlotId: fixture.slotId,
      reason: 'pg phase0 production cost repeat',
      requestedBy: actorId,
      overrides: { maximumCost: 120 },
    });
    expect(repeat.inputChecksum).toBe(productionRun.inputChecksum);
    expect(repeat.resultChecksum).toBe(productionRun.resultChecksum);

    // Cleanup only exact fixture observations — preserve unrelated rows.
    const beforeUnrelated = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "PriceObservation" WHERE "productId" <> $1`,
      [fixture.productId],
    );
    await deleteExactObservations(fixture.observationIds);
    fixture.observationIds = [];
    expect(await countFixtureObservations(fixture.productId)).toBe(0);
    const afterUnrelated = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "PriceObservation" WHERE "productId" <> $1`,
      [fixture.productId],
    );
    expect(afterUnrelated.rows[0]?.c).toBe(beforeUnrelated.rows[0]?.c);
  }, 180000);

  it('explicit test opt-in cannot promote FIXTURE prices to confirmed current', async () => {
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const fixture = await createHygieneFixture(stamp, fingerprints);
    fixtures.push(fixture);

    expect(await countFixtureObservations(fixture.productId)).toBe(0);
    await insertFixtureObservation(fixture, {
      price: 3.5,
      source: 'step092_fixture',
      sourceType: 'MANUAL',
      sourceName: 'STEP092 fixture store',
      dataClass: 'FIXTURE',
    });

    process.env.ALLOW_TEST_PRICES = '1';
    try {
      await search.invalidateForCatalogEvent({
        reason: 'pg phase0 fixture opt-in',
        coverageSlotId: fixture.slotId,
        matrixVersion: COVERAGE_MATRIX_VERSION_V1,
      });
      const optInRun = await search.preflight({
        coverageSlotId: fixture.slotId,
        reason: 'pg phase0 fixture opt-in cost',
        requestedBy: actorId,
        overrides: { maximumCost: 120 },
      });
      expect(optInRun.status).toBe('COMPLETED');
      const candidates = (optInRun.candidates ?? []) as Array<{
        recipeVersionId: string;
        costStatus: string;
      }>;
      const hit = candidates.find((c) => c.recipeVersionId === fixture.recipeVersionId);
      expect(hit, 'fixture opt-in unique recipe must appear as a candidate').toBeTruthy();
      expect(hit!.costStatus).toBe('PRICE_MISSING');
    } finally {
      delete process.env.ALLOW_TEST_PRICES;
    }
  }, 120000);

  it('USER shopping list read path hides fixture retailer/source labels', async () => {
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const fixture = await createHygieneFixture(stamp, fingerprints);
    fixtures.push(fixture);

    // Unique retailer already has a fixture-looking name for this case.
    await pool.query(`UPDATE "Retailer" SET name = $2 WHERE id = $1`, [
      fixture.retailerId,
      'STEP092 Fixture Retailer',
    ]);

    const userId = randomUUID();
    await pool.query(`INSERT INTO "User" (id) VALUES ($1)`, [userId]);

    expect(await countFixtureObservations(fixture.productId)).toBe(0);
    await insertFixtureObservation(fixture, {
      price: 99,
      source: 'step092_fixture',
      sourceType: 'MANUAL',
      sourceName: 'STEP092 fixture store',
      dataClass: 'FIXTURE',
    });

    const list = await shoppingRepo.createListForPlan(
      userId,
      [
        {
          productKey: `phase0-probe-${stamp}`,
          name: 'Phase0 probe',
          category: 'other',
          quantity: 100,
          unit: 'g',
          packageSize: 500,
          fallbackUnitPrice: 100,
          productId: fixture.productId,
          unitPrice: 99,
          estimatedCost: 19.8,
          priceSourceType: 'MANUAL',
          priceSourceName: 'STEP092 fixture store',
          retailerName: 'STEP092 Fixture Retailer',
        },
      ],
      { sourcePlanId: null, sourcePlanVersion: 1 },
    );

    const userView = await shopping.getLatest(userId);
    expect(userView?.id).toBe(list.id);
    const item = userView?.items[0];
    expect(item).toBeTruthy();
    const userFacingBlob = JSON.stringify(item ?? {}).toLowerCase();
    expect(userFacingBlob).not.toMatch(/step092|fixture/);
    expect(item?.retailerName == null || !/step092|fixture/i.test(item.retailerName)).toBe(true);
    expect(item?.priceSourceName == null || !/step092|fixture/i.test(item.priceSourceName)).toBe(true);
    expect(String(item?.priceSourceName ?? '')).toMatch(/не найдена|not found/i);

    // Rename only the unique fixture retailer — never touch shared catalog retailers.
    await pool.query(`UPDATE "Retailer" SET name = $2 WHERE id = $1`, [
      fixture.retailerId,
      `Hygiene Retailer alias ${stamp}`,
    ]);
    const afterAlias = await shopping.getLatest(userId);
    const afterItem = afterAlias?.items[0];
    const afterBlob = JSON.stringify(afterItem ?? {}).toLowerCase();
    expect(afterBlob).not.toMatch(/step092|fixture/);
    expect(afterItem?.retailerName == null || !/step092|fixture/i.test(afterItem.retailerName ?? '')).toBe(
      true,
    );
    const obs = await pool.query<{ dataClass: string }>(
      `SELECT "dataClass" FROM "PriceObservation" WHERE id = ANY($1::uuid[]) ORDER BY "collectedAt" DESC LIMIT 1`,
      [fixture.observationIds],
    );
    expect(obs.rows[0]?.dataClass).toBe('FIXTURE');
  }, 120000);
});
