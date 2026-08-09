export type NutritionToday = {
  localDate: string;
  plannedKcal: number;
  consumedKcal: number;
  remainingKcal: number;
  proteinConsumed: number;
  proteinTarget: number;
  completedMealIds: string[];
};

export type BudgetToday = {
  todayCost: number;
  weekCost: number;
  currency: 'RUB';
};

export type DashboardToday = {
  date: string;
  nutrition: NutritionToday;
  budget: BudgetToday;
  cards: Array<{ id: string; title: string; status: 'ready' | 'empty' | 'error'; value?: string }>;
};
