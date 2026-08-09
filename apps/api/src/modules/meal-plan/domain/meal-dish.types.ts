import type { MacroTotals } from './meal-dish.nutrition';
import type { DishCostSummary } from './meal-dish.pricing';
import type { NutritionBasis } from './meal-nutrition.contract';
import type { AllergenPresence, CanonicalAllergenCode, CanonicalDietaryCode } from './dish-restrictions.policy';

export type RecipeStepDto = {
  stepIndex: number;
  instruction: string;
  durationMinutes: number | null;
  temperatureC: number | null;
  equipment: string | null;
};

export type IngredientDetailDto = {
  productId: string;
  displayName: string;
  amount: number;
  unit: string;
  gramsEquivalent: number | null;
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  consumedCostRub: number | null;
  packageCostRub: number | null;
  priceStatus: 'confirmed' | 'estimated' | 'missing' | 'legacy' | 'partial';
  priceSource?: string | null;
  priceSourceLabel?: string | null;
  retailer?: string | null;
  packageWeight?: number | null;
  packageUnit?: string | null;
  priceConfidence?: number | null;
  observedAt?: string | null;
  stale?: boolean;
};

export type IngredientSelectOptionDto = {
  productId: string;
  displayName: string;
  amount: number;
  unit: string;
  label: string;
};

export type UserAllergenView = {
  code: CanonicalAllergenCode;
  label: string;
  presence: AllergenPresence;
};

export type UserDietaryView = {
  code: CanonicalDietaryCode;
  label: string;
};

export type MealDishCardDto = {
  mealPlanId: string;
  mealPlanVersion: number;
  dayId: string;
  dayIndex: number;
  mealId: string;
  mealItemId: string;
  dishId: string;
  recipeId: string;
  recipeVersionId?: string | null;
  recipeVersionNumber?: number | null;
  dishName: string;
  description: string | null;
  mealType: string;
  plannedTime: string | null;
  /** @deprecated prefer displayedPortionGrams */
  portionGrams: number | null;
  portionLabel: string;
  nutritionBasis: NutritionBasis;
  baseServingGrams: number | null;
  servingMultiplier: number;
  displayedPortionGrams: number | null;
  displayedNutrition: MacroTotals;
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  difficulty: string | null;
  /** Localized USER labels only */
  dietaryTags: string[];
  allergens: string[];
  allergenDetails: UserAllergenView[];
  dietaryTagDetails: UserDietaryView[];
  cost: DishCostSummary;
  substitutionReady: {
    mealPlanId: string;
    mealPlanVersion: number;
    dayId: string;
    dayIndex: number;
    mealItemId: string;
    dishId: string;
    recipeId: string;
    recipeVersionId?: string | null;
    portionGrams: number | null;
    nutritionalTotals: MacroTotals;
    ingredientProductIds: string[];
    ingredients: IngredientSelectOptionDto[];
    dietaryTags: string[];
    allergenFlags: string[];
    priceCoverage: { complete: boolean; missingIngredientCount: number };
  };
};

export type MealDishDetailDto = MealDishCardDto & {
  ingredients: IngredientDetailDto[];
  steps: RecipeStepDto[];
  equipment: string[];
  dayTargets: MacroTotals;
  daySharePercent: MacroTotals;
  validationStatus: 'ok' | 'warning';
  validationMessage: string | null;
};

export type MealPlanDayDetailDto = {
  mealPlanId: string;
  mealPlanVersion: number;
  dayId: string;
  dayIndex: number;
  target: MacroTotals;
  planned: MacroTotals;
  mealCount: number;
  calorieMismatch: boolean;
  mismatchMessage: string | null;
  items: MealDishCardDto[];
};
