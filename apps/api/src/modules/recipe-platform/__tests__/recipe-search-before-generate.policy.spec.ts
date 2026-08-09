import { describe, expect, it } from 'vitest';
import {
  assertDecisionUsable,
  assertNoClientControlledSearchFields,
  buildSearchInputChecksum,
  buildSearchResultChecksum,
  compareSearchCandidates,
  decideSearchRecommendation,
  findPortionAdjustment,
  hashSearchDecisionToken,
  issueSearchDecisionToken,
  scoreSearchCandidate,
  verifySearchDecisionToken,
  type RankableCandidate,
  type SearchCandidateType,
} from '../domain/recipe-search-before-generate.policy';

function candidate(
  partial: Partial<RankableCandidate> & { candidateType: SearchCandidateType; recipeVersionId: string },
): RankableCandidate & { score: number } {
  const base: RankableCandidate = {
    candidateType: partial.candidateType,
    hardMatch: partial.hardMatch ?? false,
    existingCoverage: partial.existingCoverage ?? false,
    nutritionFit: partial.nutritionFit ?? 0.5,
    primaryProductMatch: partial.primaryProductMatch ?? false,
    cookingMethodMatch: partial.cookingMethodMatch ?? false,
    dietaryOk: partial.dietaryOk ?? true,
    equipmentOk: partial.equipmentOk ?? true,
    timeOk: partial.timeOk ?? true,
    costConfidence: partial.costConfidence ?? 0.5,
    familyRelated: partial.familyRelated ?? false,
    duplicatePenalty: partial.duplicatePenalty ?? 0,
    adaptationComplexity: partial.adaptationComplexity ?? 0,
    recipeVersionId: partial.recipeVersionId,
  };
  return { ...base, score: scoreSearchCandidate(base) };
}

describe('recipe-search-before-generate.policy (STEP_211)', () => {
  it('builds deterministic input/result checksums', () => {
    const input = {
      searchSchemaVersion: 'recipe-search-before-generate/v1',
      requestType: 'COVERAGE_SLOT_REVIEW' as const,
      matrixVersion: 'coverage-core-v1',
      coverageSlotId: 'slot-1',
      slotSnapshot: {
        id: 'slot-1',
        matrixVersion: 'coverage-core-v1',
        slotKey: 'k',
        mealType: 'lunch',
        primaryProductId: null,
        dishType: 'MAIN',
        cookingMethod: null,
        calorieMin: 300,
        calorieMax: 500,
        proteinMin: 20,
        fatMax: 20,
        maximumTimeMinutes: 40,
        maximumCost: null,
        dietaryProfile: 'OMNIVORE',
        equipmentProfile: 'BASIC_STOVE',
        status: 'EMPTY',
        publishedRecipeCount: 0,
        desiredRecipeCount: 2,
      },
      overrides: null,
      catalogStateChecksum: 'abc',
      coverageResultChecksum: 'def',
      analyzerDirty: false,
    };
    expect(buildSearchInputChecksum(input)).toBe(buildSearchInputChecksum({ ...input }));
    expect(buildSearchInputChecksum(input)).toMatch(/^[a-f0-9]{64}$/);

    const result = {
      recommendation: 'RESEARCH_REQUIRED' as const,
      candidates: [
        { recipeVersionId: 'v2', candidateType: 'FAMILY_VARIANT' as const, score: 610.1234567, rank: 2 },
        { recipeVersionId: 'v1', candidateType: 'EXACT_SLOT_MATCH' as const, score: 940.1, rank: 1 },
      ],
      exactDuplicateBlockers: ['b', 'a'],
      coverageAnalysisRequired: false,
    };
    const a = buildSearchResultChecksum(result);
    const b = buildSearchResultChecksum({
      ...result,
      exactDuplicateBlockers: ['a', 'b'],
      candidates: [...result.candidates],
    });
    expect(a).toBe(b);
  });

  it('finds realistic portion adjustments and rejects unrealistic ones', () => {
    const ok = findPortionAdjustment({
      baseCalories: 400,
      baseProteinG: 30,
      baseFatG: 12,
      calorieMin: 450,
      calorieMax: 550,
      proteinMin: 25,
      fatMax: 20,
    });
    expect(ok.feasible).toBe(true);
    expect(ok.multiplier).toBeGreaterThan(1);
    expect(ok.multiplier).toBeLessThanOrEqual(1.5);

    const exact = findPortionAdjustment({
      baseCalories: 400,
      baseProteinG: 30,
      baseFatG: 12,
      calorieMin: 350,
      calorieMax: 450,
      proteinMin: 20,
      fatMax: 20,
    });
    expect(exact.feasible).toBe(true);
    expect(exact.multiplier).toBe(1);

    const bad = findPortionAdjustment({
      baseCalories: 100,
      baseProteinG: 5,
      baseFatG: 2,
      calorieMin: 800,
      calorieMax: 900,
      proteinMin: 40,
      fatMax: 10,
    });
    expect(bad.feasible).toBe(false);
    expect(bad.reason).toBe('UNREALISTIC_PORTION');
  });

  it('recommendation matrix: exact → portion → adapt → family → duplicate → research → blocked', () => {
    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: true,
        hasPortionAdjustable: true,
        hasSafeAdaptation: true,
        hasFamilyVariant: true,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('USE_EXISTING_RECIPE');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: false,
        hasPortionAdjustable: true,
        hasSafeAdaptation: true,
        hasFamilyVariant: true,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('ADJUST_PORTION_OF_EXISTING');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: false,
        hasPortionAdjustable: false,
        hasSafeAdaptation: true,
        hasFamilyVariant: true,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('ADAPT_EXISTING_RECIPE');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: false,
        hasPortionAdjustable: false,
        hasSafeAdaptation: false,
        hasFamilyVariant: true,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('CREATE_FAMILY_VARIANT');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: true,
        hasPortionAdjustable: false,
        hasSafeAdaptation: false,
        hasFamilyVariant: false,
        hasUnresolvedExactDuplicateBlocker: true,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('REVIEW_DUPLICATE_CANDIDATES');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: false,
        hasPortionAdjustable: false,
        hasSafeAdaptation: false,
        hasFamilyVariant: false,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('RESEARCH_REQUIRED');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: false,
        hasPortionAdjustable: false,
        hasSafeAdaptation: false,
        hasFamilyVariant: false,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: true,
        slotContradictory: false,
        coverageAnalysisRequired: true,
      }),
    ).toBe('BLOCKED_NO_SAFE_ACTION');

    expect(
      decideSearchRecommendation({
        hasEligibleExactCoverage: false,
        hasPortionAdjustable: false,
        hasSafeAdaptation: false,
        hasFamilyVariant: false,
        hasUnresolvedExactDuplicateBlocker: false,
        hasAnySafeCatalog: false,
        slotContradictory: false,
        coverageAnalysisRequired: false,
      }),
    ).toBe('BLOCKED_NO_SAFE_ACTION');
  });

  it('ranks EXISTING_COVERAGE above EXACT above PORTION above ADAPT', () => {
    const items = [
      candidate({ candidateType: 'PORTION_ADJUSTABLE', recipeVersionId: 'c' }),
      candidate({ candidateType: 'EXISTING_COVERAGE', recipeVersionId: 'a', hardMatch: true, existingCoverage: true }),
      candidate({ candidateType: 'SAFE_SUBSTITUTION_ADAPTABLE', recipeVersionId: 'd' }),
      candidate({ candidateType: 'EXACT_SLOT_MATCH', recipeVersionId: 'b', hardMatch: true }),
    ].sort(compareSearchCandidates);
    expect(items.map((i) => i.candidateType)).toEqual([
      'EXISTING_COVERAGE',
      'EXACT_SLOT_MATCH',
      'PORTION_ADJUSTABLE',
      'SAFE_SUBSTITUTION_ADAPTABLE',
    ]);
  });

  it('issues/verifies decision tokens and assertDecisionUsable rejects stale/used/invalidated', () => {
    const issued = issueSearchDecisionToken({
      searchRunId: 'run-1',
      coverageSlotId: 'slot-1',
      recommendation: 'RESEARCH_REQUIRED',
      inputChecksum: 'in',
      resultChecksum: 'out',
      matrixVersion: 'coverage-core-v1',
      catalogStateChecksum: 'cat',
      oneTime: true,
    });
    expect(issued.token).toContain('.');
    expect(hashSearchDecisionToken(issued.token)).toBe(issued.tokenHash);
    const payload = verifySearchDecisionToken(issued.token);
    expect(payload.searchRunId).toBe('run-1');

    assertDecisionUsable(
      {
        expiresAt: issued.expiresAt,
        usedAt: null,
        invalidatedAt: null,
        oneTime: true,
        recommendation: 'RESEARCH_REQUIRED',
        matrixVersion: 'coverage-core-v1',
        catalogStateChecksum: 'cat',
        coverageSlotId: 'slot-1',
      },
      {
        matrixVersion: 'coverage-core-v1',
        coverageSlotId: 'slot-1',
        catalogStateChecksum: 'cat',
      },
    );

    expect(() =>
      assertDecisionUsable(
        {
          expiresAt: new Date(Date.now() - 1000),
          usedAt: null,
          invalidatedAt: null,
          oneTime: true,
          recommendation: 'RESEARCH_REQUIRED',
          matrixVersion: 'coverage-core-v1',
          catalogStateChecksum: 'cat',
          coverageSlotId: 'slot-1',
        },
        {
          matrixVersion: 'coverage-core-v1',
          coverageSlotId: 'slot-1',
          catalogStateChecksum: 'cat',
        },
      ),
    ).toThrow('SEARCH_DECISION_EXPIRED');

    expect(() =>
      assertDecisionUsable(
        {
          expiresAt: issued.expiresAt,
          usedAt: new Date(),
          invalidatedAt: null,
          oneTime: true,
          recommendation: 'RESEARCH_REQUIRED',
          matrixVersion: 'coverage-core-v1',
          catalogStateChecksum: 'cat',
          coverageSlotId: 'slot-1',
        },
        {
          matrixVersion: 'coverage-core-v1',
          coverageSlotId: 'slot-1',
          catalogStateChecksum: 'cat',
        },
      ),
    ).toThrow('SEARCH_DECISION_ALREADY_USED');

    expect(() =>
      assertDecisionUsable(
        {
          expiresAt: issued.expiresAt,
          usedAt: null,
          invalidatedAt: new Date(),
          oneTime: true,
          recommendation: 'RESEARCH_REQUIRED',
          matrixVersion: 'coverage-core-v1',
          catalogStateChecksum: 'cat',
          coverageSlotId: 'slot-1',
        },
        {
          matrixVersion: 'coverage-core-v1',
          coverageSlotId: 'slot-1',
          catalogStateChecksum: 'cat',
        },
      ),
    ).toThrow('SEARCH_DECISION_INVALIDATED');

    expect(() =>
      assertDecisionUsable(
        {
          expiresAt: issued.expiresAt,
          usedAt: null,
          invalidatedAt: null,
          oneTime: true,
          recommendation: 'USE_EXISTING_RECIPE',
          matrixVersion: 'coverage-core-v1',
          catalogStateChecksum: 'cat',
          coverageSlotId: 'slot-1',
        },
        {
          matrixVersion: 'coverage-core-v1',
          coverageSlotId: 'slot-1',
          catalogStateChecksum: 'cat',
        },
      ),
    ).toThrow('SEARCH_DECISION_RECOMMENDATION_NOT_ELIGIBLE');
  });

  it('rejects client-controlled search fields', () => {
    expect(() => assertNoClientControlledSearchFields({ recommendation: 'RESEARCH_REQUIRED' })).toThrow(
      'SEARCH_CLIENT_CONTROLLED_FIELD_FORBIDDEN',
    );
    expect(() => assertNoClientControlledSearchFields({ score: 99 })).toThrow(
      'SEARCH_CLIENT_CONTROLLED_FIELD_FORBIDDEN',
    );
    expect(() => assertNoClientControlledSearchFields({ reason: 'ok', coverageSlotId: 'x' })).not.toThrow();
  });
});
