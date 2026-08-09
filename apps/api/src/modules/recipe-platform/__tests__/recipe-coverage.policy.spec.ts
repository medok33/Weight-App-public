import { describe, expect, it } from 'vitest';
import {
  assertValidSlotBounds,
  buildCoverageSlotKey,
  computeCoverageStatus,
  dietaryProfileMatches,
  isEligibleCoverageVersion,
  isTestOnlyRecipeKey,
  nutritionPerServing,
  suggestDesiredCount,
} from '../domain/recipe-coverage.policy';
import { COVERAGE_CORE_V1_SLOT_COUNT } from '../seed/coverage-core-v1.slots';

describe('recipe coverage policy (STEP_209)', () => {
  it('builds deterministic slotKey independent of display name', () => {
    const a = buildCoverageSlotKey({
      matrixVersion: 'coverage-core-v1',
      mealType: 'lunch',
      primaryProductKey: 'chicken_breast',
      dishType: 'MAIN',
      cookingMethod: 'FRY',
      calorieMin: 300,
      calorieMax: 650,
      proteinMin: 25,
      fatMax: 25,
      maximumTimeMinutes: 45,
      dietaryProfile: 'GENERAL',
      equipmentProfile: 'BASIC_STOVE',
    });
    const b = buildCoverageSlotKey({
      matrixVersion: 'coverage-core-v1',
      mealType: 'lunch',
      primaryProductKey: 'chicken_breast',
      dishType: 'MAIN',
      cookingMethod: 'FRY',
      calorieMin: 300,
      calorieMax: 650,
      proteinMin: 25,
      fatMax: 25,
      maximumTimeMinutes: 45,
      dietaryProfile: 'GENERAL',
      equipmentProfile: 'BASIC_STOVE',
    });
    expect(a).toBe(b);
    expect(a).toContain('coverage-core-v1|lunch|chicken_breast|main|fry');
  });

  it('rejects invalid ranges and validates desired counts', () => {
    expect(() => assertValidSlotBounds({ calorieMin: 500, calorieMax: 100 })).toThrow(
      /COVERAGE_INVALID_CALORIE_RANGE/,
    );
    expect(() => assertValidSlotBounds({ desiredRecipeCount: 0 })).toThrow(/COVERAGE_INVALID_DESIRED_COUNT/);
    expect(suggestDesiredCount('CRITICAL')).toBeGreaterThanOrEqual(2);
  });

  it('computes status and nutrition per serving', () => {
    expect(computeCoverageStatus(0, 2)).toBe('EMPTY');
    expect(computeCoverageStatus(1, 2)).toBe('UNDERFILLED');
    expect(computeCoverageStatus(2, 2)).toBe('COVERED');
    expect(computeCoverageStatus(3, 2)).toBe('OVERFILLED');
    expect(nutritionPerServing({ calories: 400, proteinG: 40, fatG: 20, servings: 2 })).toEqual({
      calories: 200,
      proteinG: 20,
      fatG: 10,
    });
  });

  it('excludes test fixtures and unknown dietary positive matches', () => {
    expect(isTestOnlyRecipeKey('clone_abc')).toBe(true);
    expect(isTestOnlyRecipeKey('buckwheat_chicken')).toBe(false);
    expect(dietaryProfileMatches('VEGAN', ['VEGAN'], true)).toBe(true);
    expect(dietaryProfileMatches('VEGAN', [], false)).toBe(false);
    expect(
      isEligibleCoverageVersion({
        lifecycleStatus: 'PUBLISHED',
        validationStatus: 'VALID',
        isCurrent: true,
        hasFingerprint: false,
        recipeKey: 'buckwheat_chicken',
        hasOpenExactDuplicateBlocker: false,
      }).reason,
    ).toBe('MISSING_FINGERPRINT');
  });

  it('seeds 50–80 curated slots (no Cartesian explosion)', () => {
    expect(COVERAGE_CORE_V1_SLOT_COUNT).toBeGreaterThanOrEqual(50);
    expect(COVERAGE_CORE_V1_SLOT_COUNT).toBeLessThanOrEqual(80);
  });
});
