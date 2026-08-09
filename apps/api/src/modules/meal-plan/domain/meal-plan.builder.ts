import type { MealPlan, RecipeCandidate } from './meal-plan.types';
import { selectRecipeCandidates } from './meal-plan.policy';
import { macrosForMealName } from './meal-plan.defaults';
import { DEFAULT_DAY_SLOTS, STEP092_RECIPES } from './meal-dish.fixture';
import { STEP093_RECIPES } from './substitution.fixture';
import { resolveDaySchedule } from './meal-dish.ordering';

export function caloriesForMealName(name: string): number {
  return macrosForMealName(name).calories;
}

export function proteinForMealName(name: string): number {
  return macrosForMealName(name).proteinG;
}

export function selectRecipesForTarget(candidates: RecipeCandidate[], targetKcal?: number): RecipeCandidate[] {
  if (!targetKcal || !Number.isFinite(targetKcal)) {
    return selectRecipeCandidates(candidates).slice(0, 7);
  }
  const mealTarget = Math.max(150, Math.round(targetKcal / 3));
  return [...candidates]
    .sort((left, right) => {
      const byDistance = Math.abs(left.calories - mealTarget) - Math.abs(right.calories - mealTarget);
      return byDistance !== 0 ? byDistance : left.calories - right.calories;
    })
    .slice(0, 7);
}

const ALL_FIXTURE_RECIPES = [...STEP092_RECIPES, ...STEP093_RECIPES];

function recipeByKey(recipeKey: string) {
  return ALL_FIXTURE_RECIPES.find((recipe) => recipe.recipeKey === recipeKey);
}

/** Builds a 7-day plan with structured multi-meal days for STEP_092 detail experience. */
export function buildWeeklyPlan(
  userId: string,
  _recipes: RecipeCandidate[],
  options?: {
    targetKcal?: number;
    version?: number;
    profileSchedule?: Array<{ mealType?: string; plannedTime?: string; recipeKey?: string }> | null;
  },
): MealPlan {
  const slots = resolveDaySchedule(DEFAULT_DAY_SLOTS, options?.profileSchedule);
  const days = Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    meals: slots.map((slot) => {
      const recipe = recipeByKey(slot.recipeKey);
      return {
        name: recipe?.name ?? slot.recipeKey,
        recipeId: recipe?.id,
        mealType: slot.mealType,
        plannedTime: slot.plannedTime,
        portionGrams: recipe?.portionGrams,
      };
    }),
  }));
  return { userId, version: options?.version ?? 1, days };
}
