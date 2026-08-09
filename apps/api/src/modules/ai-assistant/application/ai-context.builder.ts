import { Inject, Injectable, Optional } from '@nestjs/common';
import { MealPlanService } from '../../meal-plan/application/meal-plan.service';
import { MealTrackingService } from '../../meal-tracking/application/meal-tracking.service';
import { ProgressService } from '../../progress/application/progress.service';
import { ShoppingListService } from '../../shopping-list/application/shopping-list.service';
import { UserProfileService } from '../../user-profile/application/user-profile.service';
import { WorkoutEngineService } from '../../workout-engine/application/workout-engine.service';
import { minimizeHealthData } from '../domain/ai-assistant.policy';
import {
  AI_CONTEXT_DATA_VERSION,
  type AIConversationContext,
  type ContextSourceFlags,
} from '../domain/ai-conversation-context.types';
import { buildGoalCore } from '../domain/ai-goal-core';

/**
 * Production context pipeline — aggregates user domains into one snapshot.
 * AI module must not query other tables directly.
 * Topic selection happens after build (see selectTopicContext).
 */
@Injectable()
export class AIContextBuilder {
  constructor(
    @Optional() @Inject(UserProfileService) private readonly userProfile?: UserProfileService,
    @Optional() @Inject(MealPlanService) private readonly mealPlan?: MealPlanService,
    @Optional() @Inject(MealTrackingService) private readonly mealTracking?: MealTrackingService,
    @Optional() @Inject(WorkoutEngineService) private readonly workout?: WorkoutEngineService,
    @Optional() @Inject(ProgressService) private readonly progress?: ProgressService,
    @Optional() @Inject(ShoppingListService) private readonly shopping?: ShoppingListService,
  ) {}

  async buildSnapshot(userId: string, generatedAt = new Date().toISOString()): Promise<AIConversationContext> {
    if (!userId) throw new Error('USER_ID_REQUIRED');

    const [profile, goal, nutritionToday, mealPlan, workout, progress, shopping, budget] = await Promise.all([
      this.safe(() => this.userProfile?.getProfile(userId)),
      this.safe(() => this.userProfile?.getGoal(userId)),
      this.safe(() => this.mealTracking?.getToday(userId)),
      this.safe(() => this.mealPlan?.getSummary(userId)),
      this.safe(() => this.workout?.getSummary(userId)),
      this.safe(() => this.progress?.summary(userId)),
      this.safe(() => this.shopping?.getLatest(userId)),
      this.safe(() => this.shopping?.getBudget(userId)),
    ]);

    const profileData = profile
      ? minimizeHealthData({
          ageYears: profile.ageYears,
          heightCm: profile.heightCm,
          weightKg: profile.weightKg,
          activityLevel: profile.activityLevel,
          locale: profile.locale,
          trainingLevel: profile.trainingLevel ?? null,
          workoutsPerWeek: profile.workoutsPerWeek ?? null,
          dietaryPreferences: profile.dietaryPreferences ?? null,
          foodRestrictions: profile.foodRestrictions ?? null,
          availableEquipment: profile.availableEquipment ?? null,
        })
      : null;

    const goalData = goal
      ? minimizeHealthData({
          kind: goal.kind,
          target: goal.target,
          unit: goal.unit,
          targetDate: goal.targetDate ?? null,
        })
      : null;

    const nutritionData = nutritionToday
      ? {
          localDate: nutritionToday.localDate,
          plannedKcal: nutritionToday.plannedKcal,
          consumedKcal: nutritionToday.consumedKcal,
          remainingKcal: nutritionToday.remainingKcal,
          proteinConsumed: nutritionToday.proteinConsumed,
          proteinTarget: nutritionToday.proteinTarget,
          completedMeals: nutritionToday.completedMealIds.length,
        }
      : null;

    const mealPlanData = mealPlan
      ? {
          personalized: mealPlan.personalized,
          targetKcal: mealPlan.targetKcal,
          proteinG: mealPlan.proteinG,
          days: mealPlan.days?.slice(0, 7).map((d) => ({
            dayIndex: d.dayIndex,
            mealName: d.mealName,
            calories: d.calories,
            proteinG: d.proteinG,
            completed: d.completed,
          })),
        }
      : null;

    const workoutData = workout
      ? {
          version: workout.version,
          days: workout.days?.slice(0, 7).map((d) => ({
            dayIndex: d.dayIndex,
            exerciseName: d.exerciseName,
          })),
        }
      : null;

    const progressData = progress
      ? {
          deltaKg: progress.deltaKg,
          latestWeightKg: progress.latest?.weightKg,
          entryCount: progress.entries.length,
        }
      : null;

    const shoppingData = shopping
      ? {
          itemCount: shopping.items.length,
          estimatedTotal: shopping.estimatedTotal,
          currency: 'RUB' as const,
          items: shopping.items.slice(0, 30).map((item) => ({
            name: item.name,
            estimatedCost: item.estimatedCost ?? null,
            estimatedUnitPrice: item.estimatedUnitPrice ?? null,
            retailerName: item.retailerName ?? null,
            retailerCode: item.retailerCode ?? null,
            priceSourceName: item.priceSourceName ?? null,
            priceSourceType: item.priceSourceType ?? null,
            collectedAt: item.priceCollectedAt ?? null,
            priceStatus:
              item.estimatedCost == null && item.estimatedUnitPrice == null
                ? 'MISSING'
                : item.priceSourceType
                  ? 'OBSERVED'
                  : 'ESTIMATED',
          })),
        }
      : null;

    const pricedItems = (shoppingData?.items ?? []).filter((i) => i.priceStatus !== 'MISSING');
    const missingPriceCount = (shoppingData?.items ?? []).filter((i) => i.priceStatus === 'MISSING').length;

    const priceData =
      shopping || budget
        ? {
            weekBudget: budget?.weekCost ?? null,
            todayBudget: budget?.todayCost ?? null,
            currency: budget?.currency ?? 'RUB',
            confirmedItemCount: pricedItems.filter((i) => i.priceStatus === 'OBSERVED').length,
            estimatedItemCount: pricedItems.filter((i) => i.priceStatus === 'ESTIMATED').length,
            missingPriceCount,
            budgetIsApproximate: missingPriceCount > 0,
            items: (shoppingData?.items ?? []).slice(0, 15),
          }
        : null;

    const goalCore = buildGoalCore({
      profile: profileData
        ? {
            weightKg: profile?.weightKg,
            activityLevel: profile?.activityLevel,
            trainingLevel: profile?.trainingLevel,
            workoutsPerWeek: profile?.workoutsPerWeek,
            dietaryPreferences: profile?.dietaryPreferences,
            foodRestrictions: profile?.foodRestrictions,
            availableEquipment: profile?.availableEquipment,
          }
        : null,
      goal: goalData
        ? {
            kind: goal?.kind,
            target: goal?.target,
            unit: goal?.unit,
            targetDate: goal?.targetDate,
          }
        : null,
      progress: progressData,
      workout: workoutData,
    });

    const data = {
      goalCore,
      profile: profileData,
      goal: goalData,
      nutritionToday: nutritionData,
      mealPlan: mealPlanData,
      workout: workoutData,
      progress: progressData,
      shopping: shoppingData,
      priceIntelligence: priceData,
    };

    const flags: ContextSourceFlags = {
      profile: profileData !== null,
      goal: goalData !== null,
      goalCore: goalCore.primaryGoal != null || goalCore.currentWeight != null,
      nutritionToday: nutritionData !== null,
      mealPlan: mealPlanData !== null,
      workout: workoutData !== null,
      progress: progressData !== null,
      shopping: shoppingData !== null,
      prices: priceData !== null && (priceData.items?.length ?? 0) > 0,
    };

    return {
      userId,
      generatedAt,
      dataVersion: AI_CONTEXT_DATA_VERSION,
      flags,
      data,
    };
  }

  private async safe<T>(fn: () => Promise<T | undefined | null>): Promise<T | null> {
    try {
      const value = await fn();
      return value ?? null;
    } catch {
      return null;
    }
  }
}
