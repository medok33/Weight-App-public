import { withComputedChecksum } from './checksum';
import { CATALOG_CORE_V2_PRODUCTS } from './catalog-core-v2.dataset';
import { CATALOG_CORE_V3_EXPANSION_ROWS } from './catalog-core-v3-expansion.data';
import {
  SEED_SCHEMA_VERSION,
  SEED_SOURCE_POLICY_VERSION,
  type CatalogSeedManifest,
  type ProductSeedRecord,
  type SeedNutrition,
} from './seed.types';

const DS = 'catalog-core-v3';
const OBTAINED = '2026-07-25';

type Compact = {
  n: number;
  key: string;
  name: string;
  cat: string;
  form: string;
  unit?: string;
  cal: number;
  p: number;
  f: number;
  c: number;
  src?: 'usda' | 'rf';
  role?: string;
  allergen?: string;
  vegan?: boolean;
  veg?: boolean;
  fatPct?: number;
  review?: boolean;
  aliases?: string[];
  note?: string;
  fdcId?: string;
};

function usda(
  n: Omit<SeedNutrition, 'source' | 'sourceRef' | 'confidenceLabel' | 'basis' | 'sourceRecordId' | 'obtainedAt'>,
  recordId: string,
): SeedNutrition {
  return {
    ...n,
    fiber: n.fiber ?? null,
    sodium: n.sodium ?? null,
    basis: 'per_100g',
    source: 'IMPORT',
    sourceRef: 'USDA_FDC',
    sourceRecordId: recordId,
    obtainedAt: OBTAINED,
    confidenceLabel: 'source-provided',
  };
}

function rf(
  n: Omit<SeedNutrition, 'source' | 'sourceRef' | 'confidenceLabel' | 'basis' | 'sourceRecordId' | 'obtainedAt'>,
  recordId: string,
): SeedNutrition {
  return {
    ...n,
    fiber: n.fiber ?? null,
    sodium: n.sodium ?? null,
    basis: 'per_100g',
    source: 'IMPORT',
    sourceRef: 'RF_FOOD_COMPOSITION_REF',
    sourceRecordId: recordId,
    obtainedAt: OBTAINED,
    confidenceLabel: 'needs-review',
  };
}

function toRecord(row: Compact): ProductSeedRecord {
  const recordId =
    row.fdcId ? `USDA_FDC:${row.fdcId}` :
    row.src === 'rf'
      ? `RF_EXCERPT:${row.key}:${OBTAINED}`
      : `USDA_FDC_MAP:${row.key}:${OBTAINED}`;
  const nutrition = (row.src === 'rf' ? rf : usda)(
    { calories: row.cal, protein: row.p, fat: row.f, carbohydrate: row.c },
    recordId,
  );
  const hex = row.n.toString(16).padStart(3, '0');
  return {
    stableId: `c2010003-0000-4000-8000-000000000${hex}`,
    productKey: row.key,
    canonicalName: row.name,
    categoryCode: row.cat,
    form: row.form,
    defaultUnit: row.unit ?? 'g',
    status: 'ACTIVE',
    nutrition,
    aliases: [
      { alias: row.name, source: 'SYSTEM' },
      ...(row.aliases ?? []).map((a) => ({ alias: a, source: 'IMPORT' as const })),
    ],
    allergens: row.allergen
      ? [
          {
            code: row.allergen,
            presence: 'CONTAINS',
            source: 'IMPORT',
            confidenceLabel: 'source-provided',
          },
        ]
      : undefined,
    dietaryTags: [
      ...(row.vegan
        ? [{ code: 'vegan' as const, source: 'DETERMINISTIC' as const, confidenceLabel: 'deterministic-derived' as const }]
        : []),
      ...(row.veg || row.vegan
        ? [
            {
              code: 'vegetarian' as const,
              source: 'DETERMINISTIC' as const,
              confidenceLabel: 'deterministic-derived' as const,
            },
          ]
        : []),
    ],
    culinaryRoles: row.role
      ? [
          {
            code: row.role,
            isPrimary: true,
            source: 'IMPORT',
            confidenceLabel: row.review ? 'needs-review' : 'source-provided',
          },
        ]
      : undefined,
    coefficients: row.fatPct != null ? { fatPercent: row.fatPct } : undefined,
    reviewStatus: row.review || row.src === 'rf' ? 'NEEDS_REVIEW' : 'NONE',
    reviewSeverity: 'NON_BLOCKING',
    reviewNote: row.note ?? null,
    seedProvenance: {
      datasetVersion: DS,
      sources: [row.src === 'rf' ? 'S2' : 'S1', 'S4'],
      notes: row.note,
    },
  };
}

function remapFromV2(product: ProductSeedRecord): ProductSeedRecord {
  const isFixture = product.nutrition?.source === 'FIXTURE';
  const nutrition = product.nutrition
    ? {
        ...product.nutrition,
        basis: product.nutrition.basis ?? ('per_100g' as const),
        sourceRecordId:
          product.nutrition.sourceRecordId ??
          (isFixture
            ? `FIXTURE:${product.productKey}`
            : `${product.nutrition.sourceRef}:${product.productKey}`),
        obtainedAt: product.nutrition.obtainedAt ?? OBTAINED,
      }
    : product.nutrition;
  const fixtureNote = isFixture ? 'FIXTURE_COMPATIBILITY_EXCEPTION' : null;
  return {
    ...product,
    nutrition,
    reviewStatus: isFixture || product.reviewStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : product.reviewStatus,
    reviewSeverity: 'NON_BLOCKING',
    reviewNote: [product.reviewNote, fixtureNote].filter(Boolean).join('; ') || null,
    seedProvenance: {
      ...product.seedProvenance,
      datasetVersion: DS,
      notes: [product.seedProvenance.notes, 'carried-from:catalog-core-v2', fixtureNote]
        .filter(Boolean)
        .join('; '),
    },
  };
}

export const CATALOG_CORE_V3_EXPANSION: ProductSeedRecord[] = (
  CATALOG_CORE_V3_EXPANSION_ROWS as unknown as Compact[]
).map(toRecord);

export const CATALOG_CORE_V3_PRODUCTS: ProductSeedRecord[] = [
  ...CATALOG_CORE_V2_PRODUCTS.map(remapFromV2),
  ...CATALOG_CORE_V3_EXPANSION,
];

const CATEGORY_MINIMUMS: Record<string, number> = {
  meat_poultry: 20,
  fish_seafood: 15,
  dairy: 20,
  eggs: 4,
  grains: 20,
  pasta: 8,
  vegetables: 45,
  fruits: 30,
  legumes: 12,
  oils_fats: 8,
  sauces: 12,
  spices: 20,
  technological_ingredients: 10,
};

export function buildCatalogCoreV3Manifest(): CatalogSeedManifest {
  const products = CATALOG_CORE_V3_PRODUCTS;
  const categoryCoverage: Record<string, number> = {};
  const formCoverage: Record<string, number> = {};
  const bySourceRef: Record<string, number> = {};
  let nonBlocking = 0;
  let fixtureCompatibilityExceptions = 0;
  let withSourceRecordId = 0;
  let withSourceRef = 0;

  for (const p of products) {
    categoryCoverage[p.categoryCode] = (categoryCoverage[p.categoryCode] ?? 0) + 1;
    formCoverage[p.form] = (formCoverage[p.form] ?? 0) + 1;
    if (p.reviewStatus === 'NEEDS_REVIEW') nonBlocking += 1;
    if (p.nutrition?.sourceRef) {
      withSourceRef += 1;
      bySourceRef[p.nutrition.sourceRef] = (bySourceRef[p.nutrition.sourceRef] ?? 0) + 1;
    }
    if (p.nutrition?.sourceRecordId) withSourceRecordId += 1;
    if (p.seedProvenance.notes?.includes('FIXTURE_COMPATIBILITY_EXCEPTION')) {
      fixtureCompatibilityExceptions += 1;
    }
  }

  for (const [code, min] of Object.entries(CATEGORY_MINIMUMS)) {
    if ((categoryCoverage[code] ?? 0) < min) {
      throw new Error(`catalog-core-v3 category ${code} below minimum ${min}: ${categoryCoverage[code] ?? 0}`);
    }
  }

  const v2Keys = new Set(CATALOG_CORE_V2_PRODUCTS.map((p) => p.productKey));
  const added = products.filter((p) => !v2Keys.has(p.productKey)).length;

  return withComputedChecksum({
    datasetVersion: DS,
    previousDatasetVersion: 'catalog-core-v2',
    schemaVersion: SEED_SCHEMA_VERSION,
    sourcePolicyVersion: SEED_SOURCE_POLICY_VERSION,
    releaseDate: '2026-07-25',
    products,
    addedProductCount: added,
    matchedProductCount: products.length - added,
    reviewSummary: { blocking: 0, nonBlocking },
    categoryCoverage,
    formCoverage,
    sourceCoverage: {
      withSourceRef,
      withSourceRecordId,
      fixtureCompatibilityExceptions,
      bySourceRef,
    },
  });
}
