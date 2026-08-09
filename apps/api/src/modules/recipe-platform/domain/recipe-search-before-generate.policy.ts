import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { stableJsonChecksum, stableStringify } from './recipe-coverage.policy';

export const SEARCH_SCHEMA_VERSION = 'recipe-search-before-generate/v1' as const;
export const SEARCH_DECISION_TTL_MS = 60 * 60 * 1000;
export const SEARCH_RUN_TTL_MS = 24 * 60 * 60 * 1000;
export const PORTION_MULTIPLIER_MIN = 0.67;
export const PORTION_MULTIPLIER_MAX = 1.5;
export const PORTION_MULTIPLIER_STEP = 0.05;

export const SEARCH_REQUEST_TYPES = [
  'COVERAGE_SLOT_REVIEW',
  'NEW_RECIPE_PREFLIGHT',
  'VARIANT_PREFLIGHT',
  'RESEARCH_PREFLIGHT',
  'MANUAL_OWNER_SEARCH',
] as const;
export type SearchRequestType = (typeof SEARCH_REQUEST_TYPES)[number];

export const SEARCH_RUN_STATUSES = [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export type SearchRunStatus = (typeof SEARCH_RUN_STATUSES)[number];

export const SEARCH_CANDIDATE_TYPES = [
  'EXISTING_COVERAGE',
  'EXACT_SLOT_MATCH',
  'PORTION_ADJUSTABLE',
  'SAFE_SUBSTITUTION_ADAPTABLE',
  'FAMILY_VARIANT',
  'NEAR_OR_POSSIBLE_DUPLICATE',
  'HISTORICAL_OR_BLOCKED_CONTEXT',
] as const;
export type SearchCandidateType = (typeof SEARCH_CANDIDATE_TYPES)[number];

export const SEARCH_RECOMMENDATIONS = [
  'USE_EXISTING_RECIPE',
  'ADJUST_PORTION_OF_EXISTING',
  'ADAPT_EXISTING_RECIPE',
  'CREATE_FAMILY_VARIANT',
  'REVIEW_DUPLICATE_CANDIDATES',
  'RESEARCH_REQUIRED',
  'BLOCKED_NO_SAFE_ACTION',
] as const;
export type SearchRecommendation = (typeof SEARCH_RECOMMENDATIONS)[number];

/** Recommendations that may later unlock research/generation (STEP Research). */
export const RESEARCH_ELIGIBLE_RECOMMENDATIONS: readonly SearchRecommendation[] = [
  'RESEARCH_REQUIRED',
  'CREATE_FAMILY_VARIANT',
];

export type SearchSlotSnapshot = {
  id: string;
  matrixVersion: string;
  slotKey: string;
  mealType: string;
  primaryProductId: string | null;
  dishType: string;
  cookingMethod: string | null;
  calorieMin: number | null;
  calorieMax: number | null;
  proteinMin: number | null;
  fatMax: number | null;
  maximumTimeMinutes: number | null;
  maximumCost: number | null;
  dietaryProfile: string;
  equipmentProfile: string;
  status: string;
  publishedRecipeCount: number;
  desiredRecipeCount: number;
};

export type SearchOverrideInput = {
  mealType?: string;
  primaryProductId?: string | null;
  dishType?: string;
  cookingMethod?: string | null;
  calorieMin?: number | null;
  calorieMax?: number | null;
  proteinMin?: number | null;
  fatMax?: number | null;
  maximumTimeMinutes?: number | null;
  maximumCost?: number | null;
  dietaryProfile?: string;
  equipmentProfile?: string;
  desiredVariationIntent?: string;
};

const FORBIDDEN_CLIENT_FIELDS = [
  'eligibility',
  'score',
  'recommendation',
  'contentGroupId',
  'duplicateStatus',
  'searchResult',
  'actorIdentity',
  'inputChecksum',
  'resultChecksum',
  'rank',
] as const;

export function assertNoClientControlledSearchFields(body: Record<string, unknown>): void {
  for (const key of FORBIDDEN_CLIENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      throw new Error('SEARCH_CLIENT_CONTROLLED_FIELD_FORBIDDEN');
    }
  }
}

export function buildSearchInputChecksum(input: {
  searchSchemaVersion: string;
  requestType: SearchRequestType;
  matrixVersion: string;
  coverageSlotId: string | null;
  slotSnapshot: SearchSlotSnapshot | null;
  overrides: SearchOverrideInput | null;
  catalogStateChecksum: string;
  coverageResultChecksum: string | null;
  analyzerDirty: boolean;
}): string {
  return stableJsonChecksum({
    searchSchemaVersion: input.searchSchemaVersion,
    requestType: input.requestType,
    matrixVersion: input.matrixVersion,
    coverageSlotId: input.coverageSlotId,
    slot: input.slotSnapshot
      ? {
          slotKey: input.slotSnapshot.slotKey,
          mealType: input.slotSnapshot.mealType,
          primaryProductId: input.slotSnapshot.primaryProductId,
          dishType: input.slotSnapshot.dishType,
          cookingMethod: input.slotSnapshot.cookingMethod,
          calorieMin: input.slotSnapshot.calorieMin,
          calorieMax: input.slotSnapshot.calorieMax,
          proteinMin: input.slotSnapshot.proteinMin,
          fatMax: input.slotSnapshot.fatMax,
          maximumTimeMinutes: input.slotSnapshot.maximumTimeMinutes,
          maximumCost: input.slotSnapshot.maximumCost,
          dietaryProfile: input.slotSnapshot.dietaryProfile,
          equipmentProfile: input.slotSnapshot.equipmentProfile,
          status: input.slotSnapshot.status,
          publishedRecipeCount: input.slotSnapshot.publishedRecipeCount,
          desiredRecipeCount: input.slotSnapshot.desiredRecipeCount,
        }
      : null,
    overrides: input.overrides ?? null,
    catalogStateChecksum: input.catalogStateChecksum,
    coverageResultChecksum: input.coverageResultChecksum,
    analyzerDirty: input.analyzerDirty,
  });
}

export function buildSearchResultChecksum(result: {
  recommendation: SearchRecommendation;
  candidates: Array<{
    recipeVersionId: string;
    candidateType: SearchCandidateType;
    score: number;
    rank: number;
  }>;
  exactDuplicateBlockers: string[];
  coverageAnalysisRequired?: boolean;
}): string {
  return stableJsonChecksum({
    recommendation: result.recommendation,
    candidates: result.candidates.map((c) => ({
      recipeVersionId: c.recipeVersionId,
      candidateType: c.candidateType,
      score: Number(c.score.toFixed(6)),
      rank: c.rank,
    })),
    exactDuplicateBlockers: [...result.exactDuplicateBlockers].sort(),
    coverageAnalysisRequired: Boolean(result.coverageAnalysisRequired),
  });
}

export type PortionAdjustmentResult = {
  feasible: boolean;
  multiplier: number | null;
  calories: number | null;
  proteinG: number | null;
  fatG: number | null;
  reason?: string;
};

/**
 * Find a realistic serving multiplier that brings per-serving nutrition into slot bands.
 * Rejects adjustments outside [PORTION_MULTIPLIER_MIN, PORTION_MULTIPLIER_MAX].
 */
export function findPortionAdjustment(input: {
  baseCalories: number;
  baseProteinG: number;
  baseFatG: number;
  calorieMin: number | null;
  calorieMax: number | null;
  proteinMin: number | null;
  fatMax: number | null;
}): PortionAdjustmentResult {
  const baseOk =
    (input.calorieMin == null || input.baseCalories >= input.calorieMin) &&
    (input.calorieMax == null || input.baseCalories <= input.calorieMax) &&
    (input.proteinMin == null || input.baseProteinG >= input.proteinMin) &&
    (input.fatMax == null || input.baseFatG <= input.fatMax);
  if (baseOk) {
    return {
      feasible: true,
      multiplier: 1,
      calories: input.baseCalories,
      proteinG: input.baseProteinG,
      fatG: input.baseFatG,
    };
  }

  let best: PortionAdjustmentResult | null = null;
  for (
    let m = PORTION_MULTIPLIER_MIN;
    m <= PORTION_MULTIPLIER_MAX + 1e-9;
    m = Number((m + PORTION_MULTIPLIER_STEP).toFixed(2))
  ) {
    const calories = input.baseCalories * m;
    const proteinG = input.baseProteinG * m;
    const fatG = input.baseFatG * m;
    const ok =
      (input.calorieMin == null || calories >= input.calorieMin) &&
      (input.calorieMax == null || calories <= input.calorieMax) &&
      (input.proteinMin == null || proteinG >= input.proteinMin) &&
      (input.fatMax == null || fatG <= input.fatMax);
    if (!ok) continue;
    const candidate: PortionAdjustmentResult = {
      feasible: true,
      multiplier: m,
      calories,
      proteinG,
      fatG,
    };
    if (
      !best ||
      Math.abs((candidate.multiplier ?? 1) - 1) < Math.abs((best.multiplier ?? 1) - 1)
    ) {
      best = candidate;
    }
  }
  if (best) return best;
  return {
    feasible: false,
    multiplier: null,
    calories: null,
    proteinG: null,
    fatG: null,
    reason: 'UNREALISTIC_PORTION',
  };
}

export type RankableCandidate = {
  candidateType: SearchCandidateType;
  hardMatch: boolean;
  existingCoverage: boolean;
  nutritionFit: number;
  primaryProductMatch: boolean;
  cookingMethodMatch: boolean;
  dietaryOk: boolean;
  equipmentOk: boolean;
  timeOk: boolean;
  costConfidence: number;
  familyRelated: boolean;
  duplicatePenalty: number;
  adaptationComplexity: number;
  recipeVersionId: string;
};

const TYPE_BASE: Record<SearchCandidateType, number> = {
  EXISTING_COVERAGE: 1000,
  EXACT_SLOT_MATCH: 900,
  PORTION_ADJUSTABLE: 800,
  SAFE_SUBSTITUTION_ADAPTABLE: 700,
  FAMILY_VARIANT: 600,
  NEAR_OR_POSSIBLE_DUPLICATE: 200,
  HISTORICAL_OR_BLOCKED_CONTEXT: 50,
};

export function scoreSearchCandidate(c: RankableCandidate): number {
  let score = TYPE_BASE[c.candidateType];
  if (c.hardMatch) score += 40;
  if (c.existingCoverage) score += 30;
  score += Math.round(c.nutritionFit * 20);
  if (c.primaryProductMatch) score += 15;
  if (c.cookingMethodMatch) score += 10;
  if (c.dietaryOk) score += 10;
  if (c.equipmentOk) score += 8;
  if (c.timeOk) score += 8;
  score += Math.round(c.costConfidence * 10);
  if (c.familyRelated) score += 5;
  score -= Math.round(c.duplicatePenalty * 100);
  score -= Math.round(c.adaptationComplexity * 40);
  return score;
}

export function compareSearchCandidates(
  a: RankableCandidate & { score: number },
  b: RankableCandidate & { score: number },
): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.recipeVersionId.localeCompare(b.recipeVersionId);
}

export function decideSearchRecommendation(input: {
  hasEligibleExactCoverage: boolean;
  hasPortionAdjustable: boolean;
  hasSafeAdaptation: boolean;
  hasFamilyVariant: boolean;
  hasUnresolvedExactDuplicateBlocker: boolean;
  hasAnySafeCatalog: boolean;
  slotContradictory: boolean;
  coverageAnalysisRequired: boolean;
}): SearchRecommendation {
  if (input.coverageAnalysisRequired) return 'BLOCKED_NO_SAFE_ACTION';
  if (input.slotContradictory || !input.hasAnySafeCatalog) return 'BLOCKED_NO_SAFE_ACTION';
  if (input.hasUnresolvedExactDuplicateBlocker) return 'REVIEW_DUPLICATE_CANDIDATES';
  if (input.hasEligibleExactCoverage) return 'USE_EXISTING_RECIPE';
  if (input.hasPortionAdjustable) return 'ADJUST_PORTION_OF_EXISTING';
  if (input.hasSafeAdaptation) return 'ADAPT_EXISTING_RECIPE';
  if (input.hasFamilyVariant) return 'CREATE_FAMILY_VARIANT';
  return 'RESEARCH_REQUIRED';
}

export type SearchDecisionPayload = {
  searchRunId: string;
  coverageSlotId: string | null;
  recommendation: SearchRecommendation;
  inputChecksum: string;
  resultChecksum: string;
  matrixVersion: string;
  catalogStateChecksum: string;
  issuedAt: number;
  expiresAt: number;
  oneTime: boolean;
};

function decisionSecret(): string {
  const configured =
    process.env.RECIPE_SEARCH_DECISION_SECRET ||
    process.env.PLAN_REVISION_CONFIRMATION_SECRET ||
    '';
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production' && !process.env.VITEST) {
    throw new Error('RECIPE_SEARCH_DECISION_SECRET_REQUIRED');
  }
  return 'local-recipe-search-decision-secret';
}

function encodePayload(payload: SearchDecisionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function signBody(body: string): string {
  return createHmac('sha256', decisionSecret()).update(body).digest('base64url');
}

export function issueSearchDecisionToken(
  payload: Omit<SearchDecisionPayload, 'issuedAt' | 'expiresAt'>,
  ttlMs = SEARCH_DECISION_TTL_MS,
  nowMs = Date.now(),
): {
  token: string;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  payload: SearchDecisionPayload;
} {
  const issuedAt = nowMs;
  const expiresAt = nowMs + ttlMs;
  const full: SearchDecisionPayload = { ...payload, issuedAt, expiresAt };
  const body = encodePayload(full);
  const token = `${body}.${signBody(body)}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return {
    token,
    tokenHash,
    issuedAt: new Date(issuedAt),
    expiresAt: new Date(expiresAt),
    payload: full,
  };
}

export function verifySearchDecisionToken(token: string): SearchDecisionPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('SEARCH_DECISION_TOKEN_INVALID');
  const expectedSig = signBody(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSig);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('SEARCH_DECISION_TOKEN_INVALID');
  }
  let payload: SearchDecisionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SearchDecisionPayload;
  } catch {
    throw new Error('SEARCH_DECISION_TOKEN_INVALID');
  }
  if (payload.expiresAt < Date.now()) throw new Error('SEARCH_DECISION_EXPIRED');
  return payload;
}

export function hashSearchDecisionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function assertDecisionUsable(
  row: {
    expiresAt: Date | string;
    usedAt: Date | string | null;
    invalidatedAt: Date | string | null;
    oneTime: boolean;
    recommendation: string;
    matrixVersion: string;
    catalogStateChecksum: string;
    coverageSlotId: string | null;
  },
  expected: {
    matrixVersion: string;
    coverageSlotId: string | null;
    catalogStateChecksum: string;
    allowRecommendations?: readonly SearchRecommendation[];
  },
): void {
  if (row.invalidatedAt) throw new Error('SEARCH_DECISION_INVALIDATED');
  if (new Date(row.expiresAt).getTime() < Date.now()) throw new Error('SEARCH_DECISION_EXPIRED');
  if (row.oneTime && row.usedAt) throw new Error('SEARCH_DECISION_ALREADY_USED');
  if (row.matrixVersion !== expected.matrixVersion) throw new Error('SEARCH_DECISION_MATRIX_MISMATCH');
  if ((row.coverageSlotId ?? null) !== (expected.coverageSlotId ?? null)) {
    throw new Error('SEARCH_DECISION_SLOT_MISMATCH');
  }
  if (row.catalogStateChecksum !== expected.catalogStateChecksum) {
    throw new Error('SEARCH_DECISION_CATALOG_STALE');
  }
  const allow = expected.allowRecommendations ?? RESEARCH_ELIGIBLE_RECOMMENDATIONS;
  if (!(allow as readonly string[]).includes(row.recommendation)) {
    throw new Error('SEARCH_DECISION_RECOMMENDATION_NOT_ELIGIBLE');
  }
}

export { stableJsonChecksum, stableStringify };
