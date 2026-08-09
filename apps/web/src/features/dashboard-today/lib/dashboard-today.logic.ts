import type { UserGoal } from '@/features/user-profile/model/user-profile.types';
import type { ProgressSummary } from '@/features/progress/model/progress.types';

export type DashboardNutrition = {
  plannedKcal: number;
  consumedKcal: number;
  remainingKcal: number;
  proteinConsumed: number;
  proteinTarget: number;
};

export type DashboardBudget = { todayCost: number; weekCost: number; currency: string };

export type DashboardCard = {
  id: string;
  title: string;
  status: 'ready' | 'empty' | 'error';
  value?: string;
};

export type DashboardPayload = {
  date: string;
  nutrition?: DashboardNutrition;
  budget?: DashboardBudget;
  cards: DashboardCard[];
};

/** Cards shown as primary “today” items (linked). Others are redundant with strips. */
export const PRIMARY_CARD_IDS = new Set(['meal-plan', 'workout']);

export const CARD_HREF: Record<string, string> = {
  'meal-plan': '/meal-plan',
  workout: '/workout-engine',
};

export type QuickAction = { id: string; href: string; testId: string };

export const DASHBOARD_QUICK_ACTIONS: QuickAction[] = [
  { id: 'meal', href: '/meal-plan', testId: 'dashboard-qa-meal' },
  { id: 'workout', href: '/workout-engine', testId: 'dashboard-qa-workout' },
  { id: 'progress', href: '/progress', testId: 'dashboard-qa-progress' },
  { id: 'shopping', href: '/shopping-list', testId: 'dashboard-qa-shopping' },
  { id: 'assistant', href: '/assistant', testId: 'dashboard-qa-assistant' },
  { id: 'settings', href: '/settings', testId: 'dashboard-qa-settings' },
];

export function selectPrimaryCards(cards: DashboardCard[] | undefined): DashboardCard[] {
  return (cards ?? []).filter((c) => PRIMARY_CARD_IDS.has(c.id));
}

export function hasPartialCardErrors(data: DashboardPayload): boolean {
  return (data.cards ?? []).some((c) => c.status === 'error');
}

export function isNewUserDashboard(data: DashboardPayload | undefined): boolean {
  if (!data?.cards?.length) return true;
  const meal = data.cards.find((c) => c.id === 'meal-plan');
  const workout = data.cards.find((c) => c.id === 'workout');
  const mealEmpty = !meal?.value || meal.value === 'not_planned' || meal.status === 'empty';
  const workoutEmpty =
    !workout?.value || workout.value === 'not_planned' || workout.status === 'empty';
  const nutritionEmpty =
    !data.nutrition ||
    (data.nutrition.plannedKcal === 0 &&
      data.nutrition.consumedKcal === 0 &&
      data.nutrition.proteinTarget === 0);
  return mealEmpty && workoutEmpty && Boolean(nutritionEmpty);
}

export function formatGoalSummary(
  goal: UserGoal | null | undefined,
  kindLabel?: string,
): string | null {
  if (!goal?.kind || !(goal.target > 0) || !goal.unit) return null;
  const kind = kindLabel && kindLabel.trim() ? kindLabel.trim() : goal.kind;
  return `${kind}: ${goal.target} ${goal.unit}`;
}

export function formatProgressSummary(
  summary: ProgressSummary | null | undefined,
  locale: 'ru' | 'en',
): { latest: string | null; delta: string | null } {
  if (!summary?.latest) return { latest: null, delta: null };
  const latest = `${summary.latest.weightKg} kg`;
  if (summary.deltaKg == null) return { latest, delta: null };
  const sign = summary.deltaKg > 0 ? '+' : '';
  const deltaLabel = locale === 'en' ? 'change' : 'изменение';
  return { latest, delta: `${deltaLabel}: ${sign}${summary.deltaKg} kg` };
}

export function formatDashboardDate(isoDate: string, locale: 'ru' | 'en'): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}
