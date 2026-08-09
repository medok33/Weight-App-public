import { aggregateCatalogIngredients } from '../../shopping-list/domain/shopping-list.policy';

export type SharedDishInput = {
  familyId: string; recipeId?: string; name: string; baseServings: number; tags?: string[];
  ingredients: Array<{ productKey: string; name: string; category?: string; quantity: number; unit: string; packageSize?: number; fallbackUnitPrice?: number }>;
  nutrition: { calories: number; proteinG: number; fatG: number; carbsG: number };
  memberPlans: Array<{ userId: string; excludedTags?: string[]; allergens?: string[]; portionFactor?: number; targetKcalShare?: number }>;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const withinPortionTolerance = (actual: number, expected: number) => Math.abs(actual - expected) <= 0.02;

export function allocateIndividualPortions(dish: SharedDishInput, members = dish.memberPlans) {
  if (dish.baseServings <= 0 || !members.length) throw new Error('FAMILY_SHARED_DISH_INVALID');
  const tags = new Set((dish.tags ?? []).map((tag) => tag.toLowerCase()));
  const portions = members.map((member) => {
    const factor = member.portionFactor ?? member.targetKcalShare ?? 1;
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('FAMILY_SHARED_DISH_INVALID');
    const conflicts = [...new Set([...(member.allergens ?? []), ...(member.excludedTags ?? [])].map((v) => v.toLowerCase()))]
      .filter((value) => tags.has(value));
    if (conflicts.length) {
      return {
        userId: member.userId,
        compatible: false as const,
        suggestion: 'separate_portion' as const,
        explanation: 'This dish needs a separate compatible portion.',
      };
    }
    return {
      userId: member.userId,
      compatible: true as const,
      servings: round2(factor),
      portionGrams: round2(factor * 100),
      calories: round2(dish.nutrition.calories * factor),
      proteinG: round2(dish.nutrition.proteinG * factor),
      fatG: round2(dish.nutrition.fatG * factor),
      carbsG: round2(dish.nutrition.carbsG * factor),
    };
  });
  const totalFactor = portions
    .filter((portion): portion is Extract<(typeof portion), { compatible: true }> => portion.compatible)
    .reduce((sum, portion) => sum + portion.servings, 0);
  const scaledIngredients = dish.ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: round2(ingredient.quantity * totalFactor),
  }));
  const expectedSum = round2(dish.ingredients.reduce((sum, ingredient) => sum + ingredient.quantity, 0) * totalFactor);
  const actualSum = round2(scaledIngredients.reduce((sum, ingredient) => sum + ingredient.quantity, 0));
  return {
    portions,
    scaledIngredients,
    expectedIngredients: expectedSum,
    ingredientQuantityMatches: withinPortionTolerance(actualSum, expectedSum),
  };
}

export function buildFamilyShoppingList(
  meals: Array<{ dishName: string; servings: number; ingredients: SharedDishInput['ingredients'] }>,
  pantry: Array<{ productKey?: string; name: string; unit: string; quantity: number; expiresOn?: string | Date | null }>,
) {
  const today = new Date().toISOString().slice(0, 10);
  const expanded = meals.flatMap((meal) => meal.ingredients.map((ingredient) => ({
    ...ingredient, category: ingredient.category ?? 'other', packageSize: ingredient.packageSize ?? 1,
    fallbackUnitPrice: ingredient.fallbackUnitPrice ?? 0, quantity: ingredient.quantity * meal.servings,
  })));
  const pantryByKey = new Map(pantry.filter((item) => !item.expiresOn || String(item.expiresOn).slice(0, 10) >= today)
    .map((item) => [`${item.productKey ?? item.name.trim().toLowerCase()}:${item.unit}`, item.quantity]));
  return aggregateCatalogIngredients(expanded).map((item) => ({
    ...item, quantity: Math.max(0, item.quantity - (pantryByKey.get(`${item.productKey}:${item.unit}`) ?? pantryByKey.get(`${item.name.trim().toLowerCase()}:${item.unit}`) ?? 0)),
    forDishes: [...new Set(meals.filter((meal) => meal.ingredients.some((ingredient) => ingredient.productKey === item.productKey && ingredient.unit === item.unit)).map((meal) => meal.dishName))],
  })).filter((item) => item.quantity > 0);
}
