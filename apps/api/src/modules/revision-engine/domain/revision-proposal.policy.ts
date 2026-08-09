import type { PlanKind, RevisionChangedItem, RevisionSnapshot } from './revision-engine.types';

export type MealPlanSource = {
  planId: string;
  version: number;
  days: { dayIndex: number; meals: { name: string; recipeId?: string }[] }[];
};

export type WorkoutPlanSource = {
  planId: string;
  version: number;
  days: { dayIndex: number; exercises: { name: string; riskLevel: 'low' | 'medium' | 'high' }[] }[];
};

export function resolveLifeMode(reason: string): 'travel' | 'holiday' | 'shift' | 'normal' {
  const normalized = reason.toLowerCase();
  if (normalized.includes('travel') || normalized.includes('поезд')) return 'travel';
  if (normalized.includes('holiday') || normalized.includes('праздн')) return 'holiday';
  if (normalized.includes('shift') || normalized.includes('смен')) return 'shift';
  return 'normal';
}

export function buildMealProposal(source: MealPlanSource, reason: string): {
  snapshot: RevisionSnapshot;
  changedItems: RevisionChangedItem[];
  warnings: string[];
  summary: string;
} {
  const mode = resolveLifeMode(reason);
  const prefix = mode === 'normal' ? '[adjusted] ' : `[${mode}] `;
  const days = source.days.map((day) => ({
    dayIndex: day.dayIndex,
    meals: day.meals.map((meal) => ({
      name: meal.name.startsWith('[') ? meal.name : `${prefix}${meal.name}`,
      recipeId: meal.recipeId,
    })),
  }));
  const changedItems: RevisionChangedItem[] = [];
  for (let i = 0; i < source.days.length; i += 1) {
    const prev = source.days[i]?.meals[0]?.name ?? '';
    const next = days[i]?.meals[0]?.name ?? '';
    if (prev !== next) {
      changedItems.push({ path: `days[${i}].meals[0].name`, previousValue: prev, proposedValue: next });
    }
  }
  const warnings = mode === 'normal' ? ['Изменения носят уточняющий характер.'] : [];
  return {
    snapshot: {
      kind: 'meal',
      sourcePlanId: source.planId,
      sourceVersion: source.version,
      reason,
      days,
    },
    changedItems,
    warnings,
    summary: `Предлагается скорректировать план питания (${changedItems.length} изменений).`,
  };
}

export function buildWorkoutProposal(source: WorkoutPlanSource, reason: string): {
  snapshot: RevisionSnapshot;
  changedItems: RevisionChangedItem[];
  warnings: string[];
  summary: string;
} {
  const injury = /injur|травм|knee|колен/i.test(reason);
  const days = source.days.map((day) => {
    const exercises = day.exercises
      .filter((exercise) => !(injury && exercise.riskLevel !== 'low'))
      .map((exercise) => ({ name: exercise.name, riskLevel: exercise.riskLevel as 'low' | 'medium' | 'high' }));
    if (!exercises.length) {
      exercises.push({ name: 'recovery_walk', riskLevel: 'low' });
    }
    return { dayIndex: day.dayIndex, exercises };
  });
  const changedItems: RevisionChangedItem[] = [];
  for (let i = 0; i < source.days.length; i += 1) {
    const prev = source.days[i]?.exercises[0]?.name ?? '';
    const next = days[i]?.exercises[0]?.name ?? '';
    if (prev !== next) {
      changedItems.push({ path: `days[${i}].exercises[0].name`, previousValue: prev, proposedValue: next });
    }
  }
  const warnings = injury ? ['Исключены упражнения с повышенным риском.'] : [];
  return {
    snapshot: {
      kind: 'workout',
      sourcePlanId: source.planId,
      sourceVersion: source.version,
      reason,
      days,
    },
    changedItems,
    warnings,
    summary: `Предлагается скорректировать план тренировок (${changedItems.length} изменений).`,
  };
}

export function assertPlanKind(value: string): PlanKind {
  if (value !== 'meal' && value !== 'workout') throw new Error('REVISION_PLAN_KIND_INVALID');
  return value;
}
