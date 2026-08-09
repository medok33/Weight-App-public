import { Inject, Injectable } from '@nestjs/common';
import type { DashboardToday } from '../domain/dashboard-today.types';
import { WorkoutEngineService } from '../../workout-engine/application/workout-engine.service';
import { MealTrackingService } from '../../meal-tracking/application/meal-tracking.service';
import { ShoppingListService } from '../../shopping-list/application/shopping-list.service';
import { normalizeMealKey } from '../../meal-plan/domain/meal-keys';
import { normalizeWorkoutKey } from '../../workout-engine/domain/workout-keys';

@Injectable()
export class DashboardTodayService {
  constructor(
    @Inject(WorkoutEngineService) private readonly workoutEngineService: WorkoutEngineService,
    @Inject(MealTrackingService) private readonly mealTrackingService: MealTrackingService,
    @Inject(ShoppingListService) private readonly shoppingListService: ShoppingListService,
  ) {}

  async get(userId: string, date = new Date().toISOString().slice(0, 10)): Promise<DashboardToday> {
    if (!userId) throw new Error('DASHBOARD_USER_REQUIRED');

    const [mealPlan, workoutPlan, tracking, budget] = await Promise.all([
      this.mealTrackingService.getSummaryForUser(userId, date),
      this.safeWorkoutSummary(userId),
      this.mealTrackingService.getToday(userId, date),
      this.shoppingListService.getBudget(userId),
    ]);

    const todayMeal = mealPlan.days.find((day) => day.completed) ?? mealPlan.days[0];
    const workoutDay = workoutPlan?.day;
    const firstWorkout = workoutDay?.exercises?.find(
      (exercise) => exercise.exerciseName && exercise.exerciseName !== 'rest',
    );
    const todayWorkout = firstWorkout?.exerciseName
      ? normalizeWorkoutKey(firstWorkout.exerciseName)
      : 'not_planned';
    const mealValue = todayMeal
      ? `${normalizeMealKey(todayMeal.mealName)}${todayMeal.completed ? '|done' : ''}`
      : 'not_planned';

    return {
      date,
      nutrition: tracking,
      budget,
      cards: [
        {
          id: 'meal-plan',
          title: 'card.mealPlan',
          status: 'ready',
          value: mealValue,
        },
        {
          id: 'workout',
          title: 'card.workout',
          status: !workoutDay || workoutDay.isRestDay ? 'empty' : 'ready',
          value: todayWorkout,
        },
        { id: 'nutrition', title: 'card.nutrition', status: 'ready', value: 'nutrition_summary' },
        {
          id: 'budget-today',
          title: 'card.budgetToday',
          status: budget.weekCost > 0 ? 'ready' : 'empty',
          value: String(budget.todayCost),
        },
        {
          id: 'budget-week',
          title: 'card.budgetWeek',
          status: budget.weekCost > 0 ? 'ready' : 'empty',
          value: String(budget.weekCost),
        },
      ],
    };
  }

  private async safeWorkoutSummary(userId: string) {
    try {
      return await this.workoutEngineService.getTodayView(userId);
    } catch {
      return { userId, version: 0, dayIndex: 0, day: null };
    }
  }
}
