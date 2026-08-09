import { describe, expect, it } from 'vitest';
import {
  amountToGrams,
  macrosFromIngredient,
  macrosWithinTolerance,
  scaleMacros,
  sumMacros,
} from '../domain/meal-dish.nutrition';
import { costForIngredient, summarizeDishCost } from '../domain/meal-dish.pricing';
import { compareMealSlots, normalizeMealType } from '../domain/meal-dish.ordering';
import { splitCosts } from '../../shopping-list/domain/shopping-list.policy';

describe('meal dish nutrition', () => {
  it('calculates macros from grams', () => {
    const macros = macrosFromIngredient({
      amount: 100,
      unit: 'g',
      caloriesPer100g: 200,
      proteinPer100g: 10,
      fatPer100g: 5,
      carbsPer100g: 20,
    });
    expect(macros).toEqual({ calories: 200, proteinG: 10, fatG: 5, carbsG: 20 });
  });

  it('scales portions and sums ingredients', () => {
    const base = macrosFromIngredient({
      amount: 50,
      unit: 'g',
      caloriesPer100g: 100,
      proteinPer100g: 8,
      fatPer100g: 2,
      carbsPer100g: 10,
    });
    expect(scaleMacros(base, 2).calories).toBe(100);
    expect(sumMacros([base, base]).proteinG).toBe(8);
  });

  it('rejects invalid amounts and detects tolerance breaches', () => {
    expect(() => amountToGrams(0, 'g')).toThrow('INGREDIENT_AMOUNT_INVALID');
    expect(
      macrosWithinTolerance(
        { calories: 100, proteinG: 10, fatG: 5, carbsG: 10 },
        { calories: 130, proteinG: 10, fatG: 5, carbsG: 10 },
        0.05,
      ),
    ).toBe(false);
  });
});

describe('meal dish pricing', () => {
  it('separates consumed and package costs', () => {
    expect(splitCosts(74, 400, 120, 74)).toEqual({
      purchaseCost: 120,
      consumedCost: 22.2,
    });
    const line = costForIngredient({
      productId: 'p1',
      displayName: 'Йогурт',
      amount: 200,
      unit: 'g',
      packageSize: 400,
      packagePriceRub: 120,
    });
    expect(line.consumedCostRub).toBe(60);
    expect(line.packageCostRub).toBe(120);
  });

  it('marks missing prices honestly', () => {
    const summary = summarizeDishCost([
      costForIngredient({
        productId: 'p1',
        displayName: 'Oats',
        amount: 60,
        unit: 'g',
        packageSize: 500,
        packagePriceRub: 95,
      }),
      costForIngredient({
        productId: 'p2',
        displayName: 'Honey',
        amount: 20,
        unit: 'g',
        packageSize: 500,
        packagePriceRub: null,
      }),
    ]);
    expect(summary.status).toBe('partial');
    expect(summary.missingIngredientCount).toBe(1);
    expect(summary.complete).toBe(false);
  });
});

describe('meal ordering', () => {
  it('orders breakfast before dinner', () => {
    expect(normalizeMealType('Breakfast')).toBe('breakfast');
    expect(
      compareMealSlots({ mealType: 'dinner', plannedTime: '19:00' }, { mealType: 'breakfast', plannedTime: '08:00' }),
    ).toBeGreaterThan(0);
  });
});
