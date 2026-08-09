import type { RecipeCandidate } from './meal-plan.types';
import { normalizeMealKey } from './meal-keys';

export const DEFAULT_MEAL_RECIPES: RecipeCandidate[] = [
  { id: 'r-yogurt', name: 'greek_yogurt', calories: 190, proteinG: 17 },
  { id: 'r-salad', name: 'garden_salad', calories: 240, proteinG: 8 },
  { id: 'r-soup', name: 'vegetable_soup', calories: 280, proteinG: 10 },
  { id: 'r-eggs', name: 'egg_scramble', calories: 300, proteinG: 22 },
  { id: 'r-oats', name: 'oatmeal_bowl', calories: 320, proteinG: 12 },
  { id: 'r-pasta', name: 'whole_grain_pasta', calories: 360, proteinG: 14 },
  { id: 'r-fish', name: 'baked_fish', calories: 410, proteinG: 36 },
  { id: 'r-chicken', name: 'grilled_chicken_bowl', calories: 480, proteinG: 42 },
  { id: 'r-bowl', name: 'protein_power_bowl', calories: 560, proteinG: 45 },
];

export function macrosForMealName(name: string, catalog: RecipeCandidate[] = DEFAULT_MEAL_RECIPES) {
  const key = normalizeMealKey(name);
  const recipe = catalog.find((item) => item.name === key || normalizeMealKey(item.name) === key);
  return {
    calories: recipe?.calories ?? 0,
    proteinG: recipe?.proteinG ?? 0,
  };
}

export { normalizeMealKey };
