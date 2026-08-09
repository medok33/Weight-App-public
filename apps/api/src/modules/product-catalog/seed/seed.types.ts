/** RP2-01C2 catalog seed types (manifest /v1). */

export const SEED_SCHEMA_VERSION = 'catalog-seed-manifest/v1';
export const SEED_SOURCE_POLICY_VERSION = 'source-policy-v1';

export type SeedConfidenceLabel =
  | 'source-provided'
  | 'deterministic-derived'
  | 'needs-review'
  | 'OWNER-reviewed';

export type SeedNutrition = {
  calories: number;
  protein: number;
  fat: number;
  carbohydrate: number;
  fiber?: number | null;
  sodium?: number | null;
  /** Always per 100 g edible (or ml≈g for dilute liquids). */
  basis?: 'per_100g';
  source: 'IMPORT' | 'FIXTURE' | 'SYSTEM' | 'LAB' | 'MANUAL' | 'LEGACY_BACKFILL';
  sourceRef: string;
  /** USDA FDC id, RF excerpt locator, or fixture key — never AI-invented. */
  sourceRecordId?: string;
  /** ISO date or excerpt version when the numbers were captured. */
  obtainedAt?: string;
  confidenceLabel: SeedConfidenceLabel;
};

export type SeedAlias = {
  alias: string;
  source: 'SYSTEM' | 'IMPORT' | 'FIXTURE';
  confidenceLabel?: SeedConfidenceLabel;
};

export type SeedAllergen = {
  code: string;
  presence: 'CONTAINS' | 'MAY_CONTAIN' | 'CROSS_CONTAMINATION_RISK';
  source: 'IMPORT' | 'HEURISTIC' | 'FIXTURE' | 'SYSTEM';
  confidenceLabel: SeedConfidenceLabel;
};

export type SeedDietaryTag = {
  code: string;
  source: 'IMPORT' | 'HEURISTIC' | 'FIXTURE' | 'SYSTEM' | 'DETERMINISTIC';
  confidenceLabel: SeedConfidenceLabel;
};

export type SeedCulinaryRole = {
  code: string;
  isPrimary?: boolean;
  source: 'IMPORT' | 'HEURISTIC' | 'FIXTURE' | 'SYSTEM';
  confidenceLabel: SeedConfidenceLabel;
};

export type ProductSeedRecord = {
  stableId: string;
  productKey: string;
  canonicalName: string;
  categoryCode: string;
  form: string;
  defaultUnit: string;
  status: 'ACTIVE' | 'INACTIVE';
  nutrition?: SeedNutrition;
  nutritionStatus?: 'OK' | 'SOURCE_REQUIRED';
  aliases?: SeedAlias[];
  allergens?: SeedAllergen[];
  dietaryTags?: SeedDietaryTag[];
  culinaryRoles?: SeedCulinaryRole[];
  coefficients?: {
    fatPercent?: number | null;
    ediblePartPercent?: number | null;
    density?: number | null;
    averagePieceWeightGrams?: number | null;
    yieldCoefficient?: number | null;
  };
  reviewStatus?: 'NONE' | 'NEEDS_REVIEW';
  reviewNote?: string | null;
  reviewSeverity?: 'BLOCKING' | 'NON_BLOCKING';
  seedProvenance: {
    datasetVersion: string;
    sources: string[];
    notes?: string;
  };
};

export type CatalogSeedManifest = {
  datasetVersion: string;
  previousDatasetVersion?: string | null;
  schemaVersion: string;
  sourcePolicyVersion: string;
  releaseDate: string;
  checksum: string;
  productCount: number;
  addedProductCount?: number;
  matchedProductCount?: number;
  reviewSummary?: {
    blocking: number;
    nonBlocking: number;
  };
  categoryCoverage?: Record<string, number>;
  formCoverage?: Record<string, number>;
  sourceCoverage?: {
    withSourceRef: number;
    withSourceRecordId: number;
    fixtureCompatibilityExceptions: number;
    bySourceRef: Record<string, number>;
  };
  legacyResolutionSummary?: Record<string, number>;
  products: ProductSeedRecord[];
};

export type SeedConflict = {
  productKey: string;
  code: string;
  message: string;
  before?: unknown;
  seed?: unknown;
};

export type SeedApplyReport = {
  datasetVersion: string;
  previousDatasetVersion?: string | null;
  checksum: string;
  mode: 'check' | 'dry-run' | 'apply' | 'report';
  status: 'OK' | 'NO_OP' | 'BLOCKED' | 'FAILED' | 'INVALID';
  durationMs: number;
  productCount: number;
  created: string[];
  matchedExisting: string[];
  updatedSoft: string[];
  nutritionVersionsCreated: string[];
  aliasesCreated: number;
  allergensCreated: number;
  dietaryTagsCreated: number;
  rolesCreated: number;
  conflicts: SeedConflict[];
  rejected: SeedConflict[];
  needsReview: string[];
  categoriesCoverage: Record<string, number>;
  formsCoverage: Record<string, number>;
  legacyOutsideDataset: number;
  /** @deprecated use legacyOutsideDataset */
  legacyOutsidePilot: number;
  duplicateCandidates: Array<{ productKey: string; reason: string }>;
  nutritionSources: Record<string, number>;
  notes: string[];
};
