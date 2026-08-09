import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_QUICK_ACTIONS,
  formatGoalSummary,
  formatProgressSummary,
  hasPartialCardErrors,
  isNewUserDashboard,
  selectPrimaryCards,
  type DashboardPayload,
} from '../dashboard-today.logic';

const emptyLike: DashboardPayload = {
  date: '2026-07-31',
  nutrition: {
    plannedKcal: 0,
    consumedKcal: 0,
    remainingKcal: 0,
    proteinConsumed: 0,
    proteinTarget: 0,
  },
  budget: { todayCost: 0, weekCost: 0, currency: 'RUB' },
  cards: [
    { id: 'meal-plan', title: 'card.mealPlan', status: 'empty', value: 'not_planned' },
    { id: 'workout', title: 'card.workout', status: 'empty', value: 'not_planned' },
    { id: 'nutrition', title: 'card.nutrition', status: 'empty', value: 'nutrition_summary' },
    { id: 'budget-today', title: 'card.budgetToday', status: 'empty', value: '0' },
    { id: 'budget-week', title: 'card.budgetWeek', status: 'empty', value: '0' },
  ],
};

const ready: DashboardPayload = {
  date: '2026-07-31',
  nutrition: {
    plannedKcal: 1800,
    consumedKcal: 400,
    remainingKcal: 1400,
    proteinConsumed: 30,
    proteinTarget: 120,
  },
  budget: { todayCost: 10, weekCost: 70, currency: 'RUB' },
  cards: [
    { id: 'meal-plan', title: 'card.mealPlan', status: 'ready', value: 'greek_yogurt' },
    { id: 'workout', title: 'card.workout', status: 'ready', value: 'walk' },
    { id: 'nutrition', title: 'card.nutrition', status: 'ready', value: 'nutrition_summary' },
    { id: 'budget-today', title: 'card.budgetToday', status: 'ready', value: '10' },
    { id: 'budget-week', title: 'card.budgetWeek', status: 'ready', value: '70' },
  ],
};

describe('dashboard-today.logic', () => {
  it('detects empty / new-user dashboard heuristic', () => {
    expect(isNewUserDashboard(emptyLike)).toBe(true);
    expect(isNewUserDashboard(ready)).toBe(false);
  });

  it('selects only primary meal/workout cards', () => {
    expect(selectPrimaryCards(ready.cards).map((c) => c.id)).toEqual(['meal-plan', 'workout']);
  });

  it('flags partial card errors', () => {
    expect(hasPartialCardErrors(ready)).toBe(false);
    expect(
      hasPartialCardErrors({
        ...ready,
        cards: [{ id: 'meal-plan', title: 'x', status: 'error' }],
      }),
    ).toBe(true);
  });

  it('formats goal and progress without inventing values', () => {
    expect(formatGoalSummary(null)).toBeNull();
    expect(formatGoalSummary({ userId: 'u', kind: 'lose_weight', target: 70, unit: 'kg' })).toBe(
      'lose_weight: 70 kg',
    );
    expect(
      formatGoalSummary({ userId: 'u', kind: 'lose_weight', target: 70, unit: 'kg' }, 'Снижение веса'),
    ).toBe('Снижение веса: 70 kg');
    expect(formatProgressSummary({ userId: 'u', latest: null, entries: [], deltaKg: null }, 'ru')).toEqual({
      latest: null,
      delta: null,
    });
    expect(
      formatProgressSummary(
        {
          userId: 'u',
          latest: { userId: 'u', weightKg: 80, measuredAt: '2026-07-31' },
          entries: [],
          deltaKg: -1.5,
        },
        'en',
      ),
    ).toEqual({ latest: '80 kg', delta: 'change: -1.5 kg' });
  });

  it('exposes quick actions to existing USER routes only', () => {
    const hrefs = DASHBOARD_QUICK_ACTIONS.map((a) => a.href);
    expect(hrefs).toEqual([
      '/meal-plan',
      '/workout-engine',
      '/progress',
      '/shopping-list',
      '/assistant',
      '/settings',
    ]);
    expect(hrefs.some((h) => h.startsWith('/admin') || h.startsWith('/owner'))).toBe(false);
  });
});
