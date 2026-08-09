export type MealCompletionRecord = {
  id: string;
  userId: string;
  mealId: string;
  planId: string;
  dayIndex: number;
  calories: number;
  proteinG: number;
  localDate: string;
  completedAt: string;
};

export type MealTrackingToday = {
  localDate: string;
  plannedKcal: number;
  consumedKcal: number;
  remainingKcal: number;
  proteinConsumed: number;
  proteinTarget: number;
  completedMealIds: string[];
};
