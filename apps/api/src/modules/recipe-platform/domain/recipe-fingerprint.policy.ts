import { createHash } from 'node:crypto';

/** STEP_207 fingerprint algorithm — never compare across schema versions without a compatibility rule. */
export const RECIPE_FINGERPRINT_SCHEMA_V1 = 'recipe-fingerprint/v1' as const;

export type DuplicateClassification =
  | 'EXACT_DUPLICATE'
  | 'NEAR_DUPLICATE'
  | 'FAMILY_VARIANT'
  | 'POSSIBLE_DUPLICATE'
  | 'DISTINCT';

export type SimilarityReason = {
  code: string;
  detail: string;
  weight: number;
  contribution: number;
};

/** Documented component weights (sum = 1.0). */
export const SIMILARITY_WEIGHTS = {
  ingredientIdentity: 0.3,
  primaryProduct: 0.15,
  ingredientQuantities: 0.2,
  culinaryRoles: 0.05,
  cookingMethods: 0.15,
  structure: 0.05,
  family: 0.05,
  normalizedTitle: 0.05,
} as const;

export function normalizeRecipeTitle(input: string): string {
  return String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(',')}}`;
}

export type NormalizedIngredientFeature = {
  canonicalProductId: string;
  form: string | null;
  culinaryRole: string | null;
  amountPerServing: number | null;
  unit: string;
  conversionStatus: 'NORMALIZED' | 'UNCONVERTED_COUNT' | 'UNKNOWN_UNIT';
  position: number;
};

export type FingerprintFeatures = {
  schemaVersion: typeof RECIPE_FINGERPRINT_SCHEMA_V1;
  titleNormalized: string;
  servingsOriginal: number;
  normalizationBasis: 'PER_SERVING';
  ingredients: NormalizedIngredientFeature[];
  cooking: {
    stepCount: number;
    durationMinutes: number[];
    temperaturesC: number[];
    equipment: string[];
    structureConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  familyId: string | null;
  dishType: string | null;
  primaryProductId: string | null;
};

export function buildFingerprintHashes(features: FingerprintFeatures) {
  const titleNormalizationHash = sha256Hex(features.titleNormalized);
  const ingredientSetHash = sha256Hex(
    features.ingredients
      .map((i) => `${i.canonicalProductId}|${i.form ?? ''}|${i.culinaryRole ?? ''}`)
      .sort()
      .join(';'),
  );
  const ingredientQuantityHash = sha256Hex(
    features.ingredients
      .map((i) => {
        const qty =
          i.amountPerServing == null
            ? `${i.conversionStatus}:${i.unit}`
            : `${i.amountPerServing.toFixed(3)}:${i.unit}`;
        return `${i.canonicalProductId}=${qty}`;
      })
      .sort()
      .join(';'),
  );
  const cookingStructureHash = sha256Hex(
    stableJson({
      stepCount: features.cooking.stepCount,
      durationMinutes: features.cooking.durationMinutes,
      temperaturesC: features.cooking.temperaturesC,
      equipment: [...features.cooking.equipment].sort(),
    }),
  );
  const familyFeatureHash = features.familyId
    ? sha256Hex(`${features.familyId}|${features.dishType ?? ''}|${features.primaryProductId ?? ''}`)
    : null;
  const exactContentHash = sha256Hex(
    stableJson({
      title: titleNormalizationHash,
      ingredients: ingredientSetHash,
      quantities: ingredientQuantityHash,
      cooking: cookingStructureHash,
      family: familyFeatureHash,
      basis: features.normalizationBasis,
    }),
  );
  const checksum = sha256Hex(
    stableJson({
      schemaVersion: features.schemaVersion,
      exactContentHash,
      ingredientSetHash,
      ingredientQuantityHash,
      cookingStructureHash,
      titleNormalizationHash,
      familyFeatureHash,
    }),
  );
  return {
    exactContentHash,
    ingredientSetHash,
    ingredientQuantityHash,
    cookingStructureHash,
    titleNormalizationHash,
    familyFeatureHash,
    checksum,
    confidence: features.cooking.structureConfidence,
  };
}

export function classifySimilarity(input: {
  sameRecipe: boolean;
  score: number;
  ingredientOverlap: number;
  quantityDelta: number;
  samePrimary: boolean;
  sameFamily: boolean;
  cookingMatch: number;
  titleMatch: boolean;
}): { classification: DuplicateClassification; blocked: boolean } {
  if (input.sameRecipe) {
    return { classification: 'DISTINCT', blocked: false };
  }
  if (input.score >= 0.97 && input.ingredientOverlap >= 0.98 && input.quantityDelta <= 0.08) {
    return { classification: 'EXACT_DUPLICATE', blocked: true };
  }
  if (input.score >= 0.85 && input.ingredientOverlap >= 0.85) {
    return { classification: 'NEAR_DUPLICATE', blocked: false };
  }
  if (input.sameFamily && input.score >= 0.55 && input.samePrimary) {
    return { classification: 'FAMILY_VARIANT', blocked: false };
  }
  if (input.score >= 0.45 || (input.titleMatch && input.samePrimary && input.cookingMatch >= 0.5)) {
    return { classification: 'POSSIBLE_DUPLICATE', blocked: false };
  }
  return { classification: 'DISTINCT', blocked: false };
}

export function orderedPairKey(a: string, b: string): { left: string; right: string; pairKey: string } {
  const [left, right] = a < b ? [a, b] : [b, a];
  return { left, right, pairKey: `${left}:${right}` };
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const value of a) if (b.has(value)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
