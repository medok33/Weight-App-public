import { normalizeMealKey } from '../../meal-plan/domain/meal-keys';
import type { CatalogIngredient, ShoppingCategory } from './shopping-list.types';

const MEAL_INGREDIENTS: Record<string, CatalogIngredient[]> = {
  greek_yogurt: [
    { productKey: 'greek_yogurt', name: 'greek_yogurt', category: 'dairy', quantity: 200, unit: 'g', packageSize: 400, fallbackUnitPrice: 120 },
    { productKey: 'honey', name: 'honey', category: 'pantry', quantity: 20, unit: 'g', packageSize: 500, fallbackUnitPrice: 280 },
  ],
  garden_salad: [
    { productKey: 'lettuce', name: 'lettuce', category: 'vegetables', quantity: 150, unit: 'g', packageSize: 300, fallbackUnitPrice: 90 },
    { productKey: 'tomato', name: 'tomato', category: 'vegetables', quantity: 120, unit: 'g', packageSize: 500, fallbackUnitPrice: 140 },
    { productKey: 'olive_oil', name: 'olive_oil', category: 'pantry', quantity: 15, unit: 'ml', packageSize: 500, fallbackUnitPrice: 450 },
  ],
  vegetable_soup: [
    { productKey: 'carrot', name: 'carrot', category: 'vegetables', quantity: 100, unit: 'g', packageSize: 500, fallbackUnitPrice: 70 },
    { productKey: 'onion', name: 'onion', category: 'vegetables', quantity: 80, unit: 'g', packageSize: 1000, fallbackUnitPrice: 50 },
    { productKey: 'potato', name: 'potato', category: 'vegetables', quantity: 150, unit: 'g', packageSize: 2000, fallbackUnitPrice: 80 },
  ],
  egg_scramble: [
    { productKey: 'eggs', name: 'eggs', category: 'protein', quantity: 120, unit: 'g', packageSize: 600, fallbackUnitPrice: 110 },
    { productKey: 'butter', name: 'butter', category: 'dairy', quantity: 10, unit: 'g', packageSize: 180, fallbackUnitPrice: 160 },
  ],
  oatmeal_bowl: [
    { productKey: 'oats', name: 'oats', category: 'grains', quantity: 60, unit: 'g', packageSize: 500, fallbackUnitPrice: 95 },
    { productKey: 'milk', name: 'milk', category: 'dairy', quantity: 200, unit: 'ml', packageSize: 1000, fallbackUnitPrice: 85 },
  ],
  whole_grain_pasta: [
    { productKey: 'pasta', name: 'whole_grain_pasta_product', category: 'grains', quantity: 90, unit: 'g', packageSize: 500, fallbackUnitPrice: 130 },
    { productKey: 'tomato_sauce', name: 'tomato_sauce', category: 'pantry', quantity: 120, unit: 'g', packageSize: 400, fallbackUnitPrice: 110 },
  ],
  baked_fish: [
    { productKey: 'white_fish', name: 'white_fish', category: 'protein', quantity: 180, unit: 'g', packageSize: 500, fallbackUnitPrice: 420 },
    { productKey: 'lemon', name: 'lemon', category: 'fruit', quantity: 40, unit: 'g', packageSize: 200, fallbackUnitPrice: 100 },
  ],
  grilled_chicken_bowl: [
    { productKey: 'chicken_breast', name: 'chicken_breast', category: 'protein', quantity: 180, unit: 'g', packageSize: 500, fallbackUnitPrice: 320 },
    { productKey: 'rice', name: 'rice', category: 'grains', quantity: 80, unit: 'g', packageSize: 900, fallbackUnitPrice: 110 },
    { productKey: 'broccoli', name: 'broccoli', category: 'vegetables', quantity: 120, unit: 'g', packageSize: 400, fallbackUnitPrice: 150 },
  ],
  protein_power_bowl: [
    { productKey: 'chicken_breast', name: 'chicken_breast', category: 'protein', quantity: 150, unit: 'g', packageSize: 500, fallbackUnitPrice: 320 },
    { productKey: 'quinoa', name: 'quinoa', category: 'grains', quantity: 70, unit: 'g', packageSize: 500, fallbackUnitPrice: 260 },
    { productKey: 'avocado', name: 'avocado', category: 'fruit', quantity: 80, unit: 'g', packageSize: 200, fallbackUnitPrice: 180 },
    { productKey: 'greek_yogurt', name: 'greek_yogurt', category: 'dairy', quantity: 100, unit: 'g', packageSize: 400, fallbackUnitPrice: 120 },
  ],
  buckwheat_chicken: [
    { productKey: 'step093_buckwheat', name: 'buckwheat', category: 'grains', quantity: 80, unit: 'g', packageSize: 900, fallbackUnitPrice: 95 },
    { productKey: 'chicken_breast', name: 'chicken_breast', category: 'protein', quantity: 160, unit: 'g', packageSize: 500, fallbackUnitPrice: 320 },
    { productKey: 'broccoli', name: 'broccoli', category: 'vegetables', quantity: 100, unit: 'g', packageSize: 400, fallbackUnitPrice: 150 },
  ],
  rice_turkey: [
    { productKey: 'step093_white_rice', name: 'rice', category: 'grains', quantity: 80, unit: 'g', packageSize: 900, fallbackUnitPrice: 110 },
    { productKey: 'step093_turkey', name: 'turkey', category: 'protein', quantity: 170, unit: 'g', packageSize: 500, fallbackUnitPrice: 380 },
    { productKey: 'broccoli', name: 'broccoli', category: 'vegetables', quantity: 100, unit: 'g', packageSize: 400, fallbackUnitPrice: 150 },
  ],
  potato_fish: [
    { productKey: 'step093_potato', name: 'potato', category: 'vegetables', quantity: 200, unit: 'g', packageSize: 1000, fallbackUnitPrice: 45 },
    { productKey: 'white_fish', name: 'white_fish', category: 'protein', quantity: 150, unit: 'g', packageSize: 500, fallbackUnitPrice: 420 },
  ],
  pasta_chicken: [
    { productKey: 'step093_pasta', name: 'pasta', category: 'grains', quantity: 120, unit: 'g', packageSize: 500, fallbackUnitPrice: 90 },
    { productKey: 'chicken_breast', name: 'chicken_breast', category: 'protein', quantity: 150, unit: 'g', packageSize: 500, fallbackUnitPrice: 320 },
  ],
  potato_chicken: [
    { productKey: 'step093_potato', name: 'potato', category: 'vegetables', quantity: 220, unit: 'g', packageSize: 1000, fallbackUnitPrice: 45 },
    { productKey: 'chicken_breast', name: 'chicken_breast', category: 'protein', quantity: 160, unit: 'g', packageSize: 500, fallbackUnitPrice: 320 },
    { productKey: 'broccoli', name: 'broccoli', category: 'vegetables', quantity: 100, unit: 'g', packageSize: 400, fallbackUnitPrice: 150 },
  ],
};

export function ingredientsForMealName(mealName: string): CatalogIngredient[] {
  const key = normalizeMealKey(mealName);
  return MEAL_INGREDIENTS[key] ?? [
    {
      productKey: 'pantry_staple',
      name: 'pantry_staple',
      category: 'other' as ShoppingCategory,
      quantity: 1,
      unit: 'pack',
      packageSize: 1,
      fallbackUnitPrice: 150,
    },
  ];
}

export function expandMealPlanIngredients(meals: Array<{ mealName: string; dayIndex: number }>): Array<CatalogIngredient & { dayIndex: number }> {
  return meals.flatMap((meal) => ingredientsForMealName(meal.mealName).map((ingredient) => ({ ...ingredient, dayIndex: meal.dayIndex })));
}
