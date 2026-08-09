import { describe, expect, it } from 'vitest';
import { classifySubstitution } from '../domain/substitution.classify';
import { hardFilterRecipe, hardFilterIngredientProduct, recipeMacros } from '../domain/substitution.filters';
import { suggestPortion, suggestIngredientAmountWithMacros } from '../domain/substitution.portion';
import { sortCandidatesStable, rankScore } from '../domain/substitution.ranking';
import { buildDishCandidates, buildIngredientCandidates } from '../domain/substitution.engine';
import { shoppingDelta, replaceMealMacrosInDay, weekTotals } from '../domain/substitution.recalc';
import { assessSubstitutionGoalImpact } from '../domain/substitution.goal-impact';
import { STEP093_PRODUCTS, STEP093_RECIPES } from '../domain/substitution.fixture';
import { STEP092_PRODUCTS } from '../domain/meal-dish.fixture';
import type { CatalogProductRef, CatalogRecipeRef, UserDietConstraints } from '../domain/substitution.types';

function productsMap(): Map<string, CatalogProductRef> {
  const map = new Map<string, CatalogProductRef>();
  for (const p of [...STEP092_PRODUCTS, ...STEP093_PRODUCTS]) {
    const allergens = 'allergens' in p ? [...(p as { allergens: string[] }).allergens] : [];
    const dietaryTags = 'dietaryTags' in p ? [...(p as { dietaryTags: string[] }).dietaryTags] : [];
    map.set(p.id, {
      productId: p.id,
      productKey: p.productKey,
      displayName: p.canonicalName,
      unit: p.unit,
      caloriesPer100g: p.caloriesPer100g,
      proteinPer100g: p.proteinPer100g,
      fatPer100g: p.fatPer100g,
      carbsPer100g: p.carbsPer100g,
      packageSize: p.packageSize,
      packageUnit: p.packageUnit,
      unitPriceRub: p.unitPriceRub,
      allergens,
      dietaryTags,
      enabled: true,
    });
  }
  return map;
}

function recipes(): CatalogRecipeRef[] {
  const products = productsMap();
  return STEP093_RECIPES.map((r) => ({
    recipeId: r.id,
    recipeKey: r.recipeKey,
    name: r.name,
    description: r.description,
    mealTypes: [...r.mealTypes],
    portionGrams: r.portionGrams,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    allergens: [...r.allergens],
    dietaryTags: [...r.dietaryTags],
    enabled: true,
    ingredients: r.ingredients.map((i) => ({
      productId: products.get(i.productId)?.productId ?? i.productId,
      amount: i.amount,
      unit: i.unit,
    })),
  }));
}

const emptyConstraints: UserDietConstraints = {
  allergens: [],
  foodRestrictions: [],
  dietaryPreferences: [],
  excludedProductIds: [],
  rejectedProductIds: [],
};

describe('STEP_093 substitution domain', () => {
  it('blocks allergen candidates via hard filter', () => {
    const products = productsMap();
    const peanut = recipes().find((r) => r.recipeKey === 'peanut_chicken')!;
    const blocked = hardFilterRecipe({
      recipe: peanut,
      products,
      constraints: { ...emptyConstraints, allergens: ['peanut'] },
      mealType: 'lunch',
      sourceRecipeId: 'other',
      canScale: true,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toBe('ALLERGEN');
  });

  it('blocks dietary preference mismatches', () => {
    const products = productsMap();
    const chicken = recipes().find((r) => r.recipeKey === 'buckwheat_chicken')!;
    const blocked = hardFilterRecipe({
      recipe: chicken,
      products,
      constraints: { ...emptyConstraints, dietaryPreferences: ['vegan'] },
      mealType: 'lunch',
      sourceRecipeId: 'other',
      canScale: true,
    });
    expect(blocked.allowed).toBe(false);
  });

  it('suggests portion toward calorie then protein', () => {
    const suggestion = suggestPortion({
      sourceMacros: { calories: 500, proteinG: 40, fatG: 15, carbsG: 40 },
      candidateBaseMacros: { calories: 400, proteinG: 30, fatG: 12, carbsG: 35 },
      candidateBasePortionGrams: 350,
      originalPortionGrams: 400,
    });
    expect(suggestion.suggestedPortionGrams).toBeGreaterThan(350);
    expect(Math.abs(suggestion.macros.calories - 500)).toBeLessThan(40);
  });

  it('classifies equivalent / adjustable / conflicting', () => {
    const source = { calories: 500, proteinG: 40, fatG: 15, carbsG: 40 };
    expect(classifySubstitution({ source, candidate: { ...source, calories: 510 }, requiresOtherMealAdjust: false }).classification).toBe(
      'EQUIVALENT',
    );
    expect(classifySubstitution({ source, candidate: { ...source, calories: 560 }, requiresOtherMealAdjust: true }).classification).toBe(
      'ADJUSTABLE',
    );
    expect(classifySubstitution({ source, candidate: { ...source, calories: 700 }, requiresOtherMealAdjust: false }).classification).toBe(
      'CONFLICTING',
    );
  });

  it('ranks stably without randomness', () => {
    const a = {
      candidateId: 'b',
      nutrientDelta: { calories: 10, proteinG: 0, fatG: 0, carbsG: 0, caloriesPct: 2, proteinPct: 0, fatPct: 0, carbsPct: 0 },
      suggestedPortionGrams: 400,
      originalPortionGrams: 400,
      costDeltaRub: 0,
      preparationMinutes: 30,
      dietaryTags: [] as string[],
    };
    const b = { ...a, candidateId: 'a' };
    const scored = sortCandidatesStable([a, b], (c) =>
      rankScore({
        candidate: c,
        sourcePrepMinutes: 30,
        ingredientProductIds: [],
        constraints: emptyConstraints,
        dayCalorieGapAfter: 0,
      }),
    );
    expect(scored.map((c) => c.candidateId)).toEqual(['a', 'b']);
  });

  it('builds dish candidates excluding peanut when allergen set', () => {
    const products = productsMap();
    const all = recipes();
    const source = all.find((r) => r.recipeKey === 'buckwheat_chicken')!;
    const macros = recipeMacros(source, products, 1)!;
    const result = buildDishCandidates({
      sourceRecipe: source,
      sourcePortionGrams: source.portionGrams,
      sourceMacros: macros,
      sourceCost: { consumed: 100, packages: 200 },
      mealType: 'lunch',
      dayTargetCalories: 2500,
      dayOtherCalories: 1500,
      recipes: all,
      products,
      constraints: { ...emptyConstraints, allergens: ['peanut'] },
    });
    expect(result.candidates.every((c) => c.name !== 'peanut_chicken')).toBe(true);
    expect(result.candidates.some((c) => c.name === 'rice_turkey')).toBe(true);
    expect(result.candidates.some((c) => c.classification === 'EQUIVALENT' || c.classification === 'ADJUSTABLE')).toBe(true);
  });

  it('scales ingredient replacement grams', () => {
    const suggestion = suggestIngredientAmountWithMacros({
      otherMacros: { calories: 300, proteinG: 40, fatG: 8, carbsG: 10 },
      sourceDishMacros: { calories: 500, proteinG: 45, fatG: 10, carbsG: 50 },
      replacement: { caloriesPer100g: 77, proteinPer100g: 2, fatPer100g: 0.1, carbsPer100g: 17 },
    });
    expect(suggestion.amountGrams).toBeGreaterThan(40);
    expect(Math.abs(suggestion.dishMacros.calories - 500)).toBeLessThan(80);
  });

  it('builds ingredient candidates for potato', () => {
    const products = productsMap();
    const source = recipes().find((r) => r.recipeKey === 'buckwheat_chicken')!;
    const macros = recipeMacros(source, products, 1)!;
    const result = buildIngredientCandidates({
      sourceRecipe: source,
      sourcePortionGrams: source.portionGrams,
      sourceMacros: macros,
      sourceCost: { consumed: 120 },
      replaceProductId: 'a0930001-0000-4000-8000-000000000001',
      mealType: 'lunch',
      dayTargetCalories: 2500,
      dayOtherCalories: 1500,
      products,
      constraints: emptyConstraints,
    });
    expect(result.candidates.some((c) => c.productId === 'a0930001-0000-4000-8000-000000000002')).toBe(true);
  });

  it('recalculates day/week and shopping delta', () => {
    const day = replaceMealMacrosInDay({
      dayMeals: [
        { calories: 400, proteinG: 20, fatG: 10, carbsG: 40 },
        { calories: 500, proteinG: 40, fatG: 15, carbsG: 40 },
      ],
      mealIndex: 1,
      nextMacros: { calories: 520, proteinG: 42, fatG: 16, carbsG: 42 },
    });
    expect(day.after.calories).toBe(920);
    const week = weekTotals([day.before, day.after]);
    expect(week.avgDailyCalories).toBeGreaterThan(0);
    const shop = shoppingDelta({
      before: [{ productId: '1', displayName: 'Гречка', amount: 80, unit: 'g' }],
      after: [{ productId: '2', displayName: 'Картофель', amount: 200, unit: 'g' }],
    });
    expect(shop.removed[0]?.displayName).toBe('Гречка');
    expect(shop.added[0]?.displayName).toBe('Картофель');
  });

  it('returns INSUFFICIENT_DATA for goal impact without weights', () => {
    const impact = assessSubstitutionGoalImpact({
      sources: { profile: null, goal: null },
      dayCalorieDelta: 50,
      weekCalorieDelta: 350,
    });
    expect(impact.status).toBe('INSUFFICIENT_DATA');
  });

  it('hard-filters ingredient products by allergen', () => {
    const peanut = productsMap().get('a0930001-0000-4000-8000-000000000005')!;
    const result = hardFilterIngredientProduct({
      product: peanut,
      constraints: { ...emptyConstraints, allergens: ['peanut'] },
      sourceProductId: 'other',
    });
    expect(result.allowed).toBe(false);
  });
});
