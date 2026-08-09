import type { MacroTotals } from './meal-dish.nutrition';

export type SubstitutionKind = 'REPLACE_DISH' | 'REPLACE_INGREDIENT';

export type SubstitutionClassification = 'EQUIVALENT' | 'ADJUSTABLE' | 'CONFLICTING' | 'BLOCKED';

export type CompensationOption =
  | 'REDUCE_PORTION'
  | 'ADJUST_NEXT_MEAL'
  | 'REPLACE_SNACK'
  | 'ACCEPT_FORECAST_SHIFT'
  | 'OPTIONAL_WALK';

export type MacroDelta = MacroTotals & {
  caloriesPct: number;
  proteinPct: number;
  fatPct: number;
  carbsPct: number;
};

export type CatalogProductRef = {
  productId: string;
  productKey: string;
  displayName: string;
  unit: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  packageSize: number;
  packageUnit: string;
  unitPriceRub: number | null;
  allergens: string[];
  dietaryTags: string[];
  enabled: boolean;
};

export type CatalogRecipeRef = {
  recipeId: string;
  recipeKey: string;
  name: string;
  description: string;
  mealTypes: string[];
  portionGrams: number;
  prepMinutes: number;
  cookMinutes: number;
  allergens: string[];
  dietaryTags: string[];
  enabled: boolean;
  ingredients: Array<{
    productId: string;
    amount: number;
    unit: string;
  }>;
};

export type UserDietConstraints = {
  allergens: string[];
  foodRestrictions: string[];
  dietaryPreferences: string[];
  excludedProductIds: string[];
  rejectedProductIds: string[];
};

export type SubstitutionCandidate = {
  candidateId: string;
  candidateType: SubstitutionKind;
  recipeId: string | null;
  productId: string | null;
  name: string;
  suggestedPortionGrams: number;
  originalPortionGrams: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  nutrientDelta: MacroDelta;
  costDeltaRub: number | null;
  consumedCostRub: number | null;
  packageCostRub: number | null;
  preparationMinutes: number;
  dietaryTags: string[];
  classification: SubstitutionClassification;
  reasons: string[];
  warnings: string[];
  compensationOptions: CompensationOption[];
  /** RP2-01B STEP_198 provenance */
  provenance?: 'CURATED_PRODUCT_SUBSTITUTION' | 'HEURISTIC_CATALOG_MATCH';
  culinaryRoleCode?: string | null;
  nutritionImpact?: string | null;
  textureImpact?: string | null;
  supportedMethods?: string[];
  baseRatio?: number | null;
  adjustedRatio?: number | null;
  ratioReason?: string | null;
  suggestedAmountGrams?: number | null;
};

export type GoalImpactDto = {
  status: 'ON_TRACK' | 'AGGRESSIVE' | 'CONFLICTING' | 'INSUFFICIENT_DATA' | 'SHIFTED';
  dayCalorieDelta: number;
  weekCalorieDelta: number;
  projectedPaceKgPerWeek: number | null;
  etaWeeksBefore: number | null;
  etaWeeksAfter: number | null;
  etaChanged: boolean;
  message: string;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
};

export type ShoppingListDeltaDto = {
  removed: Array<{ productId: string; displayName: string; amount: number; unit: string }>;
  added: Array<{ productId: string; displayName: string; amount: number; unit: string }>;
  mergedNotes: string[];
};

export type SubstitutionPreviewDto = {
  mealPlanId: string;
  mealPlanVersion: number;
  mealItemId: string;
  operation: SubstitutionKind;
  candidateId: string;
  classification: SubstitutionClassification;
  before: {
    dishName: string;
    recipeId: string;
    portionGrams: number;
    macros: MacroTotals;
    consumedCostRub: number | null;
    packageCostRub: number | null;
  };
  after: {
    dishName: string;
    recipeId: string | null;
    productId: string | null;
    portionGrams: number;
    macros: MacroTotals;
    consumedCostRub: number | null;
    packageCostRub: number | null;
  };
  dayBalance: { before: MacroTotals; after: MacroTotals; target: MacroTotals };
  weekBalance: { before: MacroTotals; after: MacroTotals; avgDailyCalories: { before: number; after: number } };
  cost: {
    dishConsumedDeltaRub: number | null;
    dayConsumedDeltaRub: number | null;
    weekConsumedDeltaRub: number | null;
    dishPackageDeltaRub: number | null;
    incomplete: boolean;
  };
  shoppingListDelta: ShoppingListDeltaDto;
  goalImpact: GoalImpactDto;
  warnings: string[];
  compensationOptions: CompensationOption[];
  keepPlanHints: string[];
  confirmationToken: string;
  proposedVersion: number;
  revisionPlanId: string;
};

export type StructuredSubstitutionOperation = {
  version: 1;
  kind: SubstitutionKind;
  mealItemId: string;
  sourceRecipeId: string;
  sourcePortionGrams: number;
  candidateId: string;
  targetRecipeId: string | null;
  targetRecipeVersionId?: string | null;
  targetProductId: string | null;
  replaceProductId: string | null;
  suggestedPortionGrams: number;
  ingredientScale: number;
  classification: SubstitutionClassification;
  compensation: CompensationOption | null;
  customizationSnapshotJson?: unknown;
};

export type MealSnapshotMeal = {
  name: string;
  recipeId?: string;
  recipeVersionId?: string;
  mealType?: string;
  plannedTime?: string;
  portionGrams?: number;
  mealItemId?: string;
  customizationSnapshotJson?: unknown;
  contentProvenance?: string;
};

export type MealSnapshotDay = {
  dayIndex: number;
  meals: MealSnapshotMeal[];
};
