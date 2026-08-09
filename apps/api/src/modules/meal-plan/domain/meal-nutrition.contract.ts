import type { MacroTotals } from './meal-dish.nutrition';
import { scaleMacros } from './meal-dish.nutrition';

export type NutritionBasis = 'PER_BASE_SERVING' | 'PER_RECIPE_SERVINGS' | 'CUSTOMIZATION';

export type MealNutritionContract = {
  nutritionBasis: NutritionBasis;
  baseServingGrams: number | null;
  servingMultiplier: number;
  displayedPortionGrams: number | null;
  portionScale: number;
  totalScale: number;
  displayedNutrition: MacroTotals;
};

/**
 * displayedPortionGrams / baseServingGrams × servingMultiplier.
 * If baseServingGrams is missing, portionScale=1 (servings only).
 */
export function resolvePortionScale(input: {
  baseServingGrams: number | null | undefined;
  displayedPortionGrams: number | null | undefined;
  servingMultiplier?: number | null;
}): { servingMultiplier: number; portionScale: number; totalScale: number; displayedPortionGrams: number | null } {
  const servingMultiplier =
    input.servingMultiplier != null && Number(input.servingMultiplier) > 0
      ? Number(input.servingMultiplier)
      : 1;
  const base =
    input.baseServingGrams != null && Number(input.baseServingGrams) > 0
      ? Number(input.baseServingGrams)
      : null;
  const displayed =
    input.displayedPortionGrams != null && Number(input.displayedPortionGrams) > 0
      ? Number(input.displayedPortionGrams)
      : base;
  const portionScale = base != null && displayed != null ? displayed / base : 1;
  return {
    servingMultiplier,
    portionScale,
    totalScale: portionScale * servingMultiplier,
    displayedPortionGrams: displayed,
  };
}

export function buildMealNutritionContract(input: {
  nutritionBasis?: NutritionBasis;
  baseServingGrams: number | null | undefined;
  displayedPortionGrams: number | null | undefined;
  servingMultiplier?: number | null;
  baseNutrition: MacroTotals;
}): MealNutritionContract {
  const scale = resolvePortionScale(input);
  return {
    nutritionBasis: input.nutritionBasis ?? 'PER_BASE_SERVING',
    baseServingGrams:
      input.baseServingGrams != null && Number(input.baseServingGrams) > 0
        ? Number(input.baseServingGrams)
        : null,
    servingMultiplier: scale.servingMultiplier,
    displayedPortionGrams: scale.displayedPortionGrams,
    portionScale: scale.portionScale,
    totalScale: scale.totalScale,
    displayedNutrition: scaleMacros(input.baseNutrition, scale.totalScale),
  };
}
