/** RP2-01B STEP_198/199 domain types. */

export const CULINARY_ROLE_CODES = [
  'MAIN_PROTEIN',
  'STARCH',
  'VEGETABLE_BASE',
  'FAT',
  'BINDER',
  'MOISTURE_SOURCE',
  'SAUCE_BASE',
  'AROMATIC',
  'ACID',
  'THICKENER',
  'SEASONING',
] as const;

export type CulinaryRoleCode = (typeof CULINARY_ROLE_CODES)[number];

export const COOKING_METHOD_CODES = [
  'RAW',
  'BOIL',
  'BAKE',
  'FRY',
  'STEW',
  'STEAM',
  'GRILL',
  'MIX',
  'BLEND',
] as const;

export type CookingMethodCode = (typeof COOKING_METHOD_CODES)[number];

export const SUBSTITUTION_STATUSES = [
  'ACTIVE',
  'NEEDS_REVIEW',
  'SUSPENDED',
  'REJECTED',
  'ARCHIVED',
] as const;

export type SubstitutionStatus = (typeof SUBSTITUTION_STATUSES)[number];

export const NUTRITION_IMPACTS = ['LOWER', 'SIMILAR', 'HIGHER', 'VARIABLE', 'UNKNOWN'] as const;
export type NutritionImpact = (typeof NUTRITION_IMPACTS)[number];

export const TEXTURE_IMPACTS = ['MINIMAL', 'NOTICEABLE', 'MAJOR', 'METHOD_DEPENDENT', 'UNKNOWN'] as const;
export type TextureImpact = (typeof TEXTURE_IMPACTS)[number];

export type ProductCulinaryRoleSnapshot = {
  productId: string;
  culinaryRoleId: string;
  culinaryRoleCode: CulinaryRoleCode;
  isPrimary: boolean;
  source: string;
  confidence: number;
};

export type ProductSubstitutionEdge = {
  id: string;
  sourceProductId: string;
  replacementProductId: string;
  culinaryRoleId: string | null;
  culinaryRoleCode: CulinaryRoleCode | null;
  replacementRatio: number;
  replacementRatioMin: number;
  replacementRatioMax: number;
  nutritionImpact: NutritionImpact;
  textureImpact: TextureImpact;
  supportedMethods: CookingMethodCode[];
  status: SubstitutionStatus;
  source: string;
  confidence: number;
};

export type SubstitutionProvenance = 'CURATED_PRODUCT_SUBSTITUTION' | 'HEURISTIC_CATALOG_MATCH';

/** Deterministic pair eligibility used when merging curated + heuristic candidates. */
export type SubstitutionEligibility =
  | 'CURATED_COMPATIBLE'
  | 'METHOD_INCOMPATIBLE'
  | 'NO_CURATED_RULE'
  | 'INACTIVE_ONLY'
  | 'BLOCKED_BY_PRODUCT_POLICY';

export type SubstitutionEligibilityEdge = {
  sourceProductId: string;
  replacementProductId: string;
  culinaryRoleId: string | null;
  status: SubstitutionStatus | string;
  supportedMethods: readonly string[];
};

export type RatioResolution = {
  baseRatio: number;
  adjustedRatio: number;
  suggestedAmount: number;
  sourceAmount: number;
  ratioReason: string;
  nutritionalDelta: {
    calories: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  };
};

export type PriceProvenance =
  | 'RETAIL_PRODUCT_PRICE'
  | 'LEGACY_PRODUCT_PRICE'
  | 'PRICE_INCOMPLETE'
  | 'PRICE_MISSING';

export type ProductPriceQuote = {
  productId: string;
  retailProductId: string | null;
  retailerId: string | null;
  retailerName: string | null;
  retailerCode: string | null;
  packageWeight: number | null;
  packageUnit: string | null;
  packagePriceRub: number | null;
  currency: string;
  collectedAt: string | null;
  availability: string | null;
  confidence: number | null;
  stale: boolean;
  provenance: PriceProvenance;
  coverage: 'FULL' | 'PARTIAL' | 'LEGACY' | 'MISSING';
  /** Persisted PriceObservation.dataClass when known. */
  dataClass?: 'PRODUCTION' | 'TEST_ONLY' | 'FIXTURE' | 'HISTORICAL_TEST';
  status?: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'APPROXIMATE';
  priceCondition?: 'REGULAR' | 'PROMOTIONAL' | 'LOYALTY_ONLY' | 'CONDITIONAL' | 'UNKNOWN_CONDITION';
  observationId?: string | null;
  locationScope?: string | null;
};

export type RetailProductSnapshot = {
  id: string;
  retailerId: string;
  canonicalProductId: string | null;
  externalSku: string | null;
  title: string;
  brand: string | null;
  packageWeight: number | null;
  packageUnit: string | null;
  status: string;
  mappingStatus: 'MAPPED' | 'NEEDS_PRODUCT_MAPPING';
  source: string;
};
