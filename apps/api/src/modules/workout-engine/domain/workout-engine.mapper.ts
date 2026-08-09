import type { Exercise, WorkoutPlan, WorkoutPlanDetail } from './workout-engine.types';
import { normalizeWorkoutKey } from './workout-keys';

export type WorkoutPlanSummaryDay = {
  dayIndex: number;
  exerciseOrder: number;
  exerciseName: string;
  exerciseKey?: string;
  exerciseId?: string | null;
  dayTitle?: string | null;
  isRestDay?: boolean;
  sets?: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  restSeconds?: number | null;
  riskLevel?: string;
};

export type WorkoutPlanSummary = {
  userId: string;
  version: number;
  planId?: string;
  algorithmVersion?: string;
  status?: string;
  days: WorkoutPlanSummaryDay[];
};

export function toWorkoutPlanSummary(
  userId: string,
  version: number,
  plan: WorkoutPlanDetail | WorkoutPlan,
  planId?: string,
  meta?: { algorithmVersion?: string; status?: string },
): WorkoutPlanSummary {
  const days: WorkoutPlanSummaryDay[] = [];

  for (const day of plan.days) {
    if ('exercises' in day && Array.isArray(day.exercises) && 'isRestDay' in day) {
      const detail = day as WorkoutPlanDetail['days'][number];
      if (detail.isRestDay || detail.exercises.length === 0) {
        days.push({
          dayIndex: detail.dayIndex,
          exerciseOrder: 0,
          exerciseName: 'rest',
          exerciseKey: 'rest',
          dayTitle: detail.dayTitle,
          isRestDay: true,
        });
        continue;
      }
      for (const ex of detail.exercises) {
        days.push({
          dayIndex: detail.dayIndex,
          exerciseOrder: ex.exerciseOrder,
          exerciseName: normalizeWorkoutKey(ex.exerciseName),
          exerciseKey: ex.exerciseKey ?? normalizeWorkoutKey(ex.exerciseName),
          exerciseId: ex.exerciseId,
          dayTitle: detail.dayTitle,
          isRestDay: false,
          sets: ex.sets,
          repsMin: ex.repsMin,
          repsMax: ex.repsMax,
          restSeconds: ex.restSeconds,
          riskLevel: ex.riskLevel,
        });
      }
      continue;
    }

    const legacy = day as WorkoutPlan['days'][number];
    days.push({
      dayIndex: legacy.dayIndex,
      exerciseOrder: 0,
      exerciseName: normalizeWorkoutKey(legacy.exercises[0]?.name ?? 'morning_walk'),
      isRestDay: false,
    });
  }

  return {
    userId,
    version,
    planId,
    algorithmVersion: meta?.algorithmVersion,
    status: meta?.status,
    days,
  };
}

export const DEFAULT_EXERCISES: Exercise[] = [
  { name: 'morning_walk', riskLevel: 'low', safetyTags: [] },
  { name: 'bodyweight_squats', riskLevel: 'low', safetyTags: ['knee'] },
  { name: 'stretching', riskLevel: 'low', safetyTags: [] },
  { name: 'light_jog', riskLevel: 'medium', safetyTags: ['knee'] },
  { name: 'core_plank', riskLevel: 'low', safetyTags: [] },
  { name: 'mobility_flow', riskLevel: 'low', safetyTags: [] },
  { name: 'recovery_walk', riskLevel: 'low', safetyTags: [] },
];
