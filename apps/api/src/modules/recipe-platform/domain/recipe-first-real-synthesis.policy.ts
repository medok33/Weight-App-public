import { calculateRecipeNutrition, evaluateCulinarySafety, evaluateSimilarity, validateIngredientSteps, validateNutritionConsistency, type AuthoringIngredient, type AuthoringStep, type NutritionProduct } from './recipe-authoring.policy';
import type { MethodSkeletonStep } from './recipe-contract.v1';

export const FIRST_REAL_SYNTHESIS_CLUSTER_ID = 'dcluster_8c521f996b1e8844f530ff12';
export const FIRST_REAL_SYNTHESIS_RECIPE_KEY = 'weight-app:classic-julienne-core:v1';
export const FIRST_REAL_SYNTHESIS_SERVINGS = 4;
export const FIRST_REAL_SYNTHESIS_PRODUCTS = ['chicken_breast_raw', 'mushroom_champignon_raw', 'sour_cream_15pct', 'hard_cheese_45pct', 'olive_oil'] as const;
export const OLIVE_OIL_GRAMS = 27.3;
export const OLIVE_OIL_DENSITY_G_PER_ML = 0.91;
export const OLIVE_OIL_DENSITY_AUTHORITY = 'recipe-first-real-synthesis/v1 deterministic liquid-density policy';
export const OLIVE_OIL_CONVERSION_PROVENANCE = '2 tbsp × 15 ml/tbsp × 0.91 g/ml = 27.3 g';

export function firstRealSynthesisIngredients(): AuthoringIngredient[] {
  return [
    { id: 'chicken', productId: 'chicken_breast_raw', amount: 600, unit: 'g', displayName: 'Куриное филе' },
    { id: 'mushrooms', productId: 'mushroom_champignon_raw', amount: 300, unit: 'g', displayName: 'Шампиньоны' },
    { id: 'sour-cream', productId: 'sour_cream_15pct', amount: 400, unit: 'g', displayName: 'Сметана 15%' },
    { id: 'cheese', productId: 'hard_cheese_45pct', amount: 100, unit: 'g', displayName: 'Твёрдый сыр 45%' },
    { id: 'olive-oil', productId: 'olive_oil', amount: OLIVE_OIL_GRAMS, unit: 'g', displayName: 'Оливковое масло' },
  ];
}

export function firstRealSynthesisSkeleton(): MethodSkeletonStep[] {
  return [
    { stepId: 'prepare', order: 1, ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese', 'olive-oil'], technique: 'prepare', equipment: ['PAN', 'OVEN', 'BAKING_DISH', 'GRATER'] },
    { stepId: 'sear-chicken', order: 2, ingredientIds: ['olive-oil', 'chicken'], technique: 'fry', durationMinutes: 4, equipment: ['PAN'] },
    { stepId: 'fry-mushrooms', order: 3, ingredientIds: ['chicken', 'mushrooms'], technique: 'fry', durationMinutes: 10, equipment: ['PAN'], endCondition: 'до готовности курицы' },
    { stepId: 'assemble', order: 4, ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese'], technique: 'combine', equipment: ['BAKING_DISH', 'GRATER'] },
    { stepId: 'bake', order: 5, ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese'], technique: 'bake', durationMinutes: 5, temperatureC: 180, equipment: ['OVEN', 'BAKING_DISH'] },
    { stepId: 'serve', order: 6, ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese'], technique: 'serve' },
  ];
}

export function firstRealSynthesisAuthoringSteps(): AuthoringStep[] {
  return [
    { index: 1, text: 'Подготовьте куриное филе и шампиньоны; натрите твёрдый сыр.', ingredientIds: ['chicken', 'mushrooms', 'cheese'] },
    { index: 2, text: 'Разогрейте оливковое масло и обжаривайте куриное филе 4 минуты.', ingredientIds: ['olive-oil', 'chicken'], durationMinutes: 4 },
    { index: 3, text: 'Добавьте шампиньоны и обжаривайте с курицей 10 минут до готовности курицы.', ingredientIds: ['chicken', 'mushrooms'], durationMinutes: 10 },
    { index: 4, text: 'Переложите курицу с шампиньонами в форму, добавьте сметану и посыпьте тёртым сыром.', ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese'] },
    { index: 5, text: 'Запекайте при 180 C 5 минут.', ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese'], durationMinutes: 5, temperatureC: 180 },
    { index: 6, text: 'Подайте блюдо.', ingredientIds: ['chicken', 'mushrooms', 'sour-cream', 'cheese'] },
  ];
}

export function firstRealSynthesisNutrition(products: NutritionProduct[]) {
  const ingredients = firstRealSynthesisIngredients();
  const nutrition = calculateRecipeNutrition(ingredients.map((item) => ({ productId: item.productId, amountGrams: item.amount })), products, FIRST_REAL_SYNTHESIS_SERVINGS, ingredients.reduce((sum, item) => sum + item.amount, 0));
  return { nutrition, gate: validateNutritionConsistency(nutrition, ingredients.reduce((sum, item) => sum + item.amount, 0)) };
}

export function validateFirstRealSynthesisScope(input: { ingredients: AuthoringIngredient[]; steps: AuthoringStep[] }) {
  const allowed = new Set(FIRST_REAL_SYNTHESIS_PRODUCTS);
  const productGate = input.ingredients.every((item) => allowed.has(item.productId as typeof FIRST_REAL_SYNTHESIS_PRODUCTS[number]));
  const noContamination = !input.ingredients.some((item) => item.productId === 'step092_rice' || item.productId === 'mayonnaise');
  const links = validateIngredientSteps(input);
  const safety = evaluateCulinarySafety({ category: 'poultry', steps: input.steps });
  const similarity = evaluateSimilarity({ ingredientOverlap: 0.45, quantitySimilarity: 0.45, techniqueSimilarity: 0.55, conceptSimilarity: 0.4, titleSimilarity: 0.3, sourceCloneSimilarity: 0.35 });
  return { productGate, noContamination, ingredientStepGate: links, safety, similarity, ok: productGate && noContamination && links.ok && safety.status === 'PASS' && similarity.decision === 'CREATE' };
}
