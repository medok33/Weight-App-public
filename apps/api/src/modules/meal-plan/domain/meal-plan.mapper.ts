import type { MealPlan } from './meal-plan.types';
import { caloriesForMealName, proteinForMealName } from './meal-plan.builder';
import { normalizeMealKey } from './meal-keys';
import type { NutritionTargets } from './meal-plan.nutrition';

export type MealPlanDaySummary = {
  dayIndex: number;
  dayId?: string;
  mealId?: string;
  mealName: string;
  calories: number;
  proteinG: number;
  mealCount: number;
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

export function toMealPlanSummary(
  plan: MealPlan,
  targets?: NutritionTargets | null,
  completedMealIds: Set<string> = new Set(),
): MealPlanSummary {
  return {
    userId: plan.userId,
    version: plan.version,
    planId: plan.planId,
    personalized: Boolean(targets),
    targetKcal: targets?.targetKcal,
    proteinG: targets?.proteinG,
    fatG: targets?.fatG,
    carbsG: targets?.carbsG,
    tdeeKcal: targets?.tdeeKcal,
    days: plan.days.map((day) => {
      const primary = day.meals[0];
      const mealName = normalizeMealKey(primary?.name ?? 'greek_yogurt');
      const mealId = primary?.id;
      const calories = day.meals.reduce((sum, meal) => sum + caloriesForMealName(normalizeMealKey(meal.name)), 0);
      const proteinG = day.meals.reduce((sum, meal) => sum + proteinForMealName(normalizeMealKey(meal.name)), 0);
      return {
        dayIndex: day.dayIndex,
        dayId: day.dayId,
        mealId,
        mealName,
        calories,
        proteinG,
        mealCount: day.meals.length,
        completed: mealId ? completedMealIds.has(mealId) : false,
      };
    }),
  };
}
