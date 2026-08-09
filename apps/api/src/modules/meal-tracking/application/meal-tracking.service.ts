import { Inject, Injectable } from '@nestjs/common';
import { MealPlanService } from '../../meal-plan/application/meal-plan.service';
import { MealPlanRepository } from '../../meal-plan/infrastructure/meal-plan.repository';
import { macrosForMealName } from '../../meal-plan/domain/meal-plan.defaults';
import { toMealPlanSummary } from '../../meal-plan/domain/meal-plan.mapper';
import { MealTrackingRepository } from '../infrastructure/meal-tracking.repository';
import type { MealTrackingToday } from '../domain/meal-tracking.types';

function todayIso(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MealTrackingService {
  constructor(
    @Inject(MealTrackingRepository) private readonly repository: MealTrackingRepository,
    @Inject(MealPlanService) private readonly mealPlanService: MealPlanService,
    @Inject(MealPlanRepository) private readonly mealPlanRepository: MealPlanRepository,
  ) {}

  async getSummaryForUser(userId: string, localDate = todayIso()) {
    const [plan, targets, completed] = await Promise.all([
      this.mealPlanService.getActivePlan(userId),
      this.mealPlanService.resolveTargets(userId),
      this.repository.findCompletedMealIds(userId, localDate),
    ]);
    return toMealPlanSummary(plan, targets, completed);
  }

  async completeMeal(userId: string, mealId: string, localDate = todayIso()) {
    if (!userId || !mealId) throw new Error('MEAL_TRACKING_INVALID');
    const ownership = await this.mealPlanRepository.findMealOwnership(mealId);
    if (!ownership || ownership.userId !== userId) throw new Error('MEAL_TRACKING_MEAL_NOT_FOUND');
    const macros = macrosForMealName(ownership.mealName);
    await this.repository.upsertCompletion({
      userId,
      mealId,
      planId: ownership.planId,
      dayIndex: ownership.dayIndex,
      calories: macros.calories,
      proteinG: macros.proteinG,
      localDate,
    });
    return this.getToday(userId, localDate);
  }

  async uncompleteMeal(userId: string, mealId: string, localDate = todayIso()) {
    if (!userId || !mealId) throw new Error('MEAL_TRACKING_INVALID');
    await this.repository.removeCompletion(userId, mealId, localDate);
    return this.getToday(userId, localDate);
  }

  async getToday(userId: string, localDate = todayIso()): Promise<MealTrackingToday> {
    if (!userId) throw new Error('MEAL_TRACKING_USER_REQUIRED');
    const [summary, consumed, completedMealIds] = await Promise.all([
      this.getSummaryForUser(userId, localDate),
      this.repository.sumForDate(userId, localDate),
      this.repository.findCompletedMealIds(userId, localDate),
    ]);
    const plannedKcal = summary.targetKcal ?? summary.days.reduce((sum, day) => sum + day.calories, 0);
    const proteinTarget = summary.proteinG ?? 0;
    return {
      localDate,
      plannedKcal,
      consumedKcal: consumed.calories,
      remainingKcal: Math.max(0, plannedKcal - consumed.calories),
      proteinConsumed: consumed.proteinG,
      proteinTarget,
      completedMealIds: [...completedMealIds],
    };
  }
}
