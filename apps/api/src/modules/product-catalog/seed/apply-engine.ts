import type { Pool, PoolClient } from 'pg';
import { normalizeProductAlias } from '../domain/product-foundation.policy';
import type {
  CatalogSeedManifest,
  ProductSeedRecord,
  SeedApplyReport,
  SeedConflict,
} from './seed.types';
import { validateManifest } from './validate-manifest';

type SqlClient = Pool | PoolClient;

type ExistingProduct = {
  id: string;
  productKey: string | null;
  canonicalName: string;
  categoryCode: string | null;
  form: string | null;
  defaultUnit: string | null;
  status: string;
  reviewStatus: string;
  seedDatasetVersion: string | null;
  caloriesPer100g: string;
  proteinPer100g: string;
  fatPer100g: string | null;
  carbsPer100g: string | null;
  currentNutritionVersionId: string | null;
  currentCal: string | null;
  currentProt: string | null;
  currentFat: string | null;
  currentCarb: string | null;
};

function emptyReport(
  manifest: CatalogSeedManifest,
  mode: SeedApplyReport['mode'],
): SeedApplyReport {
  return {
    datasetVersion: manifest.datasetVersion,
    previousDatasetVersion: manifest.previousDatasetVersion ?? null,
    checksum: manifest.checksum,
    mode,
    status: 'OK',
    durationMs: 0,
    productCount: manifest.productCount,
    created: [],
    matchedExisting: [],
    updatedSoft: [],
    nutritionVersionsCreated: [],
    aliasesCreated: 0,
    allergensCreated: 0,
    dietaryTagsCreated: 0,
    rolesCreated: 0,
    conflicts: [],
    rejected: [],
    needsReview: [],
    categoriesCoverage: {},
    formsCoverage: {},
    legacyOutsideDataset: 0,
    legacyOutsidePilot: 0,
    duplicateCandidates: [],
    nutritionSources: {},
    notes: [],
  };
}

function numClose(a: number, b: number, eps = 0.051): boolean {
  return Math.abs(a - b) <= eps;
}

async function loadCategoryMap(client: SqlClient): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM "ProductCategory" WHERE status = 'ACTIVE'`,
  );
  return new Map(result.rows.map((r) => [r.code, r.id]));
}

async function loadCodeMap(
  client: SqlClient,
  table: 'Allergen' | 'DietaryTag' | 'CulinaryRole',
): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; code: string }>(`SELECT id, code FROM "${table}"`);
  return new Map(result.rows.map((r) => [r.code, r.id]));
}

async function findExisting(client: SqlClient, productKey: string): Promise<ExistingProduct | null> {
  const result = await client.query<ExistingProduct>(
    `SELECT p.id, p."productKey", p."canonicalName", pc.code AS "categoryCode", p.form, p."defaultUnit",
            p.status, p."reviewStatus", p."seedDatasetVersion",
            p."caloriesPer100g"::text, p."proteinPer100g"::text, p."fatPer100g"::text, p."carbsPer100g"::text,
            p."currentNutritionVersionId",
            nv.calories::text AS "currentCal", nv.protein::text AS "currentProt",
            nv.fat::text AS "currentFat", nv.carbohydrate::text AS "currentCarb"
     FROM "Product" p
     LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
     LEFT JOIN "ProductNutritionVersion" nv ON nv.id = p."currentNutritionVersionId"
     WHERE p."productKey" = $1
     LIMIT 1`,
    [productKey],
  );
  return result.rows[0] ?? null;
}

function detectFieldConflicts(existing: ExistingProduct, seed: ProductSeedRecord): SeedConflict[] {
  const conflicts: SeedConflict[] = [];
  if (existing.canonicalName !== seed.canonicalName) {
    // Soft: name divergence after OWNER edit — do not overwrite
    if (existing.seedDatasetVersion && existing.seedDatasetVersion !== seed.seedProvenance.datasetVersion) {
      conflicts.push({
        productKey: seed.productKey,
        code: 'SEED_CONFLICT_CANONICAL_NAME',
        message: 'Live canonicalName differs from seed; manual edit protected',
        before: existing.canonicalName,
        seed: seed.canonicalName,
      });
    } else if (!existing.seedDatasetVersion && existing.reviewStatus === 'RESOLVED') {
      conflicts.push({
        productKey: seed.productKey,
        code: 'SEED_CONFLICT_OWNER_RESOLVED',
        message: 'OWNER-resolved product name differs; skipped overwrite',
        before: existing.canonicalName,
        seed: seed.canonicalName,
      });
    }
  }
  if (existing.form && seed.form && existing.form !== seed.form && existing.reviewStatus === 'RESOLVED') {
    conflicts.push({
      productKey: seed.productKey,
      code: 'SEED_CONFLICT_FORM',
      message: 'OWNER-resolved form differs',
      before: existing.form,
      seed: seed.form,
    });
  }
  if (seed.nutrition && existing.currentNutritionVersionId) {
    const cur = {
      calories: Number(existing.currentCal),
      protein: Number(existing.currentProt),
      fat: Number(existing.currentFat),
      carbohydrate: Number(existing.currentCarb),
    };
    const n = seed.nutrition;
    const same =
      numClose(cur.calories, n.calories) &&
      numClose(cur.protein, n.protein) &&
      numClose(cur.fat, n.fat) &&
      numClose(cur.carbohydrate, n.carbohydrate);
    if (!same && existing.reviewStatus === 'RESOLVED') {
      conflicts.push({
        productKey: seed.productKey,
        code: 'SEED_CONFLICT_NUTRITION_OWNER',
        message: 'OWNER-reviewed nutrition differs; will not append silently',
        before: cur,
        seed: n,
      });
    }
  }
  return conflicts;
}

async function ensureAlias(
  client: SqlClient,
  productId: string,
  alias: string,
  source: string,
): Promise<'created' | 'exists' | 'ambiguous'> {
  const normalized = normalizeProductAlias(alias);
  const others = await client.query<{ productId: string }>(
    `SELECT "productId" FROM "ProductAlias"
     WHERE "normalizedAlias" = $1 AND status IN ('ACTIVE','NEEDS_REVIEW') AND "productId" <> $2
     LIMIT 2`,
    [normalized, productId],
  );
  if (others.rows.length > 0) {
    const mine = await client.query(
      `SELECT id FROM "ProductAlias" WHERE "productId"=$1 AND "normalizedAlias"=$2 LIMIT 1`,
      [productId, normalized],
    );
    if (!mine.rows[0]) {
      await client.query(
        `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
         VALUES ($1,$2,$3,$4,0.5,'NEEDS_REVIEW')`,
        [productId, alias, normalized, source],
      );
    }
    return 'ambiguous';
  }
  const existing = await client.query(
    `SELECT id FROM "ProductAlias" WHERE "productId"=$1 AND "normalizedAlias"=$2 LIMIT 1`,
    [productId, normalized],
  );
  if (existing.rows[0]) return 'exists';
  await client.query(
    `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
     VALUES ($1,$2,$3,$4,1.0,'ACTIVE')`,
    [productId, alias, normalized, source],
  );
  return 'created';
}

async function appendNutritionIfNeeded(
  client: SqlClient,
  productId: string,
  seed: ProductSeedRecord,
  existing: ExistingProduct | null,
  report: SeedApplyReport,
  dryRun: boolean,
): Promise<void> {
  if (!seed.nutrition) return;
  const n = seed.nutrition;
  if (existing?.currentNutritionVersionId) {
    const cur = {
      calories: Number(existing.currentCal),
      protein: Number(existing.currentProt),
      fat: Number(existing.currentFat),
      carbohydrate: Number(existing.currentCarb),
    };
    const same =
      numClose(cur.calories, n.calories) &&
      numClose(cur.protein, n.protein) &&
      numClose(cur.fat, n.fat) &&
      numClose(cur.carbohydrate, n.carbohydrate);
    if (same) return;
    const stubZero =
      cur.calories === 0 && cur.protein === 0 && cur.fat === 0 && cur.carbohydrate === 0;
    if (!stubZero && existing.reviewStatus === 'RESOLVED') {
      report.conflicts.push({
        productKey: seed.productKey,
        code: 'SEED_CONFLICT_NUTRITION_OWNER',
        message: 'OWNER-reviewed nutrition differs; will not append silently',
        before: cur,
        seed: n,
      });
      return;
    }
    if (!stubZero) {
      report.conflicts.push({
        productKey: seed.productKey,
        code: 'SEED_CONFLICT_NUTRITION',
        message: 'Existing nutrition version differs; append skipped (manual/OWNER decision required)',
        before: cur,
        seed: n,
      });
      return;
    }
    // Zero stub versions from legacy backfill may be superseded by sourced pilot nutrition.
  }

  // No current version: create v1 from seed (or next version if orphan history)
  if (dryRun) {
    report.nutritionVersionsCreated.push(seed.productKey);
    return;
  }
  const ver = await client.query<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0)::int AS v FROM "ProductNutritionVersion" WHERE "productId"=$1`,
    [productId],
  );
  const next = (ver.rows[0]?.v ?? 0) + 1;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO "ProductNutritionVersion"
      ("productId", version, calories, protein, fat, carbohydrate, fiber, sodium, source, "validFrom")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     RETURNING id`,
    [
      productId,
      next,
      n.calories,
      n.protein,
      n.fat,
      n.carbohydrate,
      n.fiber ?? null,
      n.sodium ?? null,
      n.source,
    ],
  );
  const nvId = inserted.rows[0]!.id;
  await client.query(
    `UPDATE "Product" SET
       "currentNutritionVersionId" = $2,
       "caloriesPer100g" = $3,
       "proteinPer100g" = $4,
       "fatPer100g" = $5,
       "carbsPer100g" = $6,
       "updatedAt" = now()
     WHERE id = $1`,
    [productId, nvId, n.calories, n.protein, n.fat, n.carbohydrate],
  );
  report.nutritionVersionsCreated.push(seed.productKey);
}

async function applyOne(
  client: SqlClient,
  seed: ProductSeedRecord,
  maps: {
    categories: Map<string, string>;
    allergens: Map<string, string>;
    dietary: Map<string, string>;
    roles: Map<string, string>;
  },
  report: SeedApplyReport,
  dryRun: boolean,
): Promise<void> {
  report.categoriesCoverage[seed.categoryCode] = (report.categoriesCoverage[seed.categoryCode] ?? 0) + 1;
  report.formsCoverage[seed.form] = (report.formsCoverage[seed.form] ?? 0) + 1;
  if (seed.reviewStatus === 'NEEDS_REVIEW') report.needsReview.push(seed.productKey);

  const categoryId = maps.categories.get(seed.categoryCode);
  if (!categoryId) {
    report.rejected.push({
      productKey: seed.productKey,
      code: 'SEED_CATEGORY_MISSING',
      message: seed.categoryCode,
    });
    throw new Error(`SEED_CATEGORY_MISSING:${seed.categoryCode}`);
  }

  const existing = await findExisting(client, seed.productKey);
  if (existing?.status === 'MERGED') {
    report.conflicts.push({
      productKey: seed.productKey,
      code: 'SEED_MERGED_PRODUCT_PROTECTED',
      message: 'MERGED product is not resurrected by seed',
      before: { id: existing.id, status: existing.status },
    });
    return;
  }
  if (seed.nutrition?.sourceRef) {
    const key = `${seed.nutrition.source}:${seed.nutrition.sourceRef}`;
    report.nutritionSources[key] = (report.nutritionSources[key] ?? 0) + 1;
  }
  if (existing) {
    report.matchedExisting.push(seed.productKey);
    const conflicts = detectFieldConflicts(existing, seed);
    report.conflicts.push(...conflicts);
    if (conflicts.some((c) => c.code.startsWith('SEED_CONFLICT_OWNER'))) {
      return;
    }

    if (!dryRun) {
      // Soft fill only null category/form/unit; never force overwrite resolved fields
      await client.query(
        `UPDATE "Product" SET
           "categoryId" = COALESCE("categoryId", $2),
           form = COALESCE(form, $3),
           "defaultUnit" = COALESCE("defaultUnit", $4),
           "fatPercent" = COALESCE("fatPercent", $5),
           "seedDatasetVersion" = $6,
           "seedProvenance" = $7::jsonb,
           "reviewStatus" = CASE
             WHEN $8 = 'NEEDS_REVIEW' AND "reviewStatus" = 'NONE' THEN 'NEEDS_REVIEW'
             ELSE "reviewStatus"
           END,
           "updatedAt" = now()
         WHERE id = $1`,
        [
          existing.id,
          categoryId,
          seed.form,
          seed.defaultUnit,
          seed.coefficients?.fatPercent ?? null,
          seed.seedProvenance.datasetVersion,
          JSON.stringify(seed.seedProvenance),
          seed.reviewStatus ?? 'NONE',
        ],
      );
      report.updatedSoft.push(seed.productKey);
    }

    await appendNutritionIfNeeded(client, existing.id, seed, existing, report, dryRun);

    for (const alias of seed.aliases ?? []) {
      if (dryRun) {
        report.aliasesCreated += 1;
        continue;
      }
      const result = await ensureAlias(client, existing.id, alias.alias, alias.source);
      if (result === 'created') report.aliasesCreated += 1;
      if (result === 'ambiguous') {
        report.duplicateCandidates.push({
          productKey: seed.productKey,
          reason: `AMBIGUOUS_ALIAS:${alias.alias}`,
        });
      }
    }

    await syncLinks(client, existing.id, seed, maps, report, dryRun);
    return;
  }

  // Create new — refuse if stableId already belongs to a MERGED row
  const byId = await client.query<{ status: string }>(
    `SELECT status FROM "Product" WHERE id = $1 LIMIT 1`,
    [seed.stableId],
  );
  if (byId.rows[0]?.status === 'MERGED') {
    report.conflicts.push({
      productKey: seed.productKey,
      code: 'SEED_MERGED_PRODUCT_PROTECTED',
      message: 'stableId points to MERGED product; not resurrected',
      before: { id: seed.stableId },
    });
    return;
  }

  // Create new
  report.created.push(seed.productKey);
  if (dryRun) {
    report.nutritionVersionsCreated.push(seed.productKey);
    report.aliasesCreated += (seed.aliases ?? []).length;
    report.allergensCreated += (seed.allergens ?? []).length;
    report.dietaryTagsCreated += (seed.dietaryTags ?? []).length;
    report.rolesCreated += (seed.culinaryRoles ?? []).length;
    return;
  }

  const n = seed.nutrition!;
  await client.query(
    `INSERT INTO "Product" (
       id, "canonicalName", "productKey", name, "categoryId", form, "defaultUnit", unit,
       "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g",
       "fatPercent", status, "reviewStatus", "seedDatasetVersion", "seedProvenance"
     ) VALUES (
       $1,$2,$3,$2,$4,$5,$6,$6,
       $7,$8,$9,$10,
       $11,'ACTIVE',$12,$13,$14::jsonb
     )`,
    [
      seed.stableId,
      seed.canonicalName,
      seed.productKey,
      categoryId,
      seed.form,
      seed.defaultUnit,
      n.calories,
      n.protein,
      n.fat,
      n.carbohydrate,
      seed.coefficients?.fatPercent ?? null,
      seed.reviewStatus ?? 'NONE',
      seed.seedProvenance.datasetVersion,
      JSON.stringify(seed.seedProvenance),
    ],
  );

  await appendNutritionIfNeeded(
    client,
    seed.stableId,
    seed,
    {
      id: seed.stableId,
      productKey: seed.productKey,
      canonicalName: seed.canonicalName,
      categoryCode: seed.categoryCode,
      form: seed.form,
      defaultUnit: seed.defaultUnit,
      status: 'ACTIVE',
      reviewStatus: seed.reviewStatus ?? 'NONE',
      seedDatasetVersion: null,
      caloriesPer100g: String(n.calories),
      proteinPer100g: String(n.protein),
      fatPer100g: String(n.fat),
      carbsPer100g: String(n.carbohydrate),
      currentNutritionVersionId: null,
      currentCal: null,
      currentProt: null,
      currentFat: null,
      currentCarb: null,
    },
    report,
    false,
  );

  for (const alias of seed.aliases ?? []) {
    const result = await ensureAlias(client, seed.stableId, alias.alias, alias.source);
    if (result === 'created') report.aliasesCreated += 1;
    if (result === 'ambiguous') {
      report.duplicateCandidates.push({ productKey: seed.productKey, reason: `AMBIGUOUS_ALIAS:${alias.alias}` });
    }
  }
  await syncLinks(client, seed.stableId, seed, maps, report, false);
}

async function syncLinks(
  client: SqlClient,
  productId: string,
  seed: ProductSeedRecord,
  maps: {
    allergens: Map<string, string>;
    dietary: Map<string, string>;
    roles: Map<string, string>;
  },
  report: SeedApplyReport,
  dryRun: boolean,
): Promise<void> {
  for (const a of seed.allergens ?? []) {
    const id = maps.allergens.get(a.code);
    if (!id) throw new Error(`SEED_ALLERGEN_MISSING:${a.code}`);
    if (dryRun) {
      report.allergensCreated += 1;
      continue;
    }
    const r = await client.query(
      `INSERT INTO "ProductAllergen" ("productId", "allergenId", presence, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("productId", "allergenId") DO NOTHING
       RETURNING id`,
      [productId, id, a.presence, a.source === 'HEURISTIC' ? 'HEURISTIC' : a.source],
    );
    if (r.rows[0]) report.allergensCreated += 1;
  }
  for (const t of seed.dietaryTags ?? []) {
    const id = maps.dietary.get(t.code);
    if (!id) throw new Error(`SEED_DIETARY_MISSING:${t.code}`);
    if (dryRun) {
      report.dietaryTagsCreated += 1;
      continue;
    }
    const source = t.source === 'DETERMINISTIC' ? 'SYSTEM' : t.source;
    const r = await client.query(
      `INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", source)
       VALUES ($1,$2,$3)
       ON CONFLICT ("productId", "dietaryTagId") DO NOTHING
       RETURNING id`,
      [productId, id, source],
    );
    if (r.rows[0]) report.dietaryTagsCreated += 1;
  }
  for (const role of seed.culinaryRoles ?? []) {
    const id = maps.roles.get(role.code);
    if (!id) throw new Error(`SEED_ROLE_MISSING:${role.code}`);
    if (dryRun) {
      report.rolesCreated += 1;
      continue;
    }
    const existingPrimary = await client.query(
      `SELECT id FROM "ProductCulinaryRole" WHERE "productId" = $1 AND "isPrimary" = true LIMIT 1`,
      [productId],
    );
    const isPrimary = Boolean(role.isPrimary) && !existingPrimary.rows[0];
    const r = await client.query(
      `INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", source, confidence)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("productId", "culinaryRoleId") DO NOTHING
       RETURNING id`,
      [
        productId,
        id,
        isPrimary,
        role.source,
        role.confidenceLabel === 'needs-review' ? 0.6 : 0.9,
      ],
    );
    if (r.rows[0]) report.rolesCreated += 1;
  }
}

export async function runCatalogSeed(options: {
  client: Pool;
  manifest: CatalogSeedManifest;
  mode: 'check' | 'dry-run' | 'apply' | 'report';
  forceChecksumProbe?: string;
}): Promise<SeedApplyReport> {
  const started = Date.now();
  const manifest = options.manifest;
  const report = emptyReport(manifest, options.mode);

  const rejected = validateManifest(manifest);
  report.rejected = rejected;
  if (rejected.length) {
    report.status = 'INVALID';
    report.durationMs = Date.now() - started;
    return report;
  }

  if (options.mode === 'check') {
    report.status = 'OK';
    report.notes.push('Manifest validation passed');
    for (const p of manifest.products) {
      report.categoriesCoverage[p.categoryCode] = (report.categoriesCoverage[p.categoryCode] ?? 0) + 1;
      report.formsCoverage[p.form] = (report.formsCoverage[p.form] ?? 0) + 1;
      if (p.reviewStatus === 'NEEDS_REVIEW') report.needsReview.push(p.productKey);
    }
    report.durationMs = Date.now() - started;
    return report;
  }

  const checksumToUse = options.forceChecksumProbe ?? manifest.checksum;
  const ledger = await options.client.query<{ checksum: string; status: string }>(
    `SELECT checksum, status FROM "CatalogSeedBatch" WHERE "datasetVersion" = $1 LIMIT 1`,
    [manifest.datasetVersion],
  );
  if (ledger.rows[0]) {
    if (ledger.rows[0].checksum === checksumToUse && options.mode !== 'report') {
      report.status = 'NO_OP';
      report.notes.push('Same datasetVersion+checksum already applied');
      report.durationMs = Date.now() - started;
      return report;
    }
    if (ledger.rows[0].checksum !== checksumToUse) {
      report.status = 'BLOCKED';
      report.conflicts.push({
        productKey: '*',
        code: 'SEED_CHECKSUM_CONFLICT',
        message: 'Same datasetVersion with different checksum',
        before: ledger.rows[0].checksum,
        seed: checksumToUse,
      });
      report.durationMs = Date.now() - started;
      return report;
    }
  }

  const categories = await loadCategoryMap(options.client);
  const allergens = await loadCodeMap(options.client, 'Allergen');
  const dietary = await loadCodeMap(options.client, 'DietaryTag');
  const roles = await loadCodeMap(options.client, 'CulinaryRole');

  const datasetKeys = new Set(manifest.products.map((p) => p.productKey));
  const legacy = await options.client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM "Product" WHERE status = 'ACTIVE' AND ("productKey" IS NULL OR NOT ("productKey" = ANY($1::text[])))`,
    [Array.from(datasetKeys)],
  );
  report.legacyOutsideDataset = legacy.rows[0]?.c ?? 0;
  report.legacyOutsidePilot = report.legacyOutsideDataset;

  const dryRun = options.mode === 'dry-run' || options.mode === 'report';

  if (dryRun) {
    for (const product of manifest.products) {
      await applyOne(options.client, product, { categories, allergens, dietary, roles }, report, true);
    }
    report.status = 'OK';
    report.durationMs = Date.now() - started;
    return report;
  }

  const db = options.client;
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    // Serialize concurrent applies of the same datasetVersion (one winner).
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`catalog-seed:${manifest.datasetVersion}`]);
    const raced = await tx.query<{ checksum: string }>(
      `SELECT checksum FROM "CatalogSeedBatch" WHERE "datasetVersion" = $1 LIMIT 1`,
      [manifest.datasetVersion],
    );
    if (raced.rows[0]) {
      if (raced.rows[0].checksum === checksumToUse) {
        await tx.query('ROLLBACK');
        report.status = 'NO_OP';
        report.notes.push('Concurrent apply: batch already applied (winner)');
        report.durationMs = Date.now() - started;
        return report;
      }
      await tx.query('ROLLBACK');
      report.status = 'BLOCKED';
      report.conflicts.push({
        productKey: '*',
        code: 'SEED_CHECKSUM_CONFLICT',
        message: 'Concurrent apply lost to different checksum',
        before: raced.rows[0].checksum,
        seed: checksumToUse,
      });
      report.durationMs = Date.now() - started;
      return report;
    }
    for (const product of manifest.products) {
      await applyOne(tx, product, { categories, allergens, dietary, roles }, report, false);
    }
    if (report.rejected.length) {
      throw new Error('SEED_REJECTED_IN_APPLY');
    }
    await tx.query(
      `INSERT INTO "CatalogSeedBatch"
        ("datasetVersion", checksum, "productCount", status, "appliedAt", "durationMs", "resultJson")
       VALUES ($1,$2,$3,'APPLIED', now(), $4, $5::jsonb)`,
      [
        manifest.datasetVersion,
        manifest.checksum,
        manifest.productCount,
        Date.now() - started,
        JSON.stringify({
          created: report.created.length,
          matched: report.matchedExisting.length,
          conflicts: report.conflicts.length,
          nutritionVersions: report.nutritionVersionsCreated.length,
          previousDatasetVersion: manifest.previousDatasetVersion ?? null,
        }),
      ],
    );
    await tx.query('COMMIT');
    report.status = 'OK';
  } catch (error) {
    await tx.query('ROLLBACK');
    report.status = 'FAILED';
    report.notes.push(error instanceof Error ? error.message : String(error));
  } finally {
    tx.release();
  }

  report.durationMs = Date.now() - started;
  return report;
}
