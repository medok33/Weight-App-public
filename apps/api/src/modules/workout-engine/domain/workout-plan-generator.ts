import type {
  CatalogExercise,
  MovementPattern,
  PreferredDuration,
  TrainingPlace,
  TrainingLevel,
  WorkoutPlanDayDetail,
  WorkoutPlanDayExercise,
  WorkoutPlanDetail,
  WorkoutPlanGenerateInput,
} from './workout-engine.types';
import { buildPlanExercisePrescription } from '../energy/workout-plan-prescription';

export const LEGACY_ALGORITHM_VERSION = 'workout-v2-01a.1';
/** Pre-catalog hub algorithm stamp (still valid for historical plans). */
export const HUB_ALGORITHM_VERSION = 'workout-v2-01b.1';
/** Generator stamp after WORKOUT-CATALOG-01A release-gated selection. */
export const ALGORITHM_VERSION_01A = 'workout-catalog-01a.1';
/** Generator stamp after WORKOUT-CATALOG-01B canonical 84-exercise release. */
export const ALGORITHM_VERSION = 'workout-catalog-01b.1';

export const WORKOUT_EQUIPMENT_CODES = [
  'NONE',
  'BODYWEIGHT',
  'RESISTANCE_BAND',
  'DUMBBELL',
  'KETTLEBELL',
  'BENCH',
  'PULLUP_BAR',
  'GYM_MACHINES',
  'BARBELL',
  'CARDIO_MACHINE',
] as const;

const HOME_EQUIPMENT = new Set([
  'NONE',
  'BODYWEIGHT',
  'RESISTANCE_BAND',
  'DUMBBELL',
  'KETTLEBELL',
  'BENCH',
  'PULLUP_BAR',
]);

const LEVEL_RANK: Record<TrainingLevel, number> = {
  BEGINNER: 1,
  INTERMEDIATE: 2,
  ADVANCED: 3,
};

const WORKOUT_DAY_SCHEDULE: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 2, 4, 5],
  5: [0, 1, 3, 4, 6],
};

/** Exported for coverage tests (weekly skeleton day indices). */
export { WORKOUT_DAY_SCHEDULE };

const MOVEMENT_PRIORITY: MovementPattern[] = [
  'squat',
  'hinge',
  'push',
  'pull',
  'core',
  'cardio',
  'mobility',
];

/** Volume caps per workout day / week (foundation). */
export const VOLUME_CAPS = {
  minExercisesPerWorkout: 3,
  maxExercisesPerWorkout: 5,
  maxSetsPerExercise: 5,
  maxWeeklyWorkoutDays: 5,
} as const;

type Prescription = { sets: number; repsMin: number; repsMax: number; restSeconds: number };

function normalizeGoalBucket(goalKind: string): 'lose' | 'gain' | 'endurance' | 'general' {
  const g = goalKind.trim().toLowerCase();
  if (/lose|fat|weight_loss|похуд|сброс/.test(g)) return 'lose';
  if (/gain|muscle|hypertrophy|набор|мышц/.test(g)) return 'gain';
  if (/endurance|cardio|выносл|кардио/.test(g)) return 'endurance';
  return 'general';
}

/** Sets / reps / rest by training level + goal bucket. */
export function prescriptionFor(level: TrainingLevel, goalKind: string): Prescription {
  const goal = normalizeGoalBucket(goalKind);
  const table: Record<TrainingLevel, Record<'lose' | 'gain' | 'endurance' | 'general', Prescription>> = {
    BEGINNER: {
      lose: { sets: 2, repsMin: 12, repsMax: 15, restSeconds: 45 },
      gain: { sets: 3, repsMin: 8, repsMax: 12, restSeconds: 75 },
      endurance: { sets: 2, repsMin: 15, repsMax: 20, restSeconds: 40 },
      general: { sets: 2, repsMin: 10, repsMax: 12, restSeconds: 60 },
    },
    INTERMEDIATE: {
      lose: { sets: 3, repsMin: 12, repsMax: 15, restSeconds: 50 },
      gain: { sets: 4, repsMin: 6, repsMax: 10, restSeconds: 90 },
      endurance: { sets: 3, repsMin: 15, repsMax: 20, restSeconds: 45 },
      general: { sets: 3, repsMin: 8, repsMax: 12, restSeconds: 70 },
    },
    ADVANCED: {
      lose: { sets: 4, repsMin: 10, repsMax: 15, restSeconds: 55 },
      gain: { sets: 5, repsMin: 5, repsMax: 8, restSeconds: 100 },
      endurance: { sets: 4, repsMin: 12, repsMax: 20, restSeconds: 40 },
      general: { sets: 4, repsMin: 6, repsMax: 10, restSeconds: 80 },
    },
  };
  const base = table[level][goal];
  return {
    ...base,
    sets: Math.min(base.sets, VOLUME_CAPS.maxSetsPerExercise),
  };
}

function clampWorkoutsPerWeek(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(VOLUME_CAPS.maxWeeklyWorkoutDays, Math.max(2, Math.round(value)));
}

function normalizeEquipmentCode(code: string): string {
  const normalized = String(code).trim().toUpperCase().replace(/-/g, '_');
  return normalized === 'BAND' ? 'RESISTANCE_BAND' : normalized;
}

function allowedEquipment(codes: string[], place: TrainingPlace = 'HOME'): Set<string> {
  const workoutOnly = codes
    .map(normalizeEquipmentCode)
    .filter((c) => (WORKOUT_EQUIPMENT_CODES as readonly string[]).includes(c));
  const allowed = new Set([...workoutOnly, 'NONE', 'BODYWEIGHT']);
  if (place === 'HOME') {
    return new Set([...allowed].filter((code) => HOME_EQUIPMENT.has(code)));
  }
  return allowed;
}

function exerciseMatchesEquipment(ex: CatalogExercise, allowed: Set<string>): boolean {
  const req = (ex.equipmentCodes ?? []).map(normalizeEquipmentCode);
  if (req.length === 0) return allowed.has('NONE');
  return req.every((c) => allowed.has(c));
}

function difficultyOk(ex: CatalogExercise, level: TrainingLevel): boolean {
  return LEVEL_RANK[ex.difficulty] <= LEVEL_RANK[level];
}

export function filterCatalog(
  catalog: CatalogExercise[],
  input: Pick<WorkoutPlanGenerateInput, 'trainingLevel' | 'equipmentCodes' | 'excludedKeys'> & {
    trainingPlace?: TrainingPlace;
  },
): CatalogExercise[] {
  const excluded = new Set(input.excludedKeys.map((k) => k.trim()).filter(Boolean));
  const allowed = allowedEquipment(input.equipmentCodes, input.trainingPlace);
  return [...catalog]
    .filter((ex) => ex.isActive !== false)
    .filter((ex) => !excluded.has(ex.key))
    .filter((ex) => difficultyOk(ex, input.trainingLevel))
    .filter((ex) => exerciseMatchesEquipment(ex, allowed))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function dayTitleFor(
  isRest: boolean,
  workoutOrdinal: number,
  place: Exclude<TrainingPlace, 'MIXED'> = 'HOME',
): string {
  if (isRest) return 'День восстановления';
  return place === 'GYM'
    ? `Тренировка в зале ${workoutOrdinal}`
    : `Домашняя тренировка ${workoutOrdinal}`;
}

function chooseWorkoutDays(input: WorkoutPlanGenerateInput, count: number): number[] {
  const preferred = [...new Set((input.availableDays ?? [])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
  if (preferred.length < count) return WORKOUT_DAY_SCHEDULE[count] ?? WORKOUT_DAY_SCHEDULE[3]!;

  const chosen: number[] = [];
  for (const day of preferred) {
    if (chosen.length >= count) break;
    if (!chosen.some((picked) => Math.abs(picked - day) === 1)) chosen.push(day);
  }
  for (const day of preferred) {
    if (chosen.length >= count) break;
    if (!chosen.includes(day)) chosen.push(day);
  }
  return chosen.sort((a, b) => a - b);
}

function exerciseCount(duration: PreferredDuration = 'STANDARD'): number {
  return duration === 'SHORT' ? 3 : duration === 'LONG' ? 5 : 4;
}

function pickExercisesForDay(
  pool: CatalogExercise[],
  startOffset: number,
  count: number,
): CatalogExercise[] {
  if (pool.length === 0) return [];
  const byPattern = new Map<MovementPattern, CatalogExercise[]>();
  for (const ex of pool) {
    const list = byPattern.get(ex.movementPattern) ?? [];
    list.push(ex);
    byPattern.set(ex.movementPattern, list);
  }

  const picked: CatalogExercise[] = [];
  const usedKeys = new Set<string>();
  const cursor = startOffset;

  for (const pattern of MOVEMENT_PRIORITY) {
    if (picked.length >= count) break;
    const list = byPattern.get(pattern) ?? [];
    if (!list.length) continue;
    const ex = list[cursor % list.length]!;
    if (usedKeys.has(ex.key)) continue;
    picked.push(ex);
    usedKeys.add(ex.key);
  }

  // Fill remaining from sorted pool for diversity fallback.
  let i = startOffset;
  while (picked.length < count && i < startOffset + pool.length * 2) {
    const ex = pool[i % pool.length]!;
    i += 1;
    if (usedKeys.has(ex.key)) continue;
    picked.push(ex);
    usedKeys.add(ex.key);
  }

  return picked;
}

/**
 * Pure deterministic weekly plan generator (no AI).
 * Throws WORKOUT_SETUP_INCOMPLETE | WORKOUT_CATALOG_INSUFFICIENT.
 */
export function generateWeeklyPlan(
  catalog: CatalogExercise[],
  input: WorkoutPlanGenerateInput,
): WorkoutPlanDetail {
  return generateWeeklyPlanV2(catalog, input);
}

export function generateWeeklyPlanV2(
  catalog: CatalogExercise[],
  input: WorkoutPlanGenerateInput,
): WorkoutPlanDetail {
  if (!input.goalKind?.trim() || !input.trainingLevel || !input.workoutsPerWeek) {
    throw new Error('WORKOUT_SETUP_INCOMPLETE');
  }

  const workoutsPerWeek = clampWorkoutsPerWeek(input.workoutsPerWeek);
  const workoutDays = chooseWorkoutDays(input, workoutsPerWeek);
  const trainingPlace = input.trainingPlace ?? 'HOME';
  const pool = filterCatalog(catalog, {
    ...input,
    trainingPlace: trainingPlace === 'MIXED' ? 'GYM' : trainingPlace,
  });

  if (pool.length < VOLUME_CAPS.minExercisesPerWorkout) {
    throw new Error('WORKOUT_CATALOG_INSUFFICIENT');
  }

  const exercisesPerDay = Math.min(exerciseCount(input.preferredDuration), pool.length);
  const rx = prescriptionFor(input.trainingLevel, input.goalKind);
  const workoutDaySet = new Set(workoutDays);
  const days: WorkoutPlanDayDetail[] = [];
  let workoutOrdinal = 0;

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    if (!workoutDaySet.has(dayIndex)) {
      days.push({
        dayIndex,
        dayTitle: dayTitleFor(true, 0),
        isRestDay: true,
        exercises: [
          {
            exerciseOrder: 0,
            exerciseName: 'rest',
            exerciseKey: 'rest',
            riskLevel: 'low',
            sets: null,
            repsMin: null,
            repsMax: null,
            restSeconds: null,
          },
        ],
      });
      continue;
    }

    workoutOrdinal += 1;
    const dayPlace: Exclude<TrainingPlace, 'MIXED'> =
      trainingPlace === 'MIXED'
        ? workoutOrdinal % 2 === 1 ? 'HOME' : 'GYM'
        : trainingPlace;
    const dayPool =
      dayPlace === 'HOME'
        ? pool.filter((exercise) =>
            exerciseMatchesEquipment(exercise, allowedEquipment(input.equipmentCodes, 'HOME')),
          )
        : pool;
    const picked = pickExercisesForDay(dayPool, (workoutOrdinal - 1) * 2, exercisesPerDay);
    if (picked.length < VOLUME_CAPS.minExercisesPerWorkout) {
      throw new Error('WORKOUT_CATALOG_INSUFFICIENT');
    }

    const exercises: WorkoutPlanDayExercise[] = picked.map((ex, order) => {
      const prescription = buildPlanExercisePrescription({
        revisionRepetitionMode: ex.repetitionMode,
        revisionDefaultSets: ex.defaultSets ?? null,
        defaultDurationSeconds: ex.defaultDurationSeconds,
        sets: rx.sets,
        repsMin: rx.repsMin,
        repsMax: rx.repsMax,
        restSeconds: rx.restSeconds,
      });
      return {
        exerciseOrder: order,
        exerciseName: ex.key,
        exerciseKey: ex.key,
        exerciseId: ex.id ?? null,
        riskLevel: ex.riskLevel,
        sets: prescription.sets,
        repsMin: prescription.repsMin,
        repsMax: prescription.repsMax,
        restSeconds: prescription.restSeconds,
        prescriptionMode: prescription.prescriptionMode,
        durationSecondsPerSet: prescription.durationSecondsPerSet,
      };
    });

    days.push({
      dayIndex,
      dayTitle: dayTitleFor(false, workoutOrdinal, dayPlace),
      isRestDay: false,
      trainingPlace: dayPlace,
      estimatedMinutes: picked.reduce((sum, exercise) => sum + (exercise.estimatedMinutes ?? 5), 0),
      exercises,
    });
  }

  return { days };
}
