import type { LifeMode, MealPlan, PlanLifecycle, RecipeCandidate } from './meal-plan.types';
import { buildWeeklyPlan as buildWeeklyPlanWithOptions } from './meal-plan.builder';

export function selectRecipeCandidates(candidates: RecipeCandidate[], excludedTags: string[] = []) {
  return candidates.filter((c) => !c.tags?.some((tag) => excludedTags.includes(tag))).sort((a, b) => a.calories - b.calories);
}
export function validatePlan(plan: MealPlan): MealPlan {
  if (!plan.userId || plan.version < 1 || plan.days.length < 1 || plan.days.some((d) => d.dayIndex < 0 || d.meals.length < 1)) {
    throw new Error('MEAL_PLAN_INVALID');
  }
  return plan;
}
export function buildWeeklyPlan(userId: string, recipes: RecipeCandidate[], options?: { targetKcal?: number; version?: number }): MealPlan {
  return buildWeeklyPlanWithOptions(userId, recipes, options);
}
export function nextImmutableVersion(existing: MealPlan[]) {
  return existing.reduce((max, p) => Math.max(max, p.version), 0) + 1;
}
export function substituteRecipe(candidates: RecipeCandidate[], excludedTags: string[], currentId?: string) {
  return selectRecipeCandidates(candidates.filter((c) => c.id !== currentId), excludedTags)[0];
}
export function adaptPlanForLifeMode(plan: MealPlan, mode: LifeMode): MealPlan {
  const prefix = mode === 'normal' ? '' : `[${mode}] `;
  return { ...plan, days: plan.days.map((d) => ({ ...d, meals: d.meals.map((m) => ({ ...m, name: `${prefix}${m.name}` })) })) };
}
const transitions: Record<PlanLifecycle, PlanLifecycle[]> = {
  draft: ['generating', 'archived'],
  generating: ['active', 'draft'],
  active: ['paused', 'completed'],
  paused: ['active', 'archived'],
  completed: ['archived'],
  archived: [],
};
export function transitionPlan(state: PlanLifecycle, next: PlanLifecycle): PlanLifecycle {
  if (!transitions[state].includes(next)) throw new Error('MEAL_PLAN_INVALID_TRANSITION');
  return next;
}
