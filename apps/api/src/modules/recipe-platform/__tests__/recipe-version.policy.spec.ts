import { describe, expect, it } from 'vitest';
import {
  computeRecipeVersionChecksum,
  DETERMINISTIC_RECIPE_FAMILIES,
  isUsableRecipeVersionStatus,
  macrosFromIngredientAmount,
  stableStringify,
  sumNutrition,
  RECIPE_CURRENT_VERSION_SEMANTICS,
} from '../domain/recipe-version.policy';

describe('recipe-version.policy', () => {
  it('documents model B currentVersion semantics', () => {
    expect(RECIPE_CURRENT_VERSION_SEMANTICS).toBe('B_CURRENT_IS_PUBLISHED');
  });

  it('does not auto-family ambiguous recipes — only deterministic keys', () => {
    const keys = DETERMINISTIC_RECIPE_FAMILIES.flatMap((f) => [...f.recipeKeys]);
    expect(keys).toEqual(['buckwheat_chicken', 'potato_chicken']);
    expect(keys).not.toContain('oatmeal_bowl');
    expect(keys).not.toContain('rice_turkey');
  });

  it('keeps checksum stable for identical snapshots', () => {
    const base = {
      content: {
        title: 'Test',
        description: null,
        servings: 1,
        prepMinutes: 1,
        cookMinutes: 2,
        difficulty: 'easy',
        portionGrams: 100,
        equipment: [],
        recipeKey: 'test',
        allergens: [],
        dietaryTags: [],
      },
      ingredients: [
        {
          productId: 'p1',
          canonicalProductId: 'p1',
          displayName: 'A',
          amount: 10,
          unit: 'g',
          ordering: 1,
        },
      ],
      steps: [{ stepIndex: 0, instruction: 'Cook', durationMinutes: 1, temperatureC: null, equipment: null }],
      nutrition: { calories: 10, proteinG: 1, fatG: 0, carbsG: 2, basis: 'per_recipe_servings', source: 't' },
      restrictions: { allergens: [], dietaryTags: [] },
      servings: 1,
      servingWeightGrams: 100,
    };
    const a = computeRecipeVersionChecksum(base);
    const b = computeRecipeVersionChecksum({
      ...base,
      ingredients: [{ ...base.ingredients[0]!, ordering: 1 }],
    });
    expect(a).toBe(b);
  });

  it('changes checksum when content changes', () => {
    const mk = (title: string) =>
      computeRecipeVersionChecksum({
        content: {
          title,
          description: null,
          servings: 1,
          prepMinutes: null,
          cookMinutes: null,
          difficulty: null,
          portionGrams: null,
          equipment: [],
          recipeKey: null,
          allergens: [],
          dietaryTags: [],
        },
        ingredients: [],
        steps: [],
        nutrition: { calories: 0, proteinG: 0, fatG: 0, carbsG: 0, basis: 'x', source: 'x' },
        restrictions: { allergens: [], dietaryTags: [] },
        servings: 1,
        servingWeightGrams: null,
      });
    expect(mk('A')).not.toBe(mk('B'));
  });

  it('aggregates nutrition and preserves ingredient ordering in stringify', () => {
    const parts = [
      macrosFromIngredientAmount({
        caloriesPer100g: 100,
        proteinPer100g: 10,
        fatPer100g: 1,
        carbsPer100g: 5,
        amount: 50,
        unit: 'g',
      }),
      macrosFromIngredientAmount({
        caloriesPer100g: 200,
        proteinPer100g: 0,
        fatPer100g: 0,
        carbsPer100g: 0,
        amount: 100,
        unit: 'g',
      }),
    ];
    expect(sumNutrition(parts).calories).toBe(250);
    expect(stableStringify([{ ordering: 2 }, { ordering: 1 }])).toContain('"ordering":1');
  });

  it('marks only published/backfill with publishedAt as usable', () => {
    expect(isUsableRecipeVersionStatus('PUBLISHED', new Date())).toBe(true);
    expect(isUsableRecipeVersionStatus('LEGACY_BACKFILL', new Date())).toBe(true);
    expect(isUsableRecipeVersionStatus('DRAFT', null)).toBe(false);
    expect(isUsableRecipeVersionStatus('PUBLISHED', null)).toBe(false);
  });
});
