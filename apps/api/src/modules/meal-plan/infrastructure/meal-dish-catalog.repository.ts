import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { STEP092_PRODUCTS, STEP092_RECIPES } from '../domain/meal-dish.fixture';
import { STEP093_PRODUCTS, STEP093_RECIPES } from '../domain/substitution.fixture';

type FixtureProduct = {
  id: string;
  productKey: string;
  canonicalName: string;
  unit: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  packageSize: number;
  packageUnit: string;
  unitPriceRub: number | null;
};

type FixtureRecipe = {
  id: string;
  recipeKey: string;
  name: string;
  description: string;
  servings: number;
  portionGrams: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: string;
  allergens: readonly string[];
  dietaryTags: readonly string[];
  equipment: readonly string[];
  ingredients: readonly { productId: string; amount: number; unit: string }[];
  steps: readonly {
    stepIndex: number;
    instruction: string;
    durationMinutes?: number;
    temperatureC?: number;
    equipment?: string;
  }[];
};

const ALL_PRODUCTS: FixtureProduct[] = [
  ...STEP092_PRODUCTS.map((p) => ({ ...p, unitPriceRub: p.unitPriceRub })),
  ...STEP093_PRODUCTS.map((p) => ({ ...p, unitPriceRub: p.unitPriceRub })),
];

const ALL_RECIPES: FixtureRecipe[] = [
  ...STEP092_RECIPES.map((r) => ({
    ...r,
    allergens: [...r.allergens],
    dietaryTags: [...r.dietaryTags],
    equipment: [...r.equipment],
    ingredients: r.ingredients.map((i) => ({ ...i })),
    steps: r.steps.map((s) => ({ ...s })),
  })),
  ...STEP093_RECIPES.map((r) => ({
    ...r,
    allergens: [...r.allergens],
    dietaryTags: [...r.dietaryTags],
    equipment: [...r.equipment],
    ingredients: r.ingredients.map((i) => ({ ...i })),
    steps: r.steps.map((s) => ({ ...s })),
  })),
];

@Injectable()
export class MealDishCatalogRepository {
  private seeded = false;
  private seedInFlight: Promise<void> | null = null;

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async ensureCatalog(): Promise<void> {
    if (this.seeded) return;
    if (!this.seedInFlight) {
      this.seedInFlight = this.seedCatalog()
        .then(() => {
          this.seeded = true;
        })
        .finally(() => {
          this.seedInFlight = null;
        });
    }
    await this.seedInFlight;
  }

  private async seedCatalog(): Promise<void> {
    for (const product of ALL_PRODUCTS) {
      await this.db.query(
        `INSERT INTO "Product"
          (id, "canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g", "packageSize", "packageUnit")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT ("productKey") DO UPDATE SET
           name = COALESCE("Product".name, EXCLUDED.name),
           unit = COALESCE(NULLIF(BTRIM("Product".unit), ''), EXCLUDED.unit),
           "packageSize" = COALESCE("Product"."packageSize", EXCLUDED."packageSize"),
           "packageUnit" = COALESCE("Product"."packageUnit", EXCLUDED."packageUnit")`,
        [
          product.id,
          product.canonicalName,
          product.productKey,
          product.canonicalName,
          product.unit,
          product.caloriesPer100g,
          product.proteinPer100g,
          product.fatPer100g,
          product.carbsPer100g,
          product.packageSize,
          product.packageUnit,
        ],
      );
    }

    await this.syncProductFoundation(ALL_PRODUCTS);

    const productIds = new Map<string, string>();
    for (const product of ALL_PRODUCTS) {
      const row = await this.db.query<{ id: string }>(
        'SELECT id FROM "Product" WHERE "productKey" = $1 LIMIT 1',
        [product.productKey],
      );
      if (row.rows[0]?.id) productIds.set(product.productKey, row.rows[0].id);
    }

    const store = await this.db.query<{ id: string; retailerId: string }>(
      `SELECT s.id, s."retailerId"
       FROM "RetailStore" s
       JOIN "Retailer" r ON r.id = s."retailerId"
       WHERE r."key" = 'step092_fixture'
       LIMIT 1`,
    );
    const storeId = store.rows[0]?.id;
    const retailerId = store.rows[0]?.retailerId;

    for (const product of ALL_PRODUCTS) {
      if (product.unitPriceRub == null || !storeId) continue;
      const productId = productIds.get(product.productKey) ?? product.id;
      let retailProductId: string | null = null;
      if (retailerId) {
        const hasRetail = await this.db.query<{ ok: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'RetailProduct'
           ) AS ok`,
        );
        if (hasRetail.rows[0]?.ok) {
          const sku = `FIX-${product.productKey}`;
          const existingRp = await this.db.query<{ id: string }>(
            `SELECT id FROM "RetailProduct"
             WHERE "retailerId" = $1 AND "externalSku" = $2 AND status <> 'MERGED'
             LIMIT 1`,
            [retailerId, sku],
          );
          if (existingRp.rows[0]) {
            retailProductId = existingRp.rows[0].id;
          } else {
            const inserted = await this.db.query<{ id: string }>(
              `INSERT INTO "RetailProduct"
                ("retailerId", "canonicalProductId", "externalSku", title,
                 "packageWeight", "packageUnit", status, "mappingStatus", source, "lastMatchedAt")
               VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','MAPPED','FIXTURE', now())
               RETURNING id`,
              [
                retailerId,
                productId,
                sku,
                product.canonicalName,
                product.packageSize,
                product.packageUnit,
              ],
            );
            retailProductId = inserted.rows[0]?.id ?? null;
          }
        }
      }

      const existing = await this.db.query<{ id: string; retailProductId: string | null }>(
        `SELECT id, ${
          retailProductId != null
            ? '"retailProductId"::text AS "retailProductId"'
            : 'NULL::text AS "retailProductId"'
        }
         FROM "PriceObservation" WHERE "productId" = $1
         ORDER BY COALESCE("collectedAt","observedAt") DESC LIMIT 1`,
        [productId],
      );
      if (existing.rows[0]) {
        if (retailProductId && !existing.rows[0].retailProductId) {
          await this.db.query(
            `UPDATE "PriceObservation"
             SET "retailProductId" = $2,
                 "observedPackageWeight" = COALESCE("observedPackageWeight", $3),
                 "observedPackageUnit" = COALESCE("observedPackageUnit", $4)
             WHERE id = $1 AND "retailProductId" IS NULL`,
            [existing.rows[0].id, retailProductId, product.packageSize, product.packageUnit],
          ).catch(() => undefined);
        }
        continue;
      }
      if (retailProductId) {
        await this.db.query(
          `INSERT INTO "PriceObservation"
            ("productId", "storeId", price, "observedAt", source, currency, "sourceType", "sourceName",
             "retailerId", "collectedAt", "retailProductId", "observedPackageWeight", "observedPackageUnit", availability, "dataClass")
           VALUES ($1,$2,$3, now(), 'step092_fixture', 'RUB', 'MANUAL', 'STEP092/093 fixture',
                   $4, now(), $5, $6, $7, 'IN_STOCK', 'FIXTURE')`,
          [
            productId,
            storeId,
            product.unitPriceRub,
            retailerId,
            retailProductId,
            product.packageSize,
            product.packageUnit,
          ],
        );
      } else {
        await this.db.query(
          `INSERT INTO "PriceObservation"
            ("productId", "storeId", price, "observedAt", source, currency, "sourceType", "sourceName", "retailerId", "collectedAt", "dataClass")
           VALUES ($1,$2,$3, now(), 'step092_fixture', 'RUB', 'MANUAL', 'STEP092/093 fixture', $4, now(), 'FIXTURE')`,
          [productId, storeId, product.unitPriceRub, retailerId],
        );
      }
    }

    await this.syncCulinaryRolesAndSubstitutions(ALL_PRODUCTS);

    await this.db.withTransaction(async (q) => {
      await q('SELECT pg_advisory_xact_lock(19319701)');
      for (const recipe of ALL_RECIPES) {
        const existing = await q<{ id: string }>(
          `SELECT id FROM "Recipe" WHERE id = $1 OR "recipeKey" = $2 LIMIT 1`,
          [recipe.id, recipe.recipeKey],
        );
        const forceRewrite = process.env.ALLOW_MEAL_FIXTURE_FORCE === '1';
        if (existing.rows[0] && !forceRewrite) {
          // F0 risk + deadlock avoidance: do not rewrite live Recipe / ingredients / steps.
          continue;
        }

        await q(
          `INSERT INTO "Recipe"
            (id, name, servings, description, "prepMinutes", "cookMinutes", difficulty, "portionGrams", allergens, "dietaryTags", equipment, "recipeKey")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)
           ON CONFLICT (id) DO UPDATE SET
             description = EXCLUDED.description,
             "prepMinutes" = EXCLUDED."prepMinutes",
             "cookMinutes" = EXCLUDED."cookMinutes",
             "portionGrams" = EXCLUDED."portionGrams",
             allergens = EXCLUDED.allergens,
             "dietaryTags" = EXCLUDED."dietaryTags",
             equipment = EXCLUDED.equipment,
             "recipeKey" = EXCLUDED."recipeKey"`,
          [
            recipe.id,
            recipe.name,
            recipe.servings,
            recipe.description,
            recipe.prepMinutes,
            recipe.cookMinutes,
            recipe.difficulty,
            recipe.portionGrams,
            JSON.stringify(recipe.allergens),
            JSON.stringify(recipe.dietaryTags),
            JSON.stringify(recipe.equipment),
            recipe.recipeKey,
          ],
        );

        await q('DELETE FROM "RecipeIngredient" WHERE "recipeId" = $1', [recipe.id]);
        for (const ingredient of recipe.ingredients) {
          const fixtureProduct = ALL_PRODUCTS.find((item) => item.id === ingredient.productId);
          const productId = productIds.get(fixtureProduct?.productKey ?? '') ?? ingredient.productId;
          await q(
            `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit)
             VALUES ($1,$2,$3,$4)`,
            [recipe.id, productId, ingredient.amount, ingredient.unit],
          );
        }

        await q('DELETE FROM "RecipeStep" WHERE "recipeId" = $1', [recipe.id]);
        for (const step of recipe.steps) {
          await q(
            `INSERT INTO "RecipeStep" ("recipeId", "stepIndex", instruction, "durationMinutes", "temperatureC", equipment)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT ("recipeId", "stepIndex") DO UPDATE SET
               instruction = EXCLUDED.instruction,
               "durationMinutes" = EXCLUDED."durationMinutes",
               "temperatureC" = EXCLUDED."temperatureC",
               equipment = EXCLUDED.equipment`,
            [
              recipe.id,
              step.stepIndex,
              step.instruction,
              step.durationMinutes ?? null,
              step.temperatureC ?? null,
              step.equipment ?? null,
            ],
          );
        }
      }

      // Ensure every Recipe with ingredients has at least one usable RecipeVersion (idempotent).
      const hasVersionTable = await q<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'RecipeVersion'
         ) AS ok`,
      );
      if (hasVersionTable.rows[0]?.ok) {
        await q(
          `WITH ordered_ing AS (
             SELECT
               ri."recipeId",
               ri."productId",
               ri.quantity,
               ri.unit,
               COALESCE(p."canonicalName", p.name, ri."productId"::text) AS display_name,
               ROW_NUMBER() OVER (PARTITION BY ri."recipeId" ORDER BY ri.id) AS ordering
             FROM "RecipeIngredient" ri
             LEFT JOIN "Product" p ON p.id = ri."productId"
           ),
           ing AS (
             SELECT
               oi."recipeId",
               COALESCE(jsonb_agg(
                 jsonb_build_object(
                   'productId', oi."productId",
                   'canonicalProductId', oi."productId",
                   'displayName', oi.display_name,
                   'amount', oi.quantity,
                   'unit', oi.unit,
                   'ordering', oi.ordering
                 ) ORDER BY oi.ordering
               ), '[]'::jsonb) AS ingredients_json
             FROM ordered_ing oi
             GROUP BY oi."recipeId"
           ),
           steps AS (
             SELECT
               rs."recipeId",
               COALESCE(jsonb_agg(
                 jsonb_build_object(
                   'stepIndex', rs."stepIndex",
                   'instruction', rs.instruction,
                   'durationMinutes', rs."durationMinutes",
                   'temperatureC', rs."temperatureC",
                   'equipment', rs.equipment
                 ) ORDER BY rs."stepIndex"
               ), '[]'::jsonb) AS steps_json
             FROM "RecipeStep" rs
             GROUP BY rs."recipeId"
           )
           INSERT INTO "RecipeVersion" (
             "recipeId", "versionNumber", status,
             "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
             "nutritionSnapshotJson", "restrictionSnapshotJson",
             servings, "servingWeightGrams", "changeType", "changeReason",
             "publishedAt", checksum, provenance
           )
           SELECT
             r.id,
             1,
             'LEGACY_BACKFILL',
             jsonb_build_object(
               'title', r.name,
               'description', r.description,
               'servings', r.servings,
               'prepMinutes', r."prepMinutes",
               'cookMinutes', r."cookMinutes",
               'difficulty', r.difficulty,
               'portionGrams', r."portionGrams",
               'equipment', COALESCE(r.equipment, '[]'::jsonb),
               'recipeKey', r."recipeKey",
               'allergens', COALESCE(r.allergens, '[]'::jsonb),
               'dietaryTags', COALESCE(r."dietaryTags", '[]'::jsonb)
             ),
             COALESCE(ing.ingredients_json, '[]'::jsonb),
             COALESCE(steps.steps_json, '[]'::jsonb),
             jsonb_build_object(
               'calories', 0, 'proteinG', 0, 'fatG', 0, 'carbsG', 0,
               'basis', 'per_recipe_servings', 'source', 'FIXTURE_ENSURE'
             ),
             jsonb_build_object(
               'allergens', COALESCE(r.allergens, '[]'::jsonb),
               'dietaryTags', COALESCE(r."dietaryTags", '[]'::jsonb)
             ),
             GREATEST(r.servings, 1),
             r."portionGrams",
             'FIXTURE',
             'ensureCatalog missing version bootstrap',
             now(),
             md5(r.id::text || COALESCE(r."recipeKey", '') || r.name),
             'FIXTURE'
           FROM "Recipe" r
           LEFT JOIN ing ON ing."recipeId" = r.id
           LEFT JOIN steps ON steps."recipeId" = r.id
           WHERE NOT EXISTS (SELECT 1 FROM "RecipeVersion" v WHERE v."recipeId" = r.id)
             AND EXISTS (SELECT 1 FROM "RecipeIngredient" ri WHERE ri."recipeId" = r.id)`,
        );

        await q(
          `UPDATE "Recipe" r
           SET "currentVersionId" = v.id
           FROM "RecipeVersion" v
           WHERE v."recipeId" = r.id
             AND r."currentVersionId" IS NULL
             AND v."versionNumber" = (
               SELECT MAX(v2."versionNumber") FROM "RecipeVersion" v2 WHERE v2."recipeId" = r.id
             )`,
        );

        // Deterministic RecipeFamily backfill (no LLM; ambiguous stays UNASSIGNED/null).
        await q(
          `INSERT INTO "RecipeFamily" ("canonicalName", slug, "dishType", "primaryProductId", status)
           SELECT 'Курица с гарниром', 'chicken-with-side', 'MAIN', p.id, 'ACTIVE'
           FROM "Product" p
           WHERE p."productKey" = 'chicken_breast' AND p.status <> 'MERGED'
           AND NOT EXISTS (SELECT 1 FROM "RecipeFamily" WHERE slug = 'chicken-with-side')
           LIMIT 1`,
        );
        await q(
          `INSERT INTO "RecipeFamily" ("canonicalName", slug, "dishType", status)
           SELECT 'Курица с гарниром', 'chicken-with-side', 'MAIN', 'ACTIVE'
           WHERE NOT EXISTS (SELECT 1 FROM "RecipeFamily" WHERE slug = 'chicken-with-side')`,
        );
        await q(
          `UPDATE "Recipe" r
           SET "recipeFamilyId" = f.id
           FROM "RecipeFamily" f
           WHERE f.slug = 'chicken-with-side'
             AND r."recipeKey" IN ('buckwheat_chicken', 'potato_chicken')
             AND (r."recipeFamilyId" IS NULL OR r."recipeFamilyId" = f.id)`,
        );
      }
    });

    this.seeded = true;
  }

  /**
   * RP2-01A: sync category/form/nutrition/allergens for fixture products without rewriting live macros
   * when a nutrition version already exists.
   */
  private async syncProductFoundation(products: FixtureProduct[]): Promise<void> {
    const hasCategory = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ProductCategory'
       ) AS ok`,
    );
    if (!hasCategory.rows[0]?.ok) return;

    const pending = await this.db.query<{ id: string }>(
      `SELECT p.id
       FROM "Product" p
       WHERE p.id = ANY($1::uuid[])
         AND (p."categoryId" IS NULL OR p."currentNutritionVersionId" IS NULL)`,
      [products.map((p) => p.id)],
    );
    const pendingIds = new Set(pending.rows.map((r) => r.id));
    const toSync = products.filter((p) => pendingIds.has(p.id));
    // Always refresh allergen/tag links cheaply when foundation tables exist.
    const allergenTargets = toSync.length ? toSync : products.slice(0, 0);

    for (const product of toSync.length ? toSync : []) {
      await this.db.query(
        `UPDATE "Product" p
         SET "categoryId" = COALESCE(p."categoryId", c.id),
             form = COALESCE(p.form, $2),
             "defaultUnit" = COALESCE(p."defaultUnit", $3),
             "updatedAt" = now()
         FROM "ProductCategory" c
         WHERE p.id = $1 AND c.code = $4`,
        [
          product.id,
          /oat|rice|buckwheat|quinoa|pasta/i.test(product.productKey) ? 'DRY' : 'RAW',
          product.unit === 'ml' ? 'ml' : product.unit === 'piece' ? 'piece' : 'g',
          inferCategoryCode(product),
        ],
      );

      await this.db.query(
        `INSERT INTO "ProductNutritionVersion"
          ("productId", version, calories, protein, fat, carbohydrate, source, "validFrom")
         VALUES ($1, 1, $2, $3, $4, $5, 'FIXTURE', now())
         ON CONFLICT ("productId", version) DO NOTHING`,
        [product.id, product.caloriesPer100g, product.proteinPer100g, product.fatPer100g, product.carbsPer100g],
      );
      await this.db.query(
        `UPDATE "Product" p
         SET "currentNutritionVersionId" = v.id, "updatedAt" = now()
         FROM "ProductNutritionVersion" v
         WHERE p.id = $1 AND v."productId" = p.id AND p."currentNutritionVersionId" IS NULL
           AND v.version = (SELECT MAX(version) FROM "ProductNutritionVersion" WHERE "productId" = p.id)`,
        [product.id],
      );
    }

    for (const product of toSync.length ? toSync : allergenTargets) {
      const allergens = inferFixtureAllergens(product);
      for (const code of allergens) {
        await this.db.query(
          `INSERT INTO "ProductAllergen" ("productId", "allergenId", presence, source)
           SELECT $1, a.id, 'CONTAINS', 'FIXTURE'
           FROM "Allergen" a WHERE a.code = $2
           ON CONFLICT ("productId", "allergenId") DO NOTHING`,
          [product.id, code],
        );
      }
      const tags = inferFixtureDietaryTags(product);
      for (const code of tags) {
        await this.db.query(
          `INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", source)
           SELECT $1, t.id, 'FIXTURE'
           FROM "DietaryTag" t WHERE t.code = $2
           ON CONFLICT ("productId", "dietaryTagId") DO NOTHING`,
          [product.id, code],
        );
      }
    }
  }

  async findRecipeIdByKey(recipeKey: string): Promise<string | null> {
    await this.ensureCatalog();
    const result = await this.db.query<{ id: string }>(
      'SELECT id FROM "Recipe" WHERE "recipeKey" = $1 LIMIT 1',
      [recipeKey],
    );
    return result.rows[0]?.id ?? null;
  }

  private async syncCulinaryRolesAndSubstitutions(products: FixtureProduct[]): Promise<void> {
    const hasRoles = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'CulinaryRole'
       ) AS ok`,
    );
    if (!hasRoles.rows[0]?.ok) return;

    for (const product of products) {
      const code = inferCulinaryRoleCode(product);
      if (!code) continue;
      await this.db.query(
        `INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", source, confidence)
         SELECT $1, r.id, true, 'FIXTURE', 0.95
         FROM "CulinaryRole" r
         WHERE r.code = $2
         ON CONFLICT ("productId", "culinaryRoleId") DO NOTHING`,
        [product.id, code],
      );
    }

    const hasSubs = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ProductSubstitution'
       ) AS ok`,
    );
    if (!hasSubs.rows[0]?.ok) return;

    // Mirror migration 176 STEP_093 fixtures after products exist (fresh CI DBs
    // apply 176 before Product rows, so SQL seed joins are no-ops otherwise).
    await this.db.query(
      `INSERT INTO "ProductSubstitution" (
         "sourceProductId", "replacementProductId", "culinaryRoleId",
         "replacementRatio", "replacementRatioMin", "replacementRatioMax",
         "nutritionImpact", "textureImpact", "supportedMethods",
         status, source, confidence, "reviewedAt"
       )
       SELECT src.id, dst.id, role.id, 1.0, 0.8, 1.25, 'SIMILAR', 'NOTICEABLE',
              ARRAY['BOIL','STEW','STEAM']::text[], 'ACTIVE', 'FIXTURE', 0.95, now()
       FROM "Product" src
       JOIN "Product" dst ON dst."productKey" = 'step093_white_rice'
       JOIN "CulinaryRole" role ON role.code = 'STARCH'
       WHERE src."productKey" = 'step093_buckwheat'
         AND NOT EXISTS (
           SELECT 1 FROM "ProductSubstitution" ps
           WHERE ps."sourceProductId" = src.id AND ps."replacementProductId" = dst.id
             AND ps."culinaryRoleId" IS NOT DISTINCT FROM role.id
             AND ps.status IN ('ACTIVE','NEEDS_REVIEW','SUSPENDED')
         )`,
    );

    // Method-incompatible ACTIVE edge: buckwheat → potato only for BLEND.
    await this.db.query(
      `INSERT INTO "ProductSubstitution" (
         "sourceProductId", "replacementProductId", "culinaryRoleId",
         "replacementRatio", "replacementRatioMin", "replacementRatioMax",
         "nutritionImpact", "textureImpact", "supportedMethods",
         status, source, confidence, "reviewedAt"
       )
       SELECT src.id, dst.id, role.id, 1.2, 1.0, 1.5, 'VARIABLE', 'MAJOR',
              ARRAY['BLEND']::text[], 'ACTIVE', 'FIXTURE', 0.80, now()
       FROM "Product" src
       JOIN "Product" dst ON dst."productKey" = 'step093_potato'
       JOIN "CulinaryRole" role ON role.code = 'STARCH'
       WHERE src."productKey" = 'step093_buckwheat'
         AND NOT EXISTS (
           SELECT 1 FROM "ProductSubstitution" ps
           WHERE ps."sourceProductId" = src.id AND ps."replacementProductId" = dst.id
             AND ps."culinaryRoleId" IS NOT DISTINCT FROM role.id
             AND ps.status IN ('ACTIVE','NEEDS_REVIEW','SUSPENDED')
         )`,
    );
  }
}

function inferCulinaryRoleCode(product: FixtureProduct): string | null {
  const key = `${product.productKey} ${product.canonicalName}`.toLowerCase();
  if (/chicken|turkey|fish|egg|yogurt|meat|куриц|индей|рыб|яйц/.test(key)) return 'MAIN_PROTEIN';
  if (/rice|buckwheat|oat|quinoa|pasta|potato|греч|рис|овсян|макарон|картоф/.test(key)) return 'STARCH';
  if (/broccoli|carrot|onion|lettuce|tomato|овощ|брокк|морков/.test(key)) return 'VEGETABLE_BASE';
  if (/oil|butter|fat|масл|avocado/.test(key)) return 'FAT';
  if (/honey|lemon|лимон/.test(key)) return 'ACID';
  if (/milk|молоко|plant_milk/.test(key)) return 'MOISTURE_SOURCE';
  if (/peanut/.test(key)) return 'BINDER';
  return null;
}

function inferCategoryCode(product: FixtureProduct): string {
  const key = `${product.productKey} ${product.canonicalName}`.toLowerCase();
  if (/yogurt|milk|butter|cheese|dairy/.test(key)) return 'dairy';
  if (/egg/.test(key)) return 'eggs';
  if (/fish|salmon|tuna/.test(key)) return 'fish_seafood';
  if (/chicken|turkey|beef|pork|meat/.test(key)) return 'meat_poultry';
  if (/pasta|noodle/.test(key)) return 'pasta';
  if (/oat|rice|buckwheat|quinoa/.test(key)) return 'grains';
  if (/broccoli|carrot|onion|potato|lettuce|tomato/.test(key)) return 'vegetables';
  if (/lemon|avocado|apple|banana/.test(key)) return 'fruits';
  if (/oil/.test(key)) return 'oils_fats';
  if (/sauce/.test(key)) return 'sauces';
  if (/peanut/.test(key)) return 'legumes';
  return 'UNCLASSIFIED';
}

function inferFixtureAllergens(product: FixtureProduct): string[] {
  const key = product.productKey.toLowerCase();
  const out: string[] = [];
  if (/yogurt|milk|butter|cheese/.test(key)) out.push('milk');
  if (/egg/.test(key)) out.push('eggs');
  if (/fish/.test(key)) out.push('fish');
  if (/pasta|oat|wheat|flour/.test(key)) out.push('gluten');
  if (/peanut/.test(key)) out.push('peanuts');
  const withAllergens = product as FixtureProduct & { allergens?: string[] };
  for (const a of withAllergens.allergens ?? []) {
    if (a === 'dairy') out.push('milk');
    else if (a === 'egg') out.push('eggs');
    else if (a === 'peanut') out.push('peanuts');
    else out.push(a);
  }
  return [...new Set(out)];
}

function inferFixtureDietaryTags(product: FixtureProduct): string[] {
  const withTags = product as FixtureProduct & { dietaryTags?: string[] };
  return [...new Set((withTags.dietaryTags ?? []).map((t) => t.replace(/-/g, '_')))];
}

