import { createHash } from 'node:crypto';

export type RecipeVersionStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'LEGACY_BACKFILL';
export type RecipeVersionChangeType =
  | 'LEGACY_BACKFILL'
  | 'MANUAL_PUBLISH'
  | 'CONTENT_UPDATE'
  | 'SYSTEM'
  | 'FIXTURE';
export type RecipeContentProvenance =
  | 'RECIPE_VERSION'
  | 'LEGACY_RECIPE_CURRENT'
  | 'LEGACY_BACKFILL'
  | 'MEAL_ITEM_CUSTOMIZATION';

export type RecipeContentSnapshot = {
  title: string;
  description: string | null;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: string | null;
  portionGrams: number | null;
  equipment: string[];
  recipeKey: string | null;
  allergens: string[];
  dietaryTags: string[];
};

export type RecipeIngredientSnapshot = {
  productId: string;
  canonicalProductId: string;
  displayName: string;
  amount: number;
  unit: string;
  ordering: number;
  preparationNote?: string | null;
};

export type RecipeStepSnapshot = {
  stepIndex: number;
  instruction: string;
  durationMinutes: number | null;
  temperatureC: number | null;
  equipment: string | null;
};

export type RecipeNutritionSnapshot = {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  basis: string;
  source: string;
};

export type RecipeRestrictionSnapshot = {
  allergens: string[];
  dietaryTags: string[];
};

export type MealItemCustomizationSnapshot = {
  version: 1;
  kind: 'REPLACE_INGREDIENT';
  baseRecipeVersionId: string;
  ingredients: RecipeIngredientSnapshot[];
  nutrition?: RecipeNutritionSnapshot;
  replaceProductId?: string | null;
  targetProductId?: string | null;
};

/** Model B: currentVersionId points at the published/usable version. */
export const RECIPE_CURRENT_VERSION_SEMANTICS = 'B_CURRENT_IS_PUBLISHED' as const;

export const DETERMINISTIC_RECIPE_FAMILIES = [
  {
    slug: 'chicken-with-side',
    canonicalName: 'Курица с гарниром',
    dishType: 'MAIN',
    recipeKeys: ['buckwheat_chicken', 'potato_chicken'] as const,
    primaryProductKey: 'chicken_breast',
  },
] as const;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

export function computeRecipeVersionChecksum(input: {
  content: RecipeContentSnapshot;
  ingredients: RecipeIngredientSnapshot[];
  steps: RecipeStepSnapshot[];
  nutrition: RecipeNutritionSnapshot;
  restrictions: RecipeRestrictionSnapshot;
  servings: number;
  servingWeightGrams: number | null;
}): string {
  const payload = {
    content: input.content,
    ingredients: [...input.ingredients].sort((a, b) => a.ordering - b.ordering),
    steps: [...input.steps].sort((a, b) => a.stepIndex - b.stepIndex),
    nutrition: input.nutrition,
    restrictions: input.restrictions,
    servings: input.servings,
    servingWeightGrams: input.servingWeightGrams,
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function isUsableRecipeVersionStatus(status: string, publishedAt: Date | string | null): boolean {
  if (publishedAt == null) return false;
  return status === 'PUBLISHED' || status === 'LEGACY_BACKFILL';
}

export function macrosFromIngredientAmount(input: {
  caloriesPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  amount: number;
  unit: string;
}): RecipeNutritionSnapshot {
  const factor = input.unit === 'g' || input.unit === 'ml' ? Number(input.amount) / 100 : 0;
  return {
    calories: round2(input.caloriesPer100g * factor),
    proteinG: round2(input.proteinPer100g * factor),
    fatG: round2(input.fatPer100g * factor),
    carbsG: round2(input.carbsPer100g * factor),
    basis: 'per_recipe_servings',
    source: 'PRODUCT_NUTRITION_RESOLVER',
  };
}

export function sumNutrition(parts: RecipeNutritionSnapshot[]): RecipeNutritionSnapshot {
  return {
    calories: round2(parts.reduce((sum, part) => sum + part.calories, 0)),
    proteinG: round2(parts.reduce((sum, part) => sum + part.proteinG, 0)),
    fatG: round2(parts.reduce((sum, part) => sum + part.fatG, 0)),
    carbsG: round2(parts.reduce((sum, part) => sum + part.carbsG, 0)),
    basis: 'per_recipe_servings',
    source: 'PRODUCT_NUTRITION_RESOLVER',
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
