import { describe, expect, it } from 'vitest';
import { normalizeUnit } from '../domain/recipe-research.policy';
import { FIRST_REAL_SYNTHESIS_PRODUCTS, FIRST_REAL_SYNTHESIS_SERVINGS, OLIVE_OIL_CONVERSION_PROVENANCE, OLIVE_OIL_DENSITY_AUTHORITY, OLIVE_OIL_DENSITY_G_PER_ML, OLIVE_OIL_GRAMS, firstRealSynthesisAuthoringSteps, firstRealSynthesisIngredients, firstRealSynthesisNutrition, firstRealSynthesisSkeleton, validateFirstRealSynthesisScope } from '../domain/recipe-first-real-synthesis.policy';
import { evaluateCulinarySafety } from '../domain/recipe-authoring.policy';
import { aggregateResearchFacts, buildDishConceptCluster } from '../domain/recipe-knowledge-synthesis.policy';
import { toCandidate } from '../../../../scripts/recipe-corpus-synthesis-readiness-01';

const nutrition = [
  { productId: 'chicken_breast_raw', state: 'raw' as const, caloriesPer100g: 120, proteinPer100g: 22.5, fatPer100g: 2.6, carbsPer100g: 0 },
  { productId: 'mushroom_champignon_raw', state: 'raw' as const, caloriesPer100g: 22, proteinPer100g: 3.1, fatPer100g: 0.3, carbsPer100g: 3.3 },
  { productId: 'sour_cream_15pct', state: 'raw' as const, caloriesPer100g: 162, proteinPer100g: 2.6, fatPer100g: 15, carbsPer100g: 3 },
  { productId: 'hard_cheese_45pct', state: 'raw' as const, caloriesPer100g: 363, proteinPer100g: 23, fatPer100g: 30, carbsPer100g: 0.5 },
  { productId: 'olive_oil', state: 'raw' as const, caloriesPer100g: 884, proteinPer100g: 0, fatPer100g: 100, carbsPer100g: 0 },
];

describe('RECIPE-FIRST-REAL-SYNTHESIS-01 deterministic core', () => {
  it('freezes the classic Julienne core without rice or mayonnaise', () => {
    const ingredients = firstRealSynthesisIngredients();
    expect(ingredients.map((item) => item.productId)).toEqual(FIRST_REAL_SYNTHESIS_PRODUCTS);
    expect(ingredients).toContainEqual(expect.objectContaining({ productId: 'olive_oil', amount: OLIVE_OIL_GRAMS }));
    expect(ingredients.some((item) => /rice|mayonnaise/.test(item.productId))).toBe(false);
    expect(ingredients.map((item) => item.amount)).toEqual([600, 300, 400, 100, 27.3]);
  });
  it('normalizes tablespoon spellings and retains an explicit oil conversion policy', () => {
    expect(normalizeUnit('стол.л.')).toEqual({ unit: 'tbsp', status: 'KNOWN' });
    expect(normalizeUnit('ст.л.')).toEqual({ unit: 'tbsp', status: 'KNOWN' });
    expect(normalizeUnit('стол.л')).toEqual({ unit: 'tbsp', status: 'KNOWN' });
    expect(OLIVE_OIL_DENSITY_G_PER_ML).toBe(0.91);
    expect(OLIVE_OIL_DENSITY_AUTHORITY).toContain('deterministic liquid-density policy');
    expect(OLIVE_OIL_CONVERSION_PROVENANCE).toBe('2 tbsp × 15 ml/tbsp × 0.91 g/ml = 27.3 g');
  });
  it('propagates 180C and tbsp facts from the accepted Julienne candidate', () => {
    const candidate = toCandidate({ sourceId: 'accepted-test', sourceRecipeId: 'classic-julienne', title: 'Жульен с курицей и грибами в духовке', ingredients: [{ rawName: 'Оливковое масло', rawUnit: 'стол.л', normalizedQuantity: { min: 2 } }], steps: [{ sourceOrder: 1, techniqueFacts: ['bake'], temperatureFacts: [{ c: 180 }] }] }, [{ productId: 'olive_oil', canonicalName: 'Оливковое масло', aliases: [] }]);
    const cluster = buildDishConceptCluster([candidate], '2026-08-20T00:00:00.000Z');
    const facts = aggregateResearchFacts(cluster, [candidate], '2026-08-20T00:00:00.000Z');
    expect(candidate.ingredients.find((item) => item.productId === 'olive_oil')).toMatchObject({ quantity: 2, unit: 'tbsp' });
    expect(facts).toContainEqual(expect.objectContaining({ factType: 'TEMPERATURE', normalizedValue: '180', unit: 'C' }));
  });
  it('keeps grams, nutrition, scope and poultry safety deterministic', () => {
    const ingredients = firstRealSynthesisIngredients(); const skeleton = firstRealSynthesisSkeleton(); const steps = firstRealSynthesisAuthoringSteps();
    const a = firstRealSynthesisNutrition(nutrition); const b = firstRealSynthesisNutrition(nutrition);
    expect(a).toEqual(b); expect(a.gate.ok).toBe(true); expect(a.nutrition.servings).toBe(FIRST_REAL_SYNTHESIS_SERVINGS);
    const scope = validateFirstRealSynthesisScope({ ingredients, steps });
    expect(scope.ok).toBe(true); expect(scope.safety.status).toBe('PASS'); expect(scope.similarity.decision).toBe('CREATE');
    const bake = skeleton.find((step) => step.stepId === 'bake');
    expect(bake).toMatchObject({ temperatureC: 180, durationMinutes: 5 });
    expect(skeleton.some((step) => step.durationMinutes === 30)).toBe(false);
  });
  it('fails closed when a rice or mayonnaise union branch is injected', () => {
    const ingredients = [...firstRealSynthesisIngredients(), { id: 'rice', productId: 'step092_rice', amount: 100, unit: 'g', displayName: 'Рис' }];
    const steps = firstRealSynthesisAuthoringSteps();
    expect(validateFirstRealSynthesisScope({ ingredients, steps }).ok).toBe(false);
  });
  it('never treats an oven setting alone as poultry doneness evidence', () => {
    expect(evaluateCulinarySafety({ category: 'poultry', steps: [{ index: 1, text: 'Запекайте при 180 C 5 минут.', ingredientIds: ['chicken'], temperatureC: 180, durationMinutes: 5 }] }).status).toBe('FAIL');
    expect(evaluateCulinarySafety({ category: 'poultry', steps: firstRealSynthesisAuthoringSteps() }).status).toBe('PASS');
  });
});
