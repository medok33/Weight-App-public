import { describe, expect, it } from 'vitest';
import { buildMealNutritionContract, resolvePortionScale } from '../domain/meal-nutrition.contract';

describe('meal nutrition contract (RP2-02A acceptance)', () => {
  it('scales nutrition proportionally when portionGrams changes at fixed servings', () => {
    const base = { calories: 194, proteinG: 20, fatG: 5, carbsG: 10 };
    const at200 = buildMealNutritionContract({
      baseServingGrams: 200,
      displayedPortionGrams: 200,
      servingMultiplier: 1,
      baseNutrition: base,
    });
    const at500 = buildMealNutritionContract({
      baseServingGrams: 200,
      displayedPortionGrams: 500,
      servingMultiplier: 1,
      baseNutrition: base,
    });

    expect(at200.displayedNutrition.calories).toBe(194);
    expect(at500.displayedNutrition.calories).toBe(485);
    expect(at500.totalScale / at200.totalScale).toBeCloseTo(2.5, 5);
  });

  it('multiplies portion scale by servingMultiplier', () => {
    const scale = resolvePortionScale({
      baseServingGrams: 100,
      displayedPortionGrams: 200,
      servingMultiplier: 2,
    });
    expect(scale.portionScale).toBe(2);
    expect(scale.totalScale).toBe(4);
  });

  it('falls back to servings-only when baseServingGrams is missing', () => {
    const scale = resolvePortionScale({
      baseServingGrams: null,
      displayedPortionGrams: 500,
      servingMultiplier: 3,
    });
    expect(scale.portionScale).toBe(1);
    expect(scale.totalScale).toBe(3);
  });
});
