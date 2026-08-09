import { describe, expect, it } from 'vitest';
import { DashboardTodayService } from '../application/dashboard-today.service';
import { MealPlanService } from '../../meal-plan/application/meal-plan.service';
import { WorkoutEngineService } from '../../workout-engine/application/workout-engine.service';

describe('dashboard today', () => {
  it('returns nutrition and budget cards', async () => {
    const mealPlanService = new MealPlanService();
    const workoutRepository = {
      async save() {
        return { days: [] };
      },
      async findLatestByUserId() {
        return null;
      },
    };
    const workoutEngineService = new WorkoutEngineService(workoutRepository as never);
    const mealTrackingService = {
      async getSummaryForUser(userId: string) {
        return mealPlanService.getSummary(userId);
      },
      async getToday() {
        return {
          localDate: '2026-07-21',
          plannedKcal: 2000,
          consumedKcal: 560,
          remainingKcal: 1440,
          proteinConsumed: 45,
          proteinTarget: 100,
          completedMealIds: ['m1'],
        };
      },
    };
    const shoppingListService = {
      async getBudget() {
        return { todayCost: 214.5, weekCost: 1501.5, currency: 'RUB' as const };
      },
    };
    const dashboard = await new DashboardTodayService(
      workoutEngineService,
      mealTrackingService as never,
      shoppingListService as never,
    ).get('u-dashboard');
    expect(dashboard.cards.length).toBeGreaterThanOrEqual(5);
    expect(dashboard.budget.weekCost).toBe(1501.5);
    expect(dashboard.cards.find((card) => card.id === 'budget-week')?.value).toContain('1501.5');
    const workoutCard = dashboard.cards.find((card) => card.id === 'workout');
    expect(workoutCard?.status).toBe('empty');
    expect(workoutCard?.value).toBe('not_planned');
  });
});
