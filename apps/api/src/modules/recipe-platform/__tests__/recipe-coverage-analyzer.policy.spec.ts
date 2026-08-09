import { describe, expect, it } from 'vitest';
import {
  COVERAGE_ANALYZER_VERSION,
  COVERAGE_DIRTY_TRIGGERS,
  COVERAGE_NON_TRIGGERS,
  computeCoverageStatus,
  countsTowardPublished,
  evaluateCoverageMatch,
  mergeDirtyReasonSets,
  mergeIdSets,
  resolveCostCriterion,
  stableJsonChecksum,
} from '../domain/recipe-coverage.policy';

describe('recipe coverage analyzer policy (STEP_210)', () => {
  it('uses deterministic input/result checksums without volatile fields', () => {
    const a = stableJsonChecksum({ slots: [{ id: '1', status: 'EMPTY' }], ts: undefined });
    const b = stableJsonChecksum({ slots: [{ id: '1', status: 'EMPTY' }] });
    expect(a).toBe(b);
    expect(stableJsonChecksum({ b: 1, a: 2 })).toBe(stableJsonChecksum({ a: 2, b: 1 }));
  });

  it('defines PARTIAL_MATCH as hard pass with soft/unknown incomplete', () => {
    const exact = evaluateCoverageMatch({
      eligible: true,
      contentGroupId: 'g1',
      mealOk: true,
      productOk: true,
      dishOk: true,
      methodOk: true,
      dietaryOk: true,
      equipmentOk: true,
      calorieOk: true,
      proteinOk: true,
      fatOk: true,
      timeOk: true,
      costConstrained: false,
      costStatus: 'NOT_APPLICABLE',
      costOk: true,
    });
    expect(exact.matchStatus).toBe('EXACT_MATCH');
    expect(exact.hardMatch).toBe(true);

    const partialCostUnknown = evaluateCoverageMatch({
      eligible: true,
      contentGroupId: 'g1',
      mealOk: true,
      productOk: true,
      dishOk: true,
      methodOk: true,
      dietaryOk: true,
      equipmentOk: true,
      calorieOk: true,
      proteinOk: true,
      fatOk: true,
      timeOk: true,
      costConstrained: true,
      costStatus: 'PRICE_MISSING',
      costOk: null,
    });
    expect(partialCostUnknown.matchStatus).toBe('PARTIAL_MATCH');
    expect(partialCostUnknown.hardMatch).toBe(false);
    expect(partialCostUnknown.unknownDimensions).toContain('MAXIMUM_COST');
    expect(countsTowardPublished({ assignmentType: 'SECONDARY', matchStatus: 'PARTIAL_MATCH' })).toBe(
      false,
    );
  });

  it('explains STEP_209 PARTIAL metric vs STEP_210 PARTIAL_MATCH', () => {
    // STEP_209 stored soft-fail (hardPass=false) as matchStatus PARTIAL — those must not count.
    expect(countsTowardPublished({ assignmentType: 'SECONDARY', matchStatus: 'PARTIAL' })).toBe(false);
    expect(countsTowardPublished({ assignmentType: 'PRIMARY', matchStatus: 'EXACT_MATCH' })).toBe(true);
    expect(countsTowardPublished({ assignmentType: 'MANUAL_OVERRIDE', matchStatus: 'STALE' })).toBe(false);
  });

  it('resolves cost criterion: confirmed vs stale/missing', () => {
    expect(
      resolveCostCriterion({
        maximumCost: 100,
        consumedCostPerServing: 80,
        costStatus: 'CURRENT_PRICE_CONFIRMED',
      }),
    ).toEqual({ costConstrained: true, costOk: true, costStatus: 'CURRENT_PRICE_CONFIRMED' });
    expect(
      resolveCostCriterion({
        maximumCost: 100,
        consumedCostPerServing: 120,
        costStatus: 'CURRENT_PRICE_CONFIRMED',
      }).costOk,
    ).toBe(false);
    expect(
      resolveCostCriterion({
        maximumCost: 100,
        consumedCostPerServing: 50,
        costStatus: 'STALE_PRICE',
      }).costOk,
    ).toBeNull();
    expect(
      resolveCostCriterion({
        maximumCost: null,
        consumedCostPerServing: null,
        costStatus: 'PRICE_MISSING',
      }).costConstrained,
    ).toBe(false);
  });

  it('computes slot status and merges dirty debounce sets', () => {
    expect(computeCoverageStatus(0, 2)).toBe('EMPTY');
    expect(computeCoverageStatus(1, 2)).toBe('UNDERFILLED');
    expect(computeCoverageStatus(2, 2)).toBe('COVERED');
    expect(computeCoverageStatus(3, 2)).toBe('OVERFILLED');
    expect(computeCoverageStatus(0, 2, true)).toBe('NEEDS_REFRESH');
    expect(mergeDirtyReasonSets(['B'], ['A', 'B'])).toEqual(['A', 'B']);
    expect(mergeIdSets(['u2'], ['u1'])).toEqual(['u1', 'u2']);
  });

  it('documents trigger vs non-trigger policy', () => {
    expect(COVERAGE_DIRTY_TRIGGERS).toContain('RECIPE_VERSION_PUBLISHED');
    expect(COVERAGE_DIRTY_TRIGGERS).toContain('COST_PRICE_REFRESH');
    expect(COVERAGE_NON_TRIGGERS).toContain('ALIAS_DISPLAY_CORRECTION');
    expect(COVERAGE_NON_TRIGGERS).toContain('MEDIA_TAKEDOWN_WITHOUT_MEDIA_CRITERION');
    expect(COVERAGE_ANALYZER_VERSION).toBe('coverage-analyzer/v1');
  });

  it('marks primary ambiguity path as non-auto-primary via AMBIGUOUS recommendation', () => {
    const fail = evaluateCoverageMatch({
      eligible: true,
      contentGroupId: 'g',
      mealOk: true,
      productOk: false,
      dishOk: true,
      methodOk: true,
      dietaryOk: true,
      equipmentOk: true,
      calorieOk: true,
      proteinOk: true,
      fatOk: true,
      timeOk: true,
      costConstrained: false,
      costStatus: 'NOT_APPLICABLE',
      costOk: true,
    });
    expect(fail.matchStatus).toBe('NO_MATCH');
    expect(fail.assignmentRecommendation).toBe('NONE');
  });
});
