import { apiFetch, ApiError } from '@/lib/api-fetch';
import type {
  MealDishDetail,
  MealPlanDayDetail,
  MealPlanSummary,
  MealTrackingToday,
} from '../model/meal-plan.types';

export async function getMealPlan(): Promise<MealPlanSummary> {
  const [planResponse, trackingResponse] = await Promise.all([
    apiFetch('/meal-plan'),
    apiFetch('/meal-tracking/today'),
  ]);
  if (!planResponse.ok) throw new ApiError(planResponse.status);
  const plan = (await planResponse.json()) as MealPlanSummary;
  const tracking = trackingResponse.ok
    ? ((await trackingResponse.json()) as MealTrackingToday)
    : { completedMealIds: [] as string[] };
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      completed: day.mealId ? tracking.completedMealIds.includes(day.mealId) : Boolean(day.completed),
      proteinG: day.proteinG ?? 0,
    })),
  };
}

export async function getMealPlanDay(dayIndex: number, planId?: string): Promise<MealPlanDayDetail> {
  const query = planId ? `?planId=${encodeURIComponent(planId)}` : '';
  const response = await apiFetch(`/meal-plan/days/${dayIndex}${query}`);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<MealPlanDayDetail>;
}

export async function getMealItemDetails(itemId: string): Promise<MealDishDetail> {
  const response = await apiFetch(`/meal-plan/items/${encodeURIComponent(itemId)}/details`);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<MealDishDetail>;
}

export async function regenerateMealPlan(): Promise<MealPlanSummary> {
  const response = await apiFetch('/meal-plan/regenerate', { method: 'POST', body: '{}' });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<MealPlanSummary>;
}

export async function completeMeal(mealId: string): Promise<MealTrackingToday> {
  const response = await apiFetch('/meal-tracking/complete', {
    method: 'POST',
    body: JSON.stringify({ mealId }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<MealTrackingToday>;
}

export async function uncompleteMeal(mealId: string): Promise<MealTrackingToday> {
  const response = await apiFetch(`/meal-tracking/complete?mealId=${encodeURIComponent(mealId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<MealTrackingToday>;
}
