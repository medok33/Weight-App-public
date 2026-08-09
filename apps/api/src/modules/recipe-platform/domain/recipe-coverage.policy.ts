import { createHash } from 'node:crypto';

export const COVERAGE_MATRIX_VERSION_V1 = 'coverage-core-v1' as const;

export const COVERAGE_MEAL_TYPES = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'afternoon_snack',
] as const;
export type CoverageMealType = (typeof COVERAGE_MEAL_TYPES)[number];

/** Extends existing RecipeFamily.dishType (MAIN) with controlled coverage taxonomy. */
export const COVERAGE_DISH_TYPES = [
  'MAIN',
  'SOUP',
  'SALAD',
  'PORRIDGE',
  'SNACK',
  'SIDE',
  'BREAKFAST',
  'BOWL',
  'UNCLASSIFIED',
] as const;
export type CoverageDishType = (typeof COVERAGE_DISH_TYPES)[number];

export const COVERAGE_COOKING_METHODS = [
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

export const COVERAGE_DIETARY_PROFILES = [
  'GENERAL',
  'VEGETARIAN',
  'VEGAN',
  'GLUTEN_FREE',
  'LACTOSE_FREE',
  'HIGH_PROTEIN',
] as const;
export type CoverageDietaryProfile = (typeof COVERAGE_DIETARY_PROFILES)[number];

export const COVERAGE_EQUIPMENT_PROFILES = [
  'BASIC_STOVE',
  'OVEN',
  'MULTICOOKER',
  'BLENDER',
  'GRILL',
  'NO_SPECIAL_EQUIPMENT',
] as const;
export type CoverageEquipmentProfile = (typeof COVERAGE_EQUIPMENT_PROFILES)[number];

export const COVERAGE_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type CoveragePriority = (typeof COVERAGE_PRIORITIES)[number];

export const COVERAGE_SLOT_STATUSES = [
  'EMPTY',
  'UNDERFILLED',
  'COVERED',
  'OVERFILLED',
  'NEEDS_REFRESH',
] as const;
export type CoverageSlotStatus = (typeof COVERAGE_SLOT_STATUSES)[number];

export const COVERAGE_ASSIGNMENT_TYPES = ['PRIMARY', 'SECONDARY', 'MANUAL_OVERRIDE'] as const;
export type CoverageAssignmentType = (typeof COVERAGE_ASSIGNMENT_TYPES)[number];

/** Legacy STEP_209 statuses retained for existing rows. */
export const COVERAGE_MATCH_STATUSES_LEGACY = [
  'MATCHED',
  'PARTIAL',
  'NEEDS_REVIEW',
  'EXCLUDED',
] as const;

/** STEP_210 match contract. */
export const COVERAGE_MATCH_STATUSES = [
  'EXACT_MATCH',
  'PARTIAL_MATCH',
  'AMBIGUOUS',
  'NO_MATCH',
  'INELIGIBLE',
  'STALE',
  ...COVERAGE_MATCH_STATUSES_LEGACY,
] as const;
export type CoverageMatchStatus = (typeof COVERAGE_MATCH_STATUSES)[number];

export const COVERAGE_COST_STATUSES = [
  'CURRENT_PRICE_CONFIRMED',
  'STALE_PRICE',
  'PRICE_INCOMPLETE',
  'PRICE_MISSING',
  'NOT_APPLICABLE',
] as const;
export type CoverageCostStatus = (typeof COVERAGE_COST_STATUSES)[number];

export const COVERAGE_ANALYZER_VERSION = 'coverage-analyzer/v1' as const;
export const COVERAGE_PRIMARY_SCORE_THRESHOLD = 0.85;
export const COVERAGE_PRIMARY_SCORE_GAP = 0.15;
export const COVERAGE_DIRTY_DEBOUNCE_MS = 30_000;
export const COVERAGE_STALE_RUN_MS = 30 * 60 * 1000;
/** Advisory lock namespace for applying analysis (pg_advisory_lock). */
export const COVERAGE_ANALYZER_LOCK_KEY = 210_194_01;

const TEST_RECIPE_KEY =
  /^(cust_|hist_|rp2|rp202|csv_|clone_)/i;

export function isTestOnlyRecipeKey(recipeKey: string | null | undefined): boolean {
  return Boolean(recipeKey && TEST_RECIPE_KEY.test(recipeKey));
}

export type SlotKeyInput = {
  matrixVersion: string;
  mealType: string;
  primaryProductKey: string | null;
  dishType: string;
  cookingMethod: string | null;
  calorieMin: number | null;
  calorieMax: number | null;
  proteinMin: number | null;
  fatMax: number | null;
  maximumTimeMinutes: number | null;
  dietaryProfile: string;
  equipmentProfile: string;
};

export function buildCoverageSlotKey(input: SlotKeyInput): string {
  const band = (min: number | null, max: number | null, prefix: string) => {
    if (min == null && max == null) return `${prefix}any`;
    return `${prefix}${min ?? 'n'}-${max ?? 'n'}`;
  };
  const parts = [
    input.matrixVersion,
    input.mealType,
    input.primaryProductKey ?? 'noproduct',
    input.dishType,
    input.cookingMethod ?? 'anymethod',
    band(input.calorieMin, input.calorieMax, 'cal'),
    band(input.proteinMin, null, 'pro'),
    band(null, input.fatMax, 'fat'),
    input.maximumTimeMinutes == null ? 'timeany' : `time${input.maximumTimeMinutes}`,
    input.dietaryProfile,
    input.equipmentProfile,
  ];
  return parts.map((p) => String(p).toLowerCase().replace(/\s+/g, '_')).join('|');
}

export function assertValidSlotBounds(input: {
  calorieMin?: number | null;
  calorieMax?: number | null;
  proteinMin?: number | null;
  fatMax?: number | null;
  maximumTimeMinutes?: number | null;
  maximumCost?: number | null;
  desiredRecipeCount?: number;
}): void {
  if (
    input.calorieMin != null &&
    input.calorieMax != null &&
    Number(input.calorieMin) > Number(input.calorieMax)
  ) {
    throw new Error('COVERAGE_INVALID_CALORIE_RANGE');
  }
  if (input.proteinMin != null && Number(input.proteinMin) < 0) {
    throw new Error('COVERAGE_INVALID_PROTEIN_MIN');
  }
  if (input.fatMax != null && Number(input.fatMax) < 0) {
    throw new Error('COVERAGE_INVALID_FAT_MAX');
  }
  if (input.maximumTimeMinutes != null && Number(input.maximumTimeMinutes) <= 0) {
    throw new Error('COVERAGE_INVALID_TIME');
  }
  if (input.maximumCost != null && Number(input.maximumCost) <= 0) {
    throw new Error('COVERAGE_INVALID_COST');
  }
  if (input.desiredRecipeCount != null && Number(input.desiredRecipeCount) < 1) {
    throw new Error('COVERAGE_INVALID_DESIRED_COUNT');
  }
}

export function assertControlledEnums(input: {
  mealType: string;
  dishType: string;
  cookingMethod?: string | null;
  dietaryProfile: string;
  equipmentProfile: string;
  priority: string;
}): void {
  if (!(COVERAGE_MEAL_TYPES as readonly string[]).includes(input.mealType)) {
    throw new Error('COVERAGE_INVALID_MEAL_TYPE');
  }
  if (!(COVERAGE_DISH_TYPES as readonly string[]).includes(input.dishType)) {
    throw new Error('COVERAGE_INVALID_DISH_TYPE');
  }
  if (
    input.cookingMethod &&
    !(COVERAGE_COOKING_METHODS as readonly string[]).includes(input.cookingMethod)
  ) {
    throw new Error('COVERAGE_INVALID_COOKING_METHOD');
  }
  if (!(COVERAGE_DIETARY_PROFILES as readonly string[]).includes(input.dietaryProfile)) {
    throw new Error('COVERAGE_INVALID_DIETARY_PROFILE');
  }
  if (!(COVERAGE_EQUIPMENT_PROFILES as readonly string[]).includes(input.equipmentProfile)) {
    throw new Error('COVERAGE_INVALID_EQUIPMENT_PROFILE');
  }
  if (!(COVERAGE_PRIORITIES as readonly string[]).includes(input.priority)) {
    throw new Error('COVERAGE_INVALID_PRIORITY');
  }
}

export function suggestDesiredCount(priority: CoveragePriority): number {
  switch (priority) {
    case 'CRITICAL':
      return 3;
    case 'HIGH':
      return 2;
    case 'MEDIUM':
      return 2;
    case 'LOW':
      return 1;
  }
}

export function computeCoverageStatus(
  publishedRecipeCount: number,
  desiredRecipeCount: number,
  needsRefresh = false,
): CoverageSlotStatus {
  if (needsRefresh) return 'NEEDS_REFRESH';
  if (publishedRecipeCount <= 0) return 'EMPTY';
  if (publishedRecipeCount < desiredRecipeCount) return 'UNDERFILLED';
  if (publishedRecipeCount > desiredRecipeCount) return 'OVERFILLED';
  return 'COVERED';
}

export function isEligibleCoverageVersion(input: {
  lifecycleStatus: string | null;
  validationStatus: string | null;
  isCurrent: boolean;
  hasFingerprint: boolean;
  recipeKey: string | null;
  hasOpenExactDuplicateBlocker: boolean;
  dataClass?: string | null;
}): { eligible: boolean; reason?: string } {
  const dataClass = String(input.dataClass ?? '').toUpperCase();
  if (dataClass && dataClass !== 'PRODUCTION') {
    return { eligible: false, reason: `DATA_CLASS_${dataClass}` };
  }
  if (isTestOnlyRecipeKey(input.recipeKey)) {
    return { eligible: false, reason: 'TEST_ONLY_FIXTURE' };
  }
  if (!input.isCurrent) return { eligible: false, reason: 'NOT_CURRENT_VERSION' };
  if (input.lifecycleStatus !== 'PUBLISHED') {
    return { eligible: false, reason: `LIFECYCLE_${input.lifecycleStatus ?? 'MISSING'}` };
  }
  if (input.validationStatus !== 'VALID') {
    return { eligible: false, reason: `VALIDATION_${input.validationStatus ?? 'MISSING'}` };
  }
  if (!input.hasFingerprint) {
    return { eligible: false, reason: 'MISSING_FINGERPRINT' };
  }
  if (input.hasOpenExactDuplicateBlocker) {
    return { eligible: false, reason: 'OPEN_EXACT_DUPLICATE_BLOCKER' };
  }
  return { eligible: true };
}

/** Positive dietary profiles require known-safe composition; UNKNOWN never matches. */
export function dietaryProfileMatches(
  profile: CoverageDietaryProfile,
  recipeTags: string[] | null | undefined,
  compositionKnown: boolean,
): boolean {
  if (profile === 'GENERAL') return true;
  if (!compositionKnown) return false;
  const normalized = (recipeTags ?? []).map((t) => String(t).toUpperCase());
  if (profile === 'HIGH_PROTEIN') return normalized.includes('HIGH_PROTEIN') || normalized.includes('HIGH-PROTEIN');
  return normalized.includes(profile);
}

export function nutritionPerServing(input: {
  calories: number;
  proteinG: number;
  fatG: number;
  servings: number;
}): { calories: number; proteinG: number; fatG: number } {
  const servings = Math.max(Number(input.servings) || 1, 1);
  return {
    calories: input.calories / servings,
    proteinG: input.proteinG / servings,
    fatG: input.fatG / servings,
  };
}

export function hardMatchScore(input: {
  mealOk: boolean;
  productOk: boolean;
  dishOk: boolean;
  methodOk: boolean;
  dietaryOk: boolean;
  equipmentOk: boolean;
  calorieOk: boolean;
  proteinOk: boolean;
  fatOk: boolean;
  timeOk: boolean;
}): { score: number; hardPass: boolean; reasons: Array<{ code: string; ok: boolean }> } {
  const reasons = [
    { code: 'MEAL_TYPE', ok: input.mealOk },
    { code: 'PRIMARY_PRODUCT', ok: input.productOk },
    { code: 'DISH_TYPE', ok: input.dishOk },
    { code: 'COOKING_METHOD', ok: input.methodOk },
    { code: 'DIETARY', ok: input.dietaryOk },
    { code: 'EQUIPMENT', ok: input.equipmentOk },
    { code: 'CALORIES', ok: input.calorieOk },
    { code: 'PROTEIN', ok: input.proteinOk },
    { code: 'FAT', ok: input.fatOk },
    { code: 'TIME', ok: input.timeOk },
  ];
  const hardPass = reasons.every((r) => r.ok);
  const score = reasons.filter((r) => r.ok).length / reasons.length;
  return { score, hardPass, reasons };
}

export type DimensionOutcome = 'matched' | 'failed' | 'unknown' | 'soft';

export type CoverageMatchContract = {
  eligibility: boolean;
  hardMatch: boolean;
  matchStatus: CoverageMatchStatus;
  score: number;
  matchedDimensions: string[];
  failedDimensions: string[];
  unknownDimensions: string[];
  warnings: string[];
  costStatus: CoverageCostStatus;
  duplicateContentGroupId: string;
  assignmentRecommendation: 'PRIMARY' | 'SECONDARY' | 'NONE' | 'STALE' | 'NEEDS_REVIEW';
  reasons: Array<{ code: string; outcome: DimensionOutcome; detail?: string }>;
};

/**
 * PARTIAL_MATCH (STEP_210): all mandatory hard dimensions passed;
 * one or more optional/soft dimensions are unconfirmed or unknown.
 * Does NOT inflate publishedRecipeCount until PRIMARY / MANUAL_OVERRIDE.
 *
 * STEP_209 "112 PARTIAL" were soft-fail SECONDARY rows (hardPass=false, score≥0.7)
 * stored as matchStatus PARTIAL — not the same as PARTIAL_MATCH here.
 */
export function evaluateCoverageMatch(input: {
  eligible: boolean;
  ineligibleReason?: string;
  contentGroupId: string;
  mealOk: boolean;
  productOk: boolean;
  dishOk: boolean;
  methodOk: boolean;
  dietaryOk: boolean;
  equipmentOk: boolean;
  calorieOk: boolean;
  proteinOk: boolean;
  fatOk: boolean;
  timeOk: boolean;
  /** Cost hard criterion when slot.maximumCost is set. */
  costConstrained: boolean;
  costStatus: CoverageCostStatus;
  costOk: boolean | null;
}): CoverageMatchContract {
  if (!input.eligible) {
    return {
      eligibility: false,
      hardMatch: false,
      matchStatus: 'INELIGIBLE',
      score: 0,
      matchedDimensions: [],
      failedDimensions: [],
      unknownDimensions: [],
      warnings: [input.ineligibleReason ?? 'INELIGIBLE'],
      costStatus: input.costStatus,
      duplicateContentGroupId: input.contentGroupId,
      assignmentRecommendation: 'NONE',
      reasons: [{ code: 'ELIGIBILITY', outcome: 'failed', detail: input.ineligibleReason }],
    };
  }

  const hardDims: Array<{ code: string; outcome: DimensionOutcome }> = [
    { code: 'PRIMARY_PRODUCT', outcome: input.productOk ? 'matched' : 'failed' },
    { code: 'DISH_TYPE', outcome: input.dishOk ? 'matched' : 'failed' },
    { code: 'COOKING_METHOD', outcome: input.methodOk ? 'matched' : 'failed' },
    { code: 'DIETARY', outcome: input.dietaryOk ? 'matched' : 'failed' },
    { code: 'EQUIPMENT', outcome: input.equipmentOk ? 'matched' : 'failed' },
    { code: 'CALORIES', outcome: input.calorieOk ? 'matched' : 'failed' },
    { code: 'PROTEIN', outcome: input.proteinOk ? 'matched' : 'failed' },
    { code: 'FAT', outcome: input.fatOk ? 'matched' : 'failed' },
    { code: 'TIME', outcome: input.timeOk ? 'matched' : 'failed' },
  ];

  if (input.costConstrained) {
    if (input.costOk === true) hardDims.push({ code: 'MAXIMUM_COST', outcome: 'matched' });
    else if (input.costOk === false) hardDims.push({ code: 'MAXIMUM_COST', outcome: 'failed' });
    else hardDims.push({ code: 'MAXIMUM_COST', outcome: 'unknown' });
  }

  // mealType is demand-side soft (recipes are not meal-typed in catalog).
  const softDims: Array<{ code: string; outcome: DimensionOutcome }> = [
    { code: 'MEAL_TYPE', outcome: input.mealOk ? 'matched' : 'soft' },
  ];

  const all = [...hardDims, ...softDims];
  const matchedDimensions = all.filter((d) => d.outcome === 'matched').map((d) => d.code);
  const failedDimensions = hardDims.filter((d) => d.outcome === 'failed').map((d) => d.code);
  const unknownDimensions = hardDims.filter((d) => d.outcome === 'unknown').map((d) => d.code);
  const hardDecidablePass = hardDims.every((d) => d.outcome === 'matched');
  const hardNoFail = failedDimensions.length === 0;
  const score =
    all.filter((d) => d.outcome === 'matched').length / Math.max(all.length, 1);

  let matchStatus: CoverageMatchStatus;
  let assignmentRecommendation: CoverageMatchContract['assignmentRecommendation'];
  const warnings: string[] = [];

  if (failedDimensions.length > 0) {
    matchStatus = 'NO_MATCH';
    assignmentRecommendation = 'NONE';
  } else if (unknownDimensions.length > 0) {
    // Hard dims not failed, but cost/evidence unknown → not proven PRIMARY.
    matchStatus = 'PARTIAL_MATCH';
    assignmentRecommendation = 'NEEDS_REVIEW';
    warnings.push('HARD_DIMENSION_UNKNOWN');
  } else if (hardDecidablePass && softDims.some((d) => d.outcome !== 'matched')) {
    matchStatus = 'PARTIAL_MATCH';
    assignmentRecommendation = 'SECONDARY';
    warnings.push('SOFT_DIMENSION_INCOMPLETE');
  } else if (hardDecidablePass) {
    matchStatus = 'EXACT_MATCH';
    assignmentRecommendation = 'PRIMARY';
  } else {
    matchStatus = 'NO_MATCH';
    assignmentRecommendation = 'NONE';
  }

  return {
    eligibility: true,
    hardMatch: hardDecidablePass && hardNoFail && unknownDimensions.length === 0,
    matchStatus,
    score,
    matchedDimensions,
    failedDimensions,
    unknownDimensions,
    warnings,
    costStatus: input.costStatus,
    duplicateContentGroupId: input.contentGroupId,
    assignmentRecommendation,
    reasons: all.map((d) => ({ code: d.code, outcome: d.outcome })),
  };
}

export function resolveCostCriterion(input: {
  maximumCost: number | null | undefined;
  consumedCostPerServing: number | null;
  costStatus: CoverageCostStatus;
}): { costConstrained: boolean; costOk: boolean | null; costStatus: CoverageCostStatus } {
  if (input.maximumCost == null) {
    return { costConstrained: false, costOk: true, costStatus: 'NOT_APPLICABLE' };
  }
  if (
    input.costStatus === 'PRICE_MISSING' ||
    input.costStatus === 'PRICE_INCOMPLETE' ||
    input.costStatus === 'STALE_PRICE' ||
    input.consumedCostPerServing == null
  ) {
    return {
      costConstrained: true,
      costOk: null,
      costStatus:
        input.costStatus === 'NOT_APPLICABLE' ? 'PRICE_MISSING' : input.costStatus,
    };
  }
  if (input.costStatus !== 'CURRENT_PRICE_CONFIRMED') {
    return { costConstrained: true, costOk: null, costStatus: input.costStatus };
  }
  return {
    costConstrained: true,
    costOk: input.consumedCostPerServing <= Number(input.maximumCost),
    costStatus: 'CURRENT_PRICE_CONFIRMED',
  };
}

export function stableJsonChecksum(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function mergeDirtyReasonSets(
  existing: string[],
  incoming: string[],
): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

export function mergeIdSets(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

/** Triggers that mark coverage dirty (STEP_210). */
export const COVERAGE_DIRTY_TRIGGERS = [
  'RECIPE_VERSION_PUBLISHED',
  'RECIPE_VERSION_SUPERSEDED',
  'RECIPE_VERSION_SUSPENDED',
  'RECIPE_VERSION_ARCHIVED',
  'VALIDATION_VALID',
  'VALIDATION_NEEDS_REVALIDATION',
  'VALIDATION_BLOCKED',
  'FINGERPRINT_REBUILD',
  'DUPLICATE_RESOLVED',
  'RECIPE_FAMILY_ASSIGNED',
  'COVERAGE_SLOT_CHANGED',
  'MATRIX_VERSION_APPLIED',
  'COST_PRICE_REFRESH',
  'SCHEDULED_DAILY',
  'MANUAL',
] as const;

/** Explicit non-triggers (documented). */
export const COVERAGE_NON_TRIGGERS = [
  'ALIAS_DISPLAY_CORRECTION',
  'MEDIA_TAKEDOWN_WITHOUT_MEDIA_CRITERION',
  'PRICE_OBSERVATION_WITHOUT_COST_SLOT',
] as const;

export function duplicateContentGroupId(leftVersionId: string, rightVersionId: string): string {
  const [a, b] = leftVersionId < rightVersionId ? [leftVersionId, rightVersionId] : [rightVersionId, leftVersionId];
  return createHash('sha256').update(`${a}:${b}`).digest('hex').slice(0, 24);
}

export function countsTowardPublished(assignment: {
  assignmentType: string;
  matchStatus: string;
  active?: boolean;
}): boolean {
  if (assignment.active === false) return false;
  if (assignment.matchStatus === 'STALE' || assignment.matchStatus === 'INELIGIBLE') return false;
  // PARTIAL_MATCH never inflates publishedRecipeCount until promoted to PRIMARY/MANUAL_OVERRIDE.
  if (assignment.matchStatus === 'PARTIAL_MATCH' || assignment.matchStatus === 'PARTIAL') return false;
  if (assignment.assignmentType === 'MANUAL_OVERRIDE') return true;
  if (assignment.assignmentType !== 'PRIMARY') return false;
  return assignment.matchStatus === 'MATCHED' || assignment.matchStatus === 'EXACT_MATCH';
}
