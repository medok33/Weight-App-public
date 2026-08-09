import {
  assertDefaultUnit,
  assertProductForm,
  normalizeProductAlias,
} from '../domain/product-foundation.policy';
import {
  SEED_SCHEMA_VERSION,
  SEED_SOURCE_POLICY_VERSION,
  type CatalogSeedManifest,
  type ProductSeedRecord,
  type SeedConflict,
} from './seed.types';
import { computeProductsChecksum } from './checksum';

const PRODUCT_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRED_CATEGORIES = [
  'meat_poultry',
  'fish_seafood',
  'dairy',
  'eggs',
  'grains',
  'pasta',
  'vegetables',
  'fruits',
  'legumes',
  'oils_fats',
  'sauces',
  'spices',
  'technological_ingredients',
] as const;

export function validateManifestStructure(manifest: CatalogSeedManifest): SeedConflict[] {
  const rejected: SeedConflict[] = [];
  if (manifest.schemaVersion !== SEED_SCHEMA_VERSION) {
    rejected.push({
      productKey: '*',
      code: 'SEED_SCHEMA_VERSION_INVALID',
      message: `Expected ${SEED_SCHEMA_VERSION}`,
      seed: manifest.schemaVersion,
    });
  }
  if (manifest.sourcePolicyVersion !== SEED_SOURCE_POLICY_VERSION) {
    rejected.push({
      productKey: '*',
      code: 'SEED_SOURCE_POLICY_VERSION_INVALID',
      message: `Expected ${SEED_SOURCE_POLICY_VERSION}`,
      seed: manifest.sourcePolicyVersion,
    });
  }
  if (!manifest.datasetVersion?.trim()) {
    rejected.push({ productKey: '*', code: 'SEED_DATASET_VERSION_REQUIRED', message: 'datasetVersion required' });
  }
  if (manifest.productCount !== manifest.products.length) {
    rejected.push({
      productKey: '*',
      code: 'SEED_PRODUCT_COUNT_MISMATCH',
      message: `productCount ${manifest.productCount} != products.length ${manifest.products.length}`,
    });
  }
  const expected = computeProductsChecksum(manifest.products);
  if (manifest.checksum !== expected) {
    rejected.push({
      productKey: '*',
      code: 'SEED_CHECKSUM_MISMATCH',
      message: 'Manifest checksum does not match products payload',
      before: manifest.checksum,
      seed: expected,
    });
  }
  if (manifest.products.length < 40 || manifest.products.length > 350) {
    rejected.push({
      productKey: '*',
      code: 'SEED_PRODUCT_COUNT_OUT_OF_RANGE',
      message: `Dataset product count out of allowed 40–350, got ${manifest.products.length}`,
    });
  }
  if (manifest.datasetVersion === 'pilot-v1' && (manifest.products.length < 40 || manifest.products.length > 60)) {
    rejected.push({
      productKey: '*',
      code: 'SEED_PILOT_COUNT_OUT_OF_RANGE',
      message: `Pilot requires 40–60 products, got ${manifest.products.length}`,
    });
  }
  if (
    manifest.datasetVersion === 'catalog-core-v2' &&
    (manifest.products.length < 150 || manifest.products.length > 180)
  ) {
    rejected.push({
      productKey: '*',
      code: 'SEED_CORE_V2_COUNT_OUT_OF_RANGE',
      message: `catalog-core-v2 requires 150–180 products, got ${manifest.products.length}`,
    });
  }
  if (manifest.datasetVersion === 'catalog-core-v2' && manifest.previousDatasetVersion !== 'pilot-v1') {
    rejected.push({
      productKey: '*',
      code: 'SEED_PREVIOUS_VERSION_INVALID',
      message: 'catalog-core-v2 must set previousDatasetVersion=pilot-v1',
      seed: manifest.previousDatasetVersion,
    });
  }
  if (
    manifest.datasetVersion === 'catalog-core-v3' &&
    (manifest.products.length < 250 || manifest.products.length > 350)
  ) {
    rejected.push({
      productKey: '*',
      code: 'SEED_CORE_V3_COUNT_OUT_OF_RANGE',
      message: `catalog-core-v3 requires 250–350 products, got ${manifest.products.length}`,
    });
  }
  if (manifest.datasetVersion === 'catalog-core-v3' && manifest.previousDatasetVersion !== 'catalog-core-v2') {
    rejected.push({
      productKey: '*',
      code: 'SEED_PREVIOUS_VERSION_INVALID',
      message: 'catalog-core-v3 must set previousDatasetVersion=catalog-core-v2',
      seed: manifest.previousDatasetVersion,
    });
  }
  return rejected;
}

export function validateProductRecords(
  products: ProductSeedRecord[],
  options?: { requireSourceRecordId?: boolean },
): SeedConflict[] {
  const rejected: SeedConflict[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  const categoryCounts = new Map<string, number>();

  for (const p of products) {
    if (!UUID_RE.test(p.stableId)) {
      rejected.push({ productKey: p.productKey, code: 'SEED_STABLE_ID_INVALID', message: 'stableId must be UUID' });
    }
    if (ids.has(p.stableId)) {
      rejected.push({ productKey: p.productKey, code: 'SEED_STABLE_ID_DUPLICATE', message: p.stableId });
    }
    ids.add(p.stableId);

    if (!PRODUCT_KEY_RE.test(p.productKey)) {
      rejected.push({ productKey: p.productKey, code: 'SEED_PRODUCT_KEY_INVALID', message: p.productKey });
    }
    if (keys.has(p.productKey)) {
      rejected.push({ productKey: p.productKey, code: 'SEED_PRODUCT_KEY_DUPLICATE', message: p.productKey });
    }
    keys.add(p.productKey);

    if (!p.canonicalName?.trim()) {
      rejected.push({ productKey: p.productKey, code: 'SEED_NAME_REQUIRED', message: 'canonicalName required' });
    }

    try {
      assertProductForm(p.form);
    } catch {
      rejected.push({ productKey: p.productKey, code: 'SEED_FORM_INVALID', message: p.form });
    }
    try {
      assertDefaultUnit(p.defaultUnit);
    } catch {
      rejected.push({ productKey: p.productKey, code: 'SEED_UNIT_INVALID', message: p.defaultUnit });
    }

    categoryCounts.set(p.categoryCode, (categoryCounts.get(p.categoryCode) ?? 0) + 1);

    if (p.nutritionStatus === 'SOURCE_REQUIRED' || !p.nutrition) {
      rejected.push({
        productKey: p.productKey,
        code: 'SOURCE_REQUIRED',
        message: 'Nutrition source missing — record blocked',
      });
      continue;
    }

    const n = p.nutrition;
    for (const [field, value] of Object.entries({
      calories: n.calories,
      protein: n.protein,
      fat: n.fat,
      carbohydrate: n.carbohydrate,
    })) {
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
        rejected.push({ productKey: p.productKey, code: 'SEED_NUTRITION_INVALID', message: field });
      }
    }
    if (!n.source || !n.sourceRef) {
      rejected.push({ productKey: p.productKey, code: 'SEED_NUTRITION_SOURCE_REQUIRED', message: 'source/sourceRef' });
    }
    if (options?.requireSourceRecordId && !n.sourceRecordId?.trim()) {
      rejected.push({
        productKey: p.productKey,
        code: 'SEED_NUTRITION_SOURCE_RECORD_REQUIRED',
        message: 'sourceRecordId required for final catalog provenance',
      });
    }
    if (n.basis && n.basis !== 'per_100g') {
      rejected.push({ productKey: p.productKey, code: 'SEED_NUTRITION_BASIS_INVALID', message: String(n.basis) });
    }
    // Soft Atwater sanity: fiber-heavy foods often diverge; keep as warning-level reject only when extreme.
    const implied = 4 * n.protein + 9 * n.fat + 4 * n.carbohydrate;
    if (n.calories >= 20 && implied >= 20) {
      const rel = Math.abs(n.calories - implied) / Math.max(n.calories, 1);
      if (rel > 0.75) {
        rejected.push({
          productKey: p.productKey,
          code: 'SEED_NUTRITION_KCAL_SANITY',
          message: `calories ${n.calories} diverge from macros≈${implied.toFixed(1)} (>75%)`,
        });
      }
    }
    if (n.calories > 950) {
      rejected.push({
        productKey: p.productKey,
        code: 'SEED_NUTRITION_KJ_SUSPECT',
        message: 'calories > 950 per 100g — possible kJ/kcal confusion',
      });
    }

    const vegan = (p.dietaryTags ?? []).some((t) => t.code === 'vegan');
    const hasMilk = (p.allergens ?? []).some((a) => a.code === 'milk' && a.presence === 'CONTAINS');
    const hasEgg = (p.allergens ?? []).some((a) => a.code === 'eggs' && a.presence === 'CONTAINS');
    if (vegan && (hasMilk || hasEgg)) {
      rejected.push({
        productKey: p.productKey,
        code: 'SEED_DIETARY_CONFLICT',
        message: 'vegan conflicts with milk/egg allergen',
      });
    }

    const glutenFree = (p.dietaryTags ?? []).some((t) => t.code === 'gluten_free');
    const hasGluten = (p.allergens ?? []).some((a) => a.code === 'gluten' && a.presence === 'CONTAINS');
    if (glutenFree && hasGluten) {
      rejected.push({
        productKey: p.productKey,
        code: 'SEED_DIETARY_CONFLICT',
        message: 'gluten_free conflicts with gluten allergen',
      });
    }

    for (const alias of p.aliases ?? []) {
      try {
        normalizeProductAlias(alias.alias);
      } catch {
        rejected.push({ productKey: p.productKey, code: 'SEED_ALIAS_INVALID', message: alias.alias });
      }
    }

    const primaryRoles = (p.culinaryRoles ?? []).filter((r) => r.isPrimary);
    if (primaryRoles.length > 1) {
      rejected.push({ productKey: p.productKey, code: 'SEED_ROLE_PRIMARY_INVALID', message: 'multiple primary roles' });
    }

    if ((p.coefficients?.density != null && !(p.coefficients.density > 0)) ||
      (p.coefficients?.yieldCoefficient != null && !(p.coefficients.yieldCoefficient > 0))) {
      rejected.push({ productKey: p.productKey, code: 'SEED_COEFFICIENT_INVALID', message: 'coefficients' });
    }
  }

  for (const code of REQUIRED_CATEGORIES) {
    if (!categoryCounts.get(code)) {
      rejected.push({
        productKey: '*',
        code: 'SEED_CATEGORY_COVERAGE_MISSING',
        message: `Missing required category ${code}`,
      });
    }
  }

  return rejected;
}

export function validateManifest(manifest: CatalogSeedManifest): SeedConflict[] {
  return [
    ...validateManifestStructure(manifest),
    ...validateProductRecords(manifest.products, {
      requireSourceRecordId: manifest.datasetVersion === 'catalog-core-v3',
    }),
  ];
}
