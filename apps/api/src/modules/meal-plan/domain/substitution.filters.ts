import type { CatalogRecipeRef, CatalogProductRef, UserDietConstraints } from './substitution.types';
import { macrosFromIngredient, sumMacros, type MacroTotals } from './meal-dish.nutrition';

function normalize(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

export function recipeMacros(
  recipe: CatalogRecipeRef,
  products: Map<string, CatalogProductRef>,
  scale = 1,
): MacroTotals | null {
  try {
    const parts = recipe.ingredients.map((ing) => {
      const product = products.get(ing.productId);
      if (!product) throw new Error('PRODUCT_MISSING');
      if (!(product.caloriesPer100g >= 0) || !(product.proteinPer100g >= 0)) throw new Error('NUTRITION_INVALID');
      return macrosFromIngredient({
        amount: ing.amount * scale,
        unit: ing.unit,
        caloriesPer100g: product.caloriesPer100g,
        proteinPer100g: product.proteinPer100g,
        fatPer100g: product.fatPer100g,
        carbsPer100g: product.carbsPer100g,
      });
    });
    return sumMacros(parts);
  } catch {
    return null;
  }
}

export type HardFilterReason =
  | 'DISABLED'
  | 'ALLERGEN'
  | 'FOOD_RESTRICTION'
  | 'DIETARY_PREFERENCE'
  | 'EXCLUDED_PRODUCT'
  | 'MEAL_TYPE'
  | 'NUTRITION_INVALID'
  | 'PORTION_UNSCALABLE'
  | 'SAME_AS_SOURCE';

export function hardFilterRecipe(input: {
  recipe: CatalogRecipeRef;
  products: Map<string, CatalogProductRef>;
  constraints: UserDietConstraints;
  mealType: string;
  sourceRecipeId: string;
  canScale: boolean;
}): { allowed: false; reason: HardFilterReason } | { allowed: true } {
  const { recipe, products, constraints, mealType, sourceRecipeId, canScale } = input;
  if (!recipe.enabled) return { allowed: false, reason: 'DISABLED' };
  if (recipe.recipeId === sourceRecipeId) return { allowed: false, reason: 'SAME_AS_SOURCE' };
  if (recipe.mealTypes.length && !recipe.mealTypes.includes(mealType) && mealType !== 'extra') {
    return { allowed: false, reason: 'MEAL_TYPE' };
  }

  const allergens = normalize([...recipe.allergens, ...recipe.ingredients.flatMap((ing) => products.get(ing.productId)?.allergens ?? [])]);
  const userAllergens = normalize(constraints.allergens);
  if (allergens.some((a) => userAllergens.includes(a))) return { allowed: false, reason: 'ALLERGEN' };

  // Legacy foodRestrictions free-text is optional notes only — not STEP_211 / meal hard eligibility.

  for (const ing of recipe.ingredients) {
    const product = products.get(ing.productId);
    if (!product || !product.enabled) return { allowed: false, reason: 'DISABLED' };
    if (constraints.excludedProductIds.includes(ing.productId)) return { allowed: false, reason: 'EXCLUDED_PRODUCT' };
  }

  const prefs = normalize(constraints.dietaryPreferences);
  if (prefs.includes('vegan') && !normalize(recipe.dietaryTags).includes('vegan')) {
    return { allowed: false, reason: 'DIETARY_PREFERENCE' };
  }
  if (prefs.includes('vegetarian') && !normalize(recipe.dietaryTags).some((t) => t === 'vegetarian' || t === 'vegan')) {
    return { allowed: false, reason: 'DIETARY_PREFERENCE' };
  }

  const macros = recipeMacros(recipe, products, 1);
  if (!macros || macros.calories <= 0) return { allowed: false, reason: 'NUTRITION_INVALID' };
  if (!canScale) return { allowed: false, reason: 'PORTION_UNSCALABLE' };

  return { allowed: true };
}

export function hardFilterIngredientProduct(input: {
  product: CatalogProductRef;
  constraints: UserDietConstraints;
  sourceProductId: string;
}): { allowed: false; reason: HardFilterReason } | { allowed: true } {
  const { product, constraints, sourceProductId } = input;
  if (!product.enabled) return { allowed: false, reason: 'DISABLED' };
  if (product.productId === sourceProductId) return { allowed: false, reason: 'SAME_AS_SOURCE' };
  if (constraints.excludedProductIds.includes(product.productId)) return { allowed: false, reason: 'EXCLUDED_PRODUCT' };

  const allergens = normalize(product.allergens);
  if (allergens.some((a) => normalize(constraints.allergens).includes(a))) return { allowed: false, reason: 'ALLERGEN' };

  // Legacy foodRestrictions free-text is not a hard restriction.

  if (!(product.caloriesPer100g >= 0) || !(product.proteinPer100g >= 0)) {
    return { allowed: false, reason: 'NUTRITION_INVALID' };
  }

  const prefs = normalize(constraints.dietaryPreferences);
  if (prefs.includes('vegan') && !normalize(product.dietaryTags).includes('vegan')) {
    return { allowed: false, reason: 'DIETARY_PREFERENCE' };
  }
  if (prefs.includes('vegetarian') && !normalize(product.dietaryTags).some((t) => t === 'vegetarian' || t === 'vegan')) {
    // animal proteins blocked for vegetarian
    if (normalize(product.allergens).includes('fish') || /chicken|turkey|beef|fish|meat/i.test(product.productKey)) {
      return { allowed: false, reason: 'DIETARY_PREFERENCE' };
    }
  }

  return { allowed: true };
}
