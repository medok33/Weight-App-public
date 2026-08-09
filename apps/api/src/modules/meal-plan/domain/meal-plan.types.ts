export type RecipeCandidate = {
  id: string;
  name: string;
  calories: number;
  proteinG?: number;
  tags?: string[];
  mealType?: string;
  plannedTime?: string;
};

export type MealPlanMeal = {
  id?: string;
  name: string;
  recipeId?: string;
  recipeVersionId?: string;
  contentProvenance?: string;
  customizationSnapshotJson?: unknown;
  mealType?: string;
  plannedTime?: string;
  portionGrams?: number;
  servings?: number;
};

export type MealPlan = {
  userId: string;
  version: number;
  planId?: string;
  days: { dayIndex: number; dayId?: string; meals: MealPlanMeal[] }[];
};

export type LifeMode = 'normal' | 'travel' | 'holiday' | 'shift';
export type PlanLifecycle = 'draft' | 'generating' | 'active' | 'paused' | 'completed' | 'archived';
export type MealPlanGeneration = { userId: string; recipes: RecipeCandidate[]; idempotencyKey: string };
export type OutboxEvent = { id: string; type: 'meal_plan.generate'; aggregateId: string; idempotencyKey: string };
