export type MealPlanDaySummary = {
  dayIndex: number;
  dayId?: string;
  mealId?: string;
  mealName: string;
  calories: number;
  proteinG: number;
  mealCount?: number;
  completed: boolean;
};

export type MealPlanSummary = {
  userId: string;
  version: number;
  planId?: string;
  personalized: boolean;
  targetKcal?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  tdeeKcal?: number;
  days: MealPlanDaySummary[];
};

export type MealTrackingToday = {
  completedMealIds: string[];
  consumedKcal?: number;
  plannedKcal?: number;
  remainingKcal?: number;
  proteinConsumed?: number;
  proteinTarget?: number;
};

export type DishCostSummary = {
  consumedCostRub: number | null;
  packageCostRub: number | null;
  consumedCost?: number | null;
  packageCost?: number | null;
  pricedIngredientCount: number;
  missingIngredientCount: number;
  missingPriceCount?: number;
  complete: boolean;
  status: 'confirmed' | 'estimated' | 'partial' | 'missing';
  priceStatus?: 'confirmed' | 'estimated' | 'partial' | 'missing';
  priceSource?: string | null;
  priceSourceLabel?: string | null;
  retailer?: string | null;
  observedAt?: string | null;
  stale?: boolean;
  asOf?: string;
  sourceName?: string;
};

export type MealDishCard = {
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
  portionGrams: number | null;
  portionLabel: string;
  nutritionBasis?: 'PER_BASE_SERVING' | 'PER_RECIPE_SERVINGS' | 'CUSTOMIZATION';
  baseServingGrams?: number | null;
  servingMultiplier?: number;
  displayedPortionGrams?: number | null;
  displayedNutrition?: {
    calories: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  };
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  difficulty: string | null;
  dietaryTags: string[];
  allergens: string[];
  allergenDetails?: Array<{ code: string; label: string; presence: string }>;
  dietaryTagDetails?: Array<{ code: string; label: string }>;
  cost: DishCostSummary;
  substitutionReady?: {
    mealPlanId: string;
    mealPlanVersion: number;
    dayId: string;
    dayIndex: number;
    mealItemId: string;
    dishId: string;
    recipeId: string;
    recipeVersionId?: string | null;
    portionGrams: number | null;
    nutritionalTotals?: {
      calories: number;
      proteinG: number;
      fatG: number;
      carbsG: number;
    };
    ingredientProductIds: string[];
    ingredients?: Array<{
      productId: string;
      displayName: string;
      amount: number;
      unit: string;
      label: string;
    }>;
    dietaryTags: string[];
    allergenFlags: string[];
    priceCoverage: { complete: boolean; missingIngredientCount: number };
  };
};

export type MealPlanDayDetail = {
  mealPlanId: string;
  mealPlanVersion: number;
  dayId: string;
  dayIndex: number;
  target: { calories: number; proteinG: number; fatG: number; carbsG: number };
  planned: { calories: number; proteinG: number; fatG: number; carbsG: number };
  mealCount: number;
  calorieMismatch: boolean;
  mismatchMessage: string | null;
  items: MealDishCard[];
};

export type MealDishDetail = MealDishCard & {
  ingredients: Array<{
    productId: string;
    displayName: string;
    amount: number;
    unit: string;
    calories: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    consumedCostRub: number | null;
    packageCostRub: number | null;
    priceStatus: string;
    priceSource?: string | null;
    priceSourceLabel?: string | null;
    retailer?: string | null;
    observedAt?: string | null;
    stale?: boolean;
    packageWeight?: number | null;
    packageUnit?: string | null;
  }>;
  steps: Array<{
    stepIndex: number;
    instruction: string;
    durationMinutes: number | null;
    temperatureC: number | null;
    equipment: string | null;
  }>;
  equipment: string[];
  dayTargets: { calories: number; proteinG: number; fatG: number; carbsG: number };
  daySharePercent: { calories: number; proteinG: number; fatG: number; carbsG: number };
  validationStatus: 'ok' | 'warning';
  validationMessage: string | null;
};
