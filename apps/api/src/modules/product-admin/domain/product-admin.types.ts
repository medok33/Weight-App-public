/** RP2-01C1 STEP_200 Owner product catalog admin types. */

export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'MERGED', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_REVIEW_STATUSES = ['NONE', 'NEEDS_REVIEW', 'IN_REVIEW', 'RESOLVED'] as const;
export type ProductReviewStatus = (typeof PRODUCT_REVIEW_STATUSES)[number];

export const PRODUCT_REVIEW_QUEUES = [
  'UNCLASSIFIED',
  'MISSING_NUTRITION',
  'UNVERSIONED_LEGACY',
  'AMBIGUOUS_ALIAS',
  'HEURISTIC_ALLERGEN',
  'HEURISTIC_DIETARY_TAG',
  'MISSING_CULINARY_ROLE',
  'SUBSTITUTION_NEEDS_REVIEW',
  'RETAIL_NEEDS_PRODUCT_MAPPING',
  'LEGACY_PRICE_ONLY',
  'INVALID_COEFFICIENT',
  'POSSIBLE_DUPLICATE',
  'MANUAL',
] as const;
export type ProductReviewQueueCode = (typeof PRODUCT_REVIEW_QUEUES)[number];

export type ProductListFilters = {
  q?: string;
  categoryId?: string;
  form?: string;
  nutrition?: 'VERSIONED' | 'UNVERSIONED_LEGACY' | 'MISSING';
  reviewStatus?: ProductReviewStatus;
  allergenReview?: boolean;
  dietaryReview?: boolean;
  roleMissing?: boolean;
  retailMissing?: boolean;
  legacyPriceOnly?: boolean;
  unclassified?: boolean;
  status?: ProductStatus;
  page?: number;
  pageSize?: number;
  sort?: 'updatedAt' | 'canonicalName' | 'productKey';
  order?: 'asc' | 'desc';
};

export type ProductListItem = {
  id: string;
  canonicalName: string;
  productKey: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  form: string | null;
  seedDatasetVersion: string | null;
  nutritionStatus: 'VERSIONED' | 'UNVERSIONED_LEGACY' | 'MISSING';
  aliasesCount: number;
  allergenStatus: string;
  dietaryTags: string[];
  culinaryRoles: string[];
  retailProductCount: number;
  priceCoverage: 'RETAIL' | 'LEGACY' | 'MIXED' | 'MISSING';
  reviewStatus: ProductReviewStatus;
  status: ProductStatus;
  updatedAt: string;
};

export type CreateProductInput = {
  canonicalName: string;
  productKey: string;
  categoryId: string;
  form: string;
  defaultUnit: string;
  unit?: string;
  fatPercent?: number | null;
  ediblePartPercent?: number | null;
  density?: number | null;
  averagePieceWeightGrams?: number | null;
  yieldCoefficient?: number | null;
  caloriesPer100g?: number;
  proteinPer100g?: number;
  fatPer100g?: number | null;
  carbsPer100g?: number | null;
  confirmPossibleDuplicate?: boolean;
};

export type UpdateProductInput = {
  canonicalName?: string;
  categoryId?: string | null;
  form?: string | null;
  defaultUnit?: string | null;
  fatPercent?: number | null;
  ediblePartPercent?: number | null;
  density?: number | null;
  averagePieceWeightGrams?: number | null;
  yieldCoefficient?: number | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  reviewStatus?: ProductReviewStatus;
  reviewNote?: string | null;
  rowVersion: number;
};

export type NutritionVersionInput = {
  calories: number;
  protein: number;
  fat: number;
  carbohydrate: number;
  fiber?: number | null;
  sodium?: number | null;
  source: string;
  validFrom?: string;
  reviewNote?: string | null;
};

export type AliasCreateInput = {
  alias: string;
  source?: string;
  forceDespiteAmbiguity?: boolean;
};

export type CulinaryRoleAssignment = {
  culinaryRoleId: string;
  isPrimary?: boolean;
  source?: string;
};

export type SubstitutionCreateInput = {
  replacementProductId: string;
  culinaryRoleId?: string | null;
  replacementRatio: number;
  replacementRatioMin: number;
  replacementRatioMax: number;
  nutritionImpact?: string;
  textureImpact?: string;
  supportedMethods?: string[];
  status?: 'ACTIVE' | 'NEEDS_REVIEW' | 'SUSPENDED';
  source?: string;
};

export type MergePreview = {
  sourceProductId: string;
  targetProductId: string;
  blocked: boolean;
  blockReason: string | null;
  recipeIngredientCount: number;
  aliasCount: number;
  nutritionVersionCount: number;
  allergenCount: number;
  dietaryTagCount: number;
  culinaryRoleCount: number;
  substitutionEdgeCount: number;
  retailProductCount: number;
  priceObservationCount: number;
  conflicts: string[];
  willRebind: string[];
  willKeepHistorical: string[];
};

export type MergeResult =
  | { status: 'MERGED'; sourceProductId: string; targetProductId: string }
  | { status: 'MERGE_BLOCKED'; reason: string; conflicts: string[] };
