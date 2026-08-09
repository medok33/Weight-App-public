export type MealPlanGenerationJob = { userId: string; recipes: unknown[]; idempotencyKey: string };
export function createMealPlanGenerationJob(userId: string, recipes: unknown[], idempotencyKey: string): MealPlanGenerationJob { if (!userId || !idempotencyKey) throw new Error('MEAL_PLAN_JOB_INVALID'); return { userId, recipes, idempotencyKey }; }
