import { describe, expect, it } from 'vitest';
import { resolveNutritionTargets } from '../domain/meal-plan.nutrition';
import { selectRecipesForTarget } from '../domain/meal-plan.builder';
import { DEFAULT_MEAL_RECIPES } from '../domain/meal-plan.defaults';

describe('meal plan personalization', () => {
  it('resolves calorie and protein targets from profile and lose-weight goal', () => {
    const targets = resolveNutritionTargets(
      {
        userId: 'u1',
        displayName: 'Alex',
        ageYears: 30,
        heightCm: 180,
        weightKg: 80,
        activityLevel: 'moderate',
      },
      { userId: 'u1', kind: 'lose_weight', target: 75, unit: 'kg' },
    );
    expect(targets?.targetKcal).toBeGreaterThan(1500);
    expect(targets?.proteinG).toBe(96);
    expect(targets?.tdeeKcal).toBeGreaterThan(targets!.targetKcal);
  });

  it('selects recipes closest to meal calorie target', () => {
    const selected = selectRecipesForTarget(DEFAULT_MEAL_RECIPES, 2100);
    expect(selected).toHaveLength(7);
    expect(selected[0]?.calories).toBe(560);
  });
});
