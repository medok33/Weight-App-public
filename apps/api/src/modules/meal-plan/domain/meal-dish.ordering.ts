import { MEAL_TYPE_ORDER, type MealType } from './meal-dish.fixture';

export function normalizeMealType(value: string | null | undefined): MealType {
  const key = String(value ?? 'extra').toLowerCase().replace(/-/g, '_') as MealType;
  return MEAL_TYPE_ORDER.includes(key) ? key : 'extra';
}

export function compareMealSlots(
  left: { mealType?: string | null; plannedTime?: string | null },
  right: { mealType?: string | null; plannedTime?: string | null },
): number {
  const leftType = normalizeMealType(left.mealType);
  const rightType = normalizeMealType(right.mealType);
  const byType = MEAL_TYPE_ORDER.indexOf(leftType) - MEAL_TYPE_ORDER.indexOf(rightType);
  if (byType !== 0) return byType;
  return String(left.plannedTime ?? '').localeCompare(String(right.plannedTime ?? ''));
}

/** Prefer profile mealSchedule JSON when present; otherwise default slots. */
export function resolveDaySchedule(
  defaultSlots: Array<{ mealType: MealType; plannedTime: string; recipeKey: string }>,
  profileSchedule?: Array<{ mealType?: string; plannedTime?: string; recipeKey?: string }> | null,
): Array<{ mealType: MealType; plannedTime: string; recipeKey: string }> {
  if (!profileSchedule?.length) return defaultSlots;
  const mapped = profileSchedule
    .map((slot) => ({
      mealType: normalizeMealType(slot.mealType),
      plannedTime: String(slot.plannedTime ?? '').trim() || '12:00',
      recipeKey: String(slot.recipeKey ?? '').trim(),
    }))
    .filter((slot) => slot.recipeKey);
  return mapped.length ? mapped : defaultSlots;
}
