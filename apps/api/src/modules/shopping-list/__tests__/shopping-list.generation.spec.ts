import { describe, expect, it } from 'vitest';
import { expandMealPlanIngredients } from '../domain/shopping-list.catalog';
import { aggregateCatalogIngredients } from '../domain/shopping-list.policy';

describe('shopping list generation', () => {
  it('expands meal plan meals into categorized ingredients', () => {
    const items = expandMealPlanIngredients([
      { mealName: 'protein_power_bowl', dayIndex: 0 },
      { mealName: 'oatmeal_bowl', dayIndex: 1 },
    ]);
    expect(items.some((item) => item.name === 'chicken_breast')).toBe(true);
    expect(items.some((item) => item.category === 'grains')).toBe(true);
  });

  it('aggregates duplicate products across days', () => {
    const expanded = expandMealPlanIngredients([
      { mealName: 'Protein power bowl', dayIndex: 0 },
      { mealName: 'Grilled chicken bowl', dayIndex: 1 },
    ]);
    const aggregated = aggregateCatalogIngredients(expanded);
    const chicken = aggregated.find((item) => item.productKey === 'chicken_breast');
    expect(chicken?.quantity).toBeGreaterThanOrEqual(500);
  });
});
