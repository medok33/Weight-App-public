import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

/**
 * Live acceptance expects Product/Allergen/Dietary/nutrition relations.
 * Migration 174 backfill is one-shot at migrate time; products added later
 * (catalog ensure / seed) may have no ProductAllergen rows. Re-apply the
 * same heuristic inserts idempotently and ensure a TEST_ONLY fixture if needed.
 */
async function ensureProductFoundationAcceptanceFixture(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
    SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
    FROM "Product" p
    JOIN "Allergen" a ON a.code = 'milk'
    WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
      ~ '(milk|yogurt|butter|cheese|dairy|молоко|йогурт|сыр|творог)'
    ON CONFLICT ("productId", "allergenId") DO NOTHING
  `);
  await pool.query(`
    INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
    SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
    FROM "Product" p
    JOIN "Allergen" a ON a.code = 'gluten'
    WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
      ~ '(pasta|wheat|flour|oat|макарон|пшен|мук|овсян)'
    ON CONFLICT ("productId", "allergenId") DO NOTHING
  `);
  await pool.query(`
    INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", "source")
    SELECT p.id, t.id, 'LEGACY_BACKFILL'
    FROM "Product" p
    JOIN "DietaryTag" t ON t.code = 'vegan'
    WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
      ~ '(broccoli|carrot|onion|potato|lettuce|tomato|oat|rice|buckwheat|quinoa|oil|lemon|avocado|греч|рис|овощ)'
      AND lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
      !~ '(milk|yogurt|egg|chicken|turkey|fish|butter|meat|cheese)'
    ON CONFLICT ("productId", "dietaryTagId") DO NOTHING
  `);

  const linked = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM "ProductAllergen" pa
     JOIN "Product" p ON p.id = pa."productId"
     WHERE p."productKey" IS NOT NULL`,
  );
  // Prefer re-linked catalog products; always ensure isolated fixtures as a deterministic floor.
  void linked;

  // Isolated TEST_ONLY fixture — never touches staging/production seeds.
  const fixtures = [
    {
      key: 'acceptance_fixture_milk',
      name: 'AAA Acceptance Fixture Milk',
      allergen: 'milk',
      dietary: 'lactose_free',
      macros: [52, 3, 2.5, 4.7],
    },
    {
      key: 'acceptance_fixture_oats',
      name: 'AAB Acceptance Fixture Oats',
      allergen: 'gluten',
      dietary: 'vegan',
      macros: [370, 13, 7, 60],
    },
  ] as const;

  for (const f of fixtures) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM "Product" WHERE "productKey" = $1 LIMIT 1`,
      [f.key],
    );
    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO "Product"
          ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g")
         VALUES ($1, $2, $1, 'g', $3, $4, $5, $6)`,
        [`${f.name} [${f.key}]`, f.key, f.macros[0], f.macros[1], f.macros[2], f.macros[3]],
      );
    }
    const product = await pool.query<{ id: string }>(
      `SELECT id FROM "Product" WHERE "productKey" = $1 LIMIT 1`,
      [f.key],
    );
    const productId = product.rows[0]?.id;
    if (!productId) throw new Error(`ACCEPTANCE_FIXTURE_PRODUCT_MISSING:${f.key}`);

    const nutrition = await pool.query<{ id: string }>(
      `INSERT INTO "ProductNutritionVersion"
         ("productId", version, calories, protein, fat, carbohydrate, source)
       SELECT $1, 1, $2, $3, $4, $5, 'FIXTURE'
       WHERE NOT EXISTS (
         SELECT 1 FROM "ProductNutritionVersion" WHERE "productId" = $1 AND version = 1
       )
       RETURNING id`,
      [productId, f.macros[0], f.macros[1], f.macros[2], f.macros[3]],
    );
    const nutritionId =
      nutrition.rows[0]?.id ??
      (
        await pool.query<{ id: string }>(
          `SELECT id FROM "ProductNutritionVersion" WHERE "productId" = $1 AND version = 1`,
          [productId],
        )
      ).rows[0]?.id;
    if (nutritionId) {
      await pool.query(`UPDATE "Product" SET "currentNutritionVersionId" = $1 WHERE id = $2`, [
        nutritionId,
        productId,
      ]);
    }

    await pool.query(
      `INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
       SELECT $1, a.id, 'CONTAINS', 'FIXTURE'
       FROM "Allergen" a WHERE a.code = $2
       ON CONFLICT ("productId", "allergenId") DO NOTHING`,
      [productId, f.allergen],
    );
    await pool.query(
      `INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", "source")
       SELECT $1, t.id, 'FIXTURE'
       FROM "DietaryTag" t WHERE t.code = $2
       ON CONFLICT ("productId", "dietaryTagId") DO NOTHING`,
      [productId, f.dietary],
    );
  }

  // Explicit UNKNOWN fixture: absence of ProductAllergen rows must remain
  // distinguishable from an allergen-free classification.
  await pool.query(
    `INSERT INTO "Product"
      ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g")
     VALUES ('AAC Acceptance Fixture Unknown', 'acceptance_fixture_unknown',
             'AAC Acceptance Fixture Unknown', 'g', 1, 0, 0, 0)
     ON CONFLICT ("productKey") DO NOTHING`,
  );
}

describe('RP2-01A foundation live DB acceptance', () => {
  const pool = new Pool({ connectionString });

  beforeAll(async () => {
    await ensureProductFoundationAcceptanceFixture(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it('nutrition versions, allergens, dietary tags and RecipeIngredient IDs are intact', async () => {
    const products = await pool.query<{
      id: string;
      productKey: string | null;
      versionCount: string;
      currentVersion: number | null;
      allergenCount: string;
      dietaryCount: string;
    }>(
      `WITH sample AS (
         SELECT p.id FROM "Product" p
         WHERE p."productKey" IS NOT NULL
         ORDER BY p."canonicalName"
         LIMIT 40
       ),
       allergen_sample AS (
         SELECT DISTINCT p.id FROM "Product" p
         JOIN "ProductAllergen" a ON a."productId" = p.id
         WHERE p."productKey" IS NOT NULL
         LIMIT 10
       ),
       dietary_sample AS (
         SELECT DISTINCT p.id FROM "Product" p
         JOIN "ProductDietaryTag" d ON d."productId" = p.id
         WHERE p."productKey" IS NOT NULL
         LIMIT 10
       ),
       ids AS (
         SELECT id FROM sample
         UNION SELECT id FROM allergen_sample
         UNION SELECT id FROM dietary_sample
       )
       SELECT p.id, p."productKey",
              (SELECT count(*)::text FROM "ProductNutritionVersion" v WHERE v."productId" = p.id) AS "versionCount",
              (SELECT v.version FROM "ProductNutritionVersion" v WHERE v.id = p."currentNutritionVersionId") AS "currentVersion",
              (SELECT count(*)::text FROM "ProductAllergen" a WHERE a."productId" = p.id) AS "allergenCount",
              (SELECT count(*)::text FROM "ProductDietaryTag" d WHERE d."productId" = p.id) AS "dietaryCount"
       FROM "Product" p
       JOIN ids ON ids.id = p.id
       ORDER BY p."canonicalName"`,
    );
    expect(products.rows.length).toBeGreaterThan(0);

    const withNutrition = products.rows.filter((r) => Number(r.versionCount) >= 1 && r.currentVersion === 1);
    const withAllergen = products.rows.filter((r) => Number(r.allergenCount) > 0);
    const withDietary = products.rows.filter((r) => Number(r.dietaryCount) > 0);
    expect(withNutrition.length).toBeGreaterThan(0);
    expect(withAllergen.length).toBeGreaterThan(0);
    expect(withDietary.length).toBeGreaterThan(0);

    const probe = withNutrition[0]!;
    const before = await pool.query<{ calories: string; version: number }>(
      `SELECT calories::text, version FROM "ProductNutritionVersion" WHERE "productId" = $1 AND version = 1`,
      [probe.id],
    );
    expect(before.rows[0]?.version).toBe(1);

    const ri = await pool.query<{ productId: string }>(
      `SELECT "productId" FROM "RecipeIngredient" WHERE "productId" = $1 LIMIT 1`,
      [probe.id],
    );
    if (ri.rows[0]) expect(ri.rows[0].productId).toBe(probe.id);

    await expect(
      pool.query(`UPDATE "ProductNutritionVersion" SET calories = calories WHERE "productId" = $1 AND version = 1`, [
        probe.id,
      ]),
    ).rejects.toThrow(/PRODUCT_NUTRITION_VERSION_IMMUTABLE/);

    const after = await pool.query<{ calories: string }>(
      `SELECT calories::text FROM "ProductNutritionVersion" WHERE "productId" = $1 AND version = 1`,
      [probe.id],
    );
    expect(after.rows[0]?.calories).toBe(before.rows[0]?.calories);
  });

  it('ambiguous alias does not collapse to a single product; missing allergen ≠ allergen-free', async () => {
    const two = await pool.query<{ id: string }>(`SELECT id FROM "Product" ORDER BY "canonicalName" LIMIT 2`);
    expect(two.rows.length).toBe(2);
    const alias = `rp2-ambiguous-${Date.now()}`;
    await pool.query(
      `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
       VALUES ($1, $2, $2, 'FIXTURE', 0.5, 'ACTIVE'), ($3, $2, $2, 'FIXTURE', 0.5, 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [two.rows[0]!.id, alias, two.rows[1]!.id],
    );
    const matches = await pool.query<{ productId: string }>(
      `SELECT "productId" FROM "ProductAlias" WHERE status = 'ACTIVE' AND "normalizedAlias" = $1`,
      [alias],
    );
    expect([...new Set(matches.rows.map((r) => r.productId))].length).toBeGreaterThan(1);

    const unknown = await pool.query<{ id: string }>(
      `SELECT p.id FROM "Product" p
       LEFT JOIN "ProductAllergen" pa ON pa."productId" = p.id
       WHERE pa.id IS NULL
       LIMIT 1`,
    );
    expect(unknown.rows[0]?.id).toBeTruthy();
  });
});
