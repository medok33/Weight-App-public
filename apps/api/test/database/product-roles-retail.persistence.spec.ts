import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import {
  ProductCulinaryRoleResolver,
  ProductPriceResolver,
  ProductSubstitutionResolver,
  RetailProductRepository,
} from '../../src/modules/product-catalog/application/product-roles-retail.resolvers';
import { MealDishCatalogRepository } from '../../src/modules/meal-plan/infrastructure/meal-dish-catalog.repository';
import { STEP093_PRODUCTS } from '../../src/modules/meal-plan/domain/substitution.fixture';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return { query, withTransaction: async (fn) => fn(query) } as PrismaService;
}

async function applyMigration(name: string): Promise<void> {
  let sql = readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');
  if (name === '175_culinary-roles') {
    // Re-applying heuristic primary roles after pilot seed would violate one-primary unique index.
    sql = sql.replace(
      'SELECT p.id, r.id, true, \'HEURISTIC\', 0.70',
      `SELECT p.id, r.id,
        NOT EXISTS (
          SELECT 1 FROM "ProductCulinaryRole" x
          WHERE x."productId" = p.id AND x."isPrimary" = true
        ),
        'HEURISTIC', 0.70`,
    );
  }
  await pool.query(sql);
}

describe('RP2-01B culinary roles / RetailProduct persistence', () => {
  const db = createDb();
  const roles = new ProductCulinaryRoleResolver(db);
  const substitutions = new ProductSubstitutionResolver(db);
  const retail = new RetailProductRepository(db);
  const prices = new ProductPriceResolver(db);
  const catalog = new MealDishCatalogRepository(db);
  const buckwheatId = STEP093_PRODUCTS[0]!.id;
  const riceId = STEP093_PRODUCTS[6]!.id;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await applyMigration('171_product-category-and-form');
    await applyMigration('172_product-alias-normalization');
    await applyMigration('173_product-nutrition-version');
    await applyMigration('174_product-allergen-dietary');
    await applyMigration('175_culinary-roles');
    await applyMigration('176_product-substitution');
    await applyMigration('177_retail-product');
    await catalog.ensureCatalog();
  }, 180_000);

  afterAll(async () => {
    await pool.end();
  });

  it('persists multi-role Product and rejects second primary role', async () => {
    const map = await roles.rolesForProducts([buckwheatId]);
    const list = map.get(buckwheatId) ?? [];
    expect(list.some((r) => r.culinaryRoleCode === 'STARCH')).toBe(true);

    const fat = await pool.query<{ id: string }>(`SELECT id FROM "CulinaryRole" WHERE code = 'FAT'`);
    await pool.query(
      `INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", source, confidence)
       VALUES ($1, $2, false, 'FIXTURE', 0.5)
       ON CONFLICT ("productId", "culinaryRoleId") DO NOTHING`,
      [buckwheatId, fat.rows[0]!.id],
    );
    const multi = await roles.rolesForProducts([buckwheatId]);
    expect((multi.get(buckwheatId) ?? []).length).toBeGreaterThanOrEqual(2);

    const acid = await pool.query<{ id: string }>(`SELECT id FROM "CulinaryRole" WHERE code = 'ACID'`);
    await expect(
      pool.query(
        `INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", source, confidence)
         VALUES ($1, $2, true, 'FIXTURE', 0.5)`,
        [buckwheatId, acid.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects self-edge and duplicate substitution edges', async () => {
    await expect(
      pool.query(
        `INSERT INTO "ProductSubstitution"
          ("sourceProductId", "replacementProductId", "replacementRatio", "replacementRatioMin", "replacementRatioMax")
         VALUES ($1, $1, 1, 0.8, 1.2)`,
        [buckwheatId],
      ),
    ).rejects.toThrow();

    const role = await pool.query<{ id: string }>(`SELECT id FROM "CulinaryRole" WHERE code = 'STARCH'`);
    await expect(
      pool.query(
        `INSERT INTO "ProductSubstitution"
          ("sourceProductId", "replacementProductId", "culinaryRoleId",
           "replacementRatio", "replacementRatioMin", "replacementRatioMax", status, source)
         VALUES ($1, $2, $3, 1, 0.8, 1.2, 'ACTIVE', 'FIXTURE')`,
        [buckwheatId, riceId, role.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it('lists curated ACTIVE substitutions and excludes SUSPENDED / method-incompatible', async () => {
    const boil = await substitutions.listActiveForSource(buckwheatId, {
      cookingMethods: ['BOIL', 'FRY'],
    });
    expect(boil.some((e) => e.replacementProductId === riceId)).toBe(true);
    expect(boil.every((e) => e.status === 'ACTIVE')).toBe(true);

    const blendOnly = await substitutions.listActiveForSource(buckwheatId, {
      cookingMethods: ['BOIL'],
    });
    expect(
      blendOnly.some(
        (e) =>
          e.replacementProductId === STEP093_PRODUCTS[1]!.id &&
          e.supportedMethods.length === 1 &&
          e.supportedMethods[0] === 'BLEND',
      ),
    ).toBe(false);
  });

  it('candidate response excludes method-incompatible potato entirely under BOIL', async () => {
    const potatoId = STEP093_PRODUCTS[1]!.id;
    const starch = await pool.query<{ id: string }>(`SELECT id FROM "CulinaryRole" WHERE code = 'STARCH'`);
    const edges = await substitutions.listEdgesForSource(buckwheatId);
    const products = new Map(
      STEP093_PRODUCTS.map((p) => [
        p.id,
        {
          productId: p.id,
          productKey: p.productKey,
          displayName: p.canonicalName,
          unit: p.unit,
          caloriesPer100g: p.caloriesPer100g,
          proteinPer100g: p.proteinPer100g,
          fatPer100g: p.fatPer100g,
          carbsPer100g: p.carbsPer100g,
          packageSize: p.packageSize,
          packageUnit: p.packageUnit,
          unitPriceRub: p.unitPriceRub,
          allergens: [...p.allergens],
          dietaryTags: [...p.dietaryTags],
          enabled: true,
        },
      ]),
    );

    const { buildIngredientCandidates } = await import(
      '../../src/modules/meal-plan/domain/substitution.engine'
    );
    const boilResult = buildIngredientCandidates({
      sourceRecipe: {
        recipeId: 'r1',
        recipeKey: 'buckwheat_chicken',
        name: 'buckwheat_chicken',
        description: 'boil dish',
        mealTypes: ['lunch'],
        portionGrams: 400,
        prepMinutes: 10,
        cookMinutes: 25,
        allergens: [],
        dietaryTags: [],
        enabled: true,
        ingredients: [
          { productId: buckwheatId, amount: 80, unit: 'g' },
          { productId: STEP093_PRODUCTS[2]!.id, amount: 160, unit: 'g' },
        ],
      },
      sourcePortionGrams: 400,
      sourceMacros: { calories: 500, proteinG: 40, fatG: 10, carbsG: 50 },
      sourceCost: { consumed: 50 },
      replaceProductId: buckwheatId,
      mealType: 'lunch',
      dayTargetCalories: 2500,
      dayOtherCalories: 1000,
      products,
      constraints: {
        allergens: [],
        foodRestrictions: [],
        dietaryPreferences: [],
        excludedProductIds: [],
        rejectedProductIds: [],
      },
      culinaryRoleId: starch.rows[0]!.id,
      cookingMethods: ['BOIL'],
      curatedEdges: edges.map((edge) => ({
        sourceProductId: edge.sourceProductId,
        replacementProductId: edge.replacementProductId,
        culinaryRoleId: edge.culinaryRoleId,
        culinaryRoleCode: edge.culinaryRoleCode,
        replacementRatio: edge.replacementRatio,
        replacementRatioMin: edge.replacementRatioMin,
        replacementRatioMax: edge.replacementRatioMax,
        nutritionImpact: edge.nutritionImpact,
        textureImpact: edge.textureImpact,
        supportedMethods: edge.supportedMethods,
        status: edge.status,
      })),
    });

    expect(boilResult.candidates.some((c) => c.productId === potatoId)).toBe(false);
    expect(
      boilResult.candidates.some(
        (c) => c.productId === potatoId && c.provenance === 'CURATED_PRODUCT_SUBSTITUTION',
      ),
    ).toBe(false);
    expect(
      boilResult.candidates.some(
        (c) => c.productId === potatoId && c.provenance === 'HEURISTIC_CATALOG_MATCH',
      ),
    ).toBe(false);
    expect(boilResult.candidates.find((c) => c.productId === riceId)?.provenance).toBe(
      'CURATED_PRODUCT_SUBSTITUTION',
    );

    const blendResult = buildIngredientCandidates({
      sourceRecipe: {
        recipeId: 'r1',
        recipeKey: 'buckwheat_chicken',
        name: 'buckwheat_chicken',
        description: 'blend dish',
        mealTypes: ['lunch'],
        portionGrams: 400,
        prepMinutes: 10,
        cookMinutes: 25,
        allergens: [],
        dietaryTags: [],
        enabled: true,
        ingredients: [
          { productId: buckwheatId, amount: 80, unit: 'g' },
          { productId: STEP093_PRODUCTS[2]!.id, amount: 160, unit: 'g' },
        ],
      },
      sourcePortionGrams: 400,
      sourceMacros: { calories: 500, proteinG: 40, fatG: 10, carbsG: 50 },
      sourceCost: { consumed: 50 },
      replaceProductId: buckwheatId,
      mealType: 'lunch',
      dayTargetCalories: 2500,
      dayOtherCalories: 1000,
      products,
      constraints: {
        allergens: [],
        foodRestrictions: [],
        dietaryPreferences: [],
        excludedProductIds: [],
        rejectedProductIds: [],
      },
      culinaryRoleId: starch.rows[0]!.id,
      cookingMethods: ['BLEND'],
      curatedEdges: edges.map((edge) => ({
        sourceProductId: edge.sourceProductId,
        replacementProductId: edge.replacementProductId,
        culinaryRoleId: edge.culinaryRoleId,
        culinaryRoleCode: edge.culinaryRoleCode,
        replacementRatio: edge.replacementRatio,
        replacementRatioMin: edge.replacementRatioMin,
        replacementRatioMax: edge.replacementRatioMax,
        nutritionImpact: edge.nutritionImpact,
        textureImpact: edge.textureImpact,
        supportedMethods: edge.supportedMethods,
        status: edge.status,
      })),
    });
    expect(blendResult.candidates.find((c) => c.productId === potatoId)?.provenance).toBe(
      'CURATED_PRODUCT_SUBSTITUTION',
    );

    // Control: without any curated edge, heuristic still works for an allowed product.
    const pasta = STEP093_PRODUCTS[3]!;
    const noEdgeResult = buildIngredientCandidates({
      sourceRecipe: {
        recipeId: 'r1',
        recipeKey: 'buckwheat_chicken',
        name: 'buckwheat_chicken',
        description: 'boil',
        mealTypes: ['lunch'],
        portionGrams: 400,
        prepMinutes: 10,
        cookMinutes: 25,
        allergens: [],
        dietaryTags: [],
        enabled: true,
        ingredients: [
          { productId: buckwheatId, amount: 80, unit: 'g' },
          { productId: STEP093_PRODUCTS[2]!.id, amount: 160, unit: 'g' },
        ],
      },
      sourcePortionGrams: 400,
      sourceMacros: { calories: 500, proteinG: 40, fatG: 10, carbsG: 50 },
      sourceCost: { consumed: 50 },
      replaceProductId: buckwheatId,
      mealType: 'lunch',
      dayTargetCalories: 2500,
      dayOtherCalories: 1000,
      products,
      constraints: {
        allergens: [],
        foodRestrictions: [],
        dietaryPreferences: [],
        excludedProductIds: [],
        rejectedProductIds: [],
      },
      cookingMethods: ['BOIL'],
      curatedEdges: [],
    });
    expect(noEdgeResult.candidates.find((c) => c.productId === pasta.id)?.provenance).toBe(
      'HEURISTIC_CATALOG_MATCH',
    );
  });

  it('rejects concurrent duplicate ProductSubstitution edges (role + NULL role)', async () => {
    const pasta = STEP093_PRODUCTS[3]!;
    const plantMilk = STEP093_PRODUCTS[5]!;
    const turkey = STEP093_PRODUCTS[2]!;
    const role = await pool.query<{ id: string }>(`SELECT id FROM "CulinaryRole" WHERE code = 'STARCH'`);
    const roleId = role.rows[0]!.id;

    await pool.query(
      `DELETE FROM "ProductSubstitution"
       WHERE "sourceProductId" = $1 AND "replacementProductId" = $2`,
      [pasta.id, plantMilk.id],
    );
    await pool.query(
      `DELETE FROM "ProductSubstitution"
       WHERE "sourceProductId" = $1 AND "replacementProductId" = $2 AND "culinaryRoleId" IS NULL`,
      [pasta.id, turkey.id],
    );

    const insertWithRole = () =>
      pool.query(
        `INSERT INTO "ProductSubstitution"
          ("sourceProductId", "replacementProductId", "culinaryRoleId",
           "replacementRatio", "replacementRatioMin", "replacementRatioMax",
           "nutritionImpact", "textureImpact", "supportedMethods", status, source, confidence)
         VALUES ($1,$2,$3,1,0.8,1.2,'SIMILAR','MINIMAL',ARRAY['BOIL']::text[],'ACTIVE','FIXTURE',0.5)`,
        [pasta.id, plantMilk.id, roleId],
      );

    const roleAttempts = await Promise.allSettled([insertWithRole(), insertWithRole()]);
    const roleOk = roleAttempts.filter((a) => a.status === 'fulfilled');
    const roleFail = roleAttempts.filter((a) => a.status === 'rejected');
    expect(roleOk).toHaveLength(1);
    expect(roleFail).toHaveLength(1);
    const roleErr = String((roleFail[0] as PromiseRejectedResult).reason);
    expect(/unique|duplicate|ProductSubstitution_edge_role_uidx/i.test(roleErr)).toBe(true);

    const roleCount = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "ProductSubstitution"
       WHERE "sourceProductId" = $1 AND "replacementProductId" = $2
         AND "culinaryRoleId" IS NOT DISTINCT FROM $3
         AND status IN ('ACTIVE','NEEDS_REVIEW','SUSPENDED')`,
      [pasta.id, plantMilk.id, roleId],
    );
    expect(Number(roleCount.rows[0]!.c)).toBe(1);

    const listed = await substitutions.listEdgesForSource(pasta.id, { statuses: ['ACTIVE'] });
    expect(listed.filter((e) => e.replacementProductId === plantMilk.id)).toHaveLength(1);

    const insertNullRole = () =>
      pool.query(
        `INSERT INTO "ProductSubstitution"
          ("sourceProductId", "replacementProductId", "culinaryRoleId",
           "replacementRatio", "replacementRatioMin", "replacementRatioMax",
           "nutritionImpact", "textureImpact", "supportedMethods", status, source, confidence)
         VALUES ($1,$2,NULL,1,0.8,1.2,'SIMILAR','MINIMAL',ARRAY['BOIL']::text[],'ACTIVE','FIXTURE',0.5)`,
        [pasta.id, turkey.id],
      );

    const nullAttempts = await Promise.allSettled([insertNullRole(), insertNullRole()]);
    const nullOk = nullAttempts.filter((a) => a.status === 'fulfilled');
    const nullFail = nullAttempts.filter((a) => a.status === 'rejected');
    expect(nullOk).toHaveLength(1);
    expect(nullFail).toHaveLength(1);
    const nullErr = String((nullFail[0] as PromiseRejectedResult).reason);
    expect(/unique|duplicate|ProductSubstitution_edge_role_uidx/i.test(nullErr)).toBe(true);

    const nullCount = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "ProductSubstitution"
       WHERE "sourceProductId" = $1 AND "replacementProductId" = $2
         AND "culinaryRoleId" IS NULL
         AND status IN ('ACTIVE','NEEDS_REVIEW','SUSPENDED')`,
      [pasta.id, turkey.id],
    );
    expect(Number(nullCount.rows[0]!.c)).toBe(1);
  });

  it('links PriceObservation to RetailProduct and preserves legacy observations', async () => {
    const mapped = await retail.findMappedForProduct(buckwheatId);
    expect(mapped.length).toBeGreaterThan(0);

    const linked = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "PriceObservation"
       WHERE "productId" = $1 AND "retailProductId" IS NOT NULL`,
      [buckwheatId],
    );
    expect(Number(linked.rows[0]!.c)).toBeGreaterThan(0);

    const quote = await prices.resolveForProduct(buckwheatId, { allowTestPrices: true });
    expect(['RETAIL_PRODUCT_PRICE', 'LEGACY_PRODUCT_PRICE']).toContain(quote.provenance);
    expect(quote.packagePriceRub).toBeGreaterThan(0);

    // Production path must not treat FIXTURE retail observations as confirmed store evidence.
    const productionQuote = await prices.resolveForProduct(buckwheatId);
    expect(['PRICE_MISSING', 'PRICE_INCOMPLETE', 'RETAIL_PRODUCT_PRICE', 'LEGACY_PRODUCT_PRICE']).toContain(
      productionQuote.provenance,
    );
    if (productionQuote.dataClass && productionQuote.dataClass !== 'PRODUCTION') {
      expect(productionQuote.provenance).toBe('PRICE_MISSING');
    }

    // Cannot delete RetailProduct with observations.
    await expect(
      pool.query(`DELETE FROM "RetailProduct" WHERE id = $1`, [mapped[0]!.id]),
    ).rejects.toThrow();
  });

  it('writes RP2-01B backfill report without PII', async () => {
    const stats = await pool.query<{
      roles: string;
      withoutRoles: string;
      substitutions: string;
      needsReview: string;
      retail: string;
      linkedPrices: string;
      legacyPrices: string;
      needsMapping: string;
      legacyPackage: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM "ProductCulinaryRole") AS roles,
         (SELECT count(*)::text FROM "Product" p
           WHERE NOT EXISTS (SELECT 1 FROM "ProductCulinaryRole" r WHERE r."productId" = p.id)) AS "withoutRoles",
         (SELECT count(*)::text FROM "ProductSubstitution") AS substitutions,
         (SELECT count(*)::text FROM "ProductSubstitution" WHERE status = 'NEEDS_REVIEW') AS "needsReview",
         (SELECT count(*)::text FROM "RetailProduct") AS retail,
         (SELECT count(*)::text FROM "PriceObservation" WHERE "retailProductId" IS NOT NULL) AS "linkedPrices",
         (SELECT count(*)::text FROM "PriceObservation" WHERE "retailProductId" IS NULL) AS "legacyPrices",
         (SELECT count(*)::text FROM "RetailProduct" WHERE "mappingStatus" = 'NEEDS_PRODUCT_MAPPING') AS "needsMapping",
         (SELECT count(*)::text FROM "Product" WHERE "packageSize" IS NOT NULL) AS "legacyPackage"`,
    );
    const row = stats.rows[0]!;
    const report = {
      package: 'RP2-01B',
      steps: ['STEP_198', 'STEP_199'],
      generatedAt: new Date().toISOString(),
      productsWithRoles: Number(row.roles),
      productsWithoutRoles: Number(row.withoutRoles),
      substitutionsTotal: Number(row.substitutions),
      substitutionsNeedsReview: Number(row.needsReview),
      retailProductsCreated: Number(row.retail),
      priceObservationsLinked: Number(row.linkedPrices),
      priceObservationsLegacy: Number(row.legacyPrices),
      retailNeedsProductMapping: Number(row.needsMapping),
      productsWithLegacyPackageFields: Number(row.legacyPackage),
      externalProductCompatibility: 'ExternalProduct/ProductMatch remain compatibility layer; RetailProduct is SoT for SKU prices',
      notes: [
        'No PII included.',
        'Product.packageSize/packageUnit retained as legacy until cleanup package.',
        'STEP_200–201 not started.',
      ],
    };
    const outDir = process.env.WEIGHT_APP_DISPOSABLE_MODE === '1'
      ? resolve(process.cwd(), '../../.data/verification/recipe-platform')
      : resolve(process.cwd(), '../../docs/recipe-platform');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'RP2_01B_BACKFILL_REPORT.json'), JSON.stringify(report, null, 2));
    expect(report.substitutionsTotal).toBeGreaterThan(0);
  });
});
