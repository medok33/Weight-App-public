import { describe, expect, it } from 'vitest';
import {
  ALGORITHM_VERSION,
  filterCatalog,
  generateWeeklyPlan,
  prescriptionFor,
} from '../domain/workout-plan-generator';
import type { CatalogExercise } from '../domain/workout-engine.types';

const CATALOG: CatalogExercise[] = [
  { key: 'band_pull_apart', name: 'band_pull_apart', riskLevel: 'low', movementPattern: 'pull', difficulty: 'BEGINNER', equipmentCodes: ['BAND'] },
  { key: 'band_row', name: 'band_row', riskLevel: 'low', movementPattern: 'pull', difficulty: 'BEGINNER', equipmentCodes: ['BAND'] },
  { key: 'bodyweight_squats', name: 'bodyweight_squats', riskLevel: 'low', movementPattern: 'squat', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
  { key: 'core_plank', name: 'core_plank', riskLevel: 'low', movementPattern: 'core', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
  { key: 'dead_bug', name: 'dead_bug', riskLevel: 'low', movementPattern: 'core', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
  { key: 'dumbbell_row', name: 'dumbbell_row', riskLevel: 'medium', movementPattern: 'pull', difficulty: 'INTERMEDIATE', equipmentCodes: ['DUMBBELL'] },
  { key: 'glute_bridge', name: 'glute_bridge', riskLevel: 'low', movementPattern: 'hinge', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
  { key: 'goblet_squat', name: 'goblet_squat', riskLevel: 'medium', movementPattern: 'squat', difficulty: 'INTERMEDIATE', equipmentCodes: ['DUMBBELL'] },
  { key: 'light_jog', name: 'light_jog', riskLevel: 'medium', movementPattern: 'cardio', difficulty: 'INTERMEDIATE', equipmentCodes: ['NONE'] },
  { key: 'mobility_flow', name: 'mobility_flow', riskLevel: 'low', movementPattern: 'mobility', difficulty: 'BEGINNER', equipmentCodes: ['NONE'] },
  { key: 'morning_walk', name: 'morning_walk', riskLevel: 'low', movementPattern: 'cardio', difficulty: 'BEGINNER', equipmentCodes: ['NONE'] },
  { key: 'push_ups', name: 'push_ups', riskLevel: 'low', movementPattern: 'push', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
  { key: 'recovery_walk', name: 'recovery_walk', riskLevel: 'low', movementPattern: 'cardio', difficulty: 'BEGINNER', equipmentCodes: ['NONE'] },
  { key: 'stretching', name: 'stretching', riskLevel: 'low', movementPattern: 'mobility', difficulty: 'BEGINNER', equipmentCodes: ['NONE'] },
  { key: 'machine_leg_press', name: 'machine_leg_press', riskLevel: 'medium', movementPattern: 'squat', difficulty: 'BEGINNER', equipmentCodes: ['GYM_MACHINES'] },
  { key: 'cable_row', name: 'cable_row', riskLevel: 'medium', movementPattern: 'pull', difficulty: 'BEGINNER', equipmentCodes: ['GYM_MACHINES'] },
  { key: 'treadmill_walk', name: 'treadmill_walk', riskLevel: 'low', movementPattern: 'cardio', difficulty: 'BEGINNER', equipmentCodes: ['CARDIO_MACHINE'] },
];

function baseInput(overrides: Partial<Parameters<typeof generateWeeklyPlan>[1]> = {}) {
  return {
    goalKind: 'lose_weight',
    trainingLevel: 'BEGINNER' as const,
    workoutsPerWeek: 3,
    equipmentCodes: [] as string[],
    excludedKeys: [] as string[],
    ...overrides,
  };
}

describe('workout plan generator', () => {
  it('algorithm version is workout-catalog-01b.1', () => {
    expect(ALGORITHM_VERSION).toBe('workout-catalog-01b.1');
  });

  it('beginner lose_weight plan uses lower volume prescription', () => {
    const rx = prescriptionFor('BEGINNER', 'lose_weight');
    expect(rx.sets).toBe(2);
    expect(rx.repsMin >= 12).toBeTruthy();
  });

  it('intermediate gain uses higher sets', () => {
    const rx = prescriptionFor('INTERMEDIATE', 'gain_muscle');
    expect(rx.sets).toBe(4);
  });

  it('schedules 2 workout days', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 2 }));
    const workouts = plan.days.filter((d) => !d.isRestDay);
    expect(workouts.length).toBe(2);
    expect(plan.days.length).toBe(7);
  });

  it('schedules 3 workout days', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 3 }));
    expect(plan.days.filter((d) => !d.isRestDay).length).toBe(3);
  });

  it('schedules 4 workout days', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 4 }));
    expect(plan.days.filter((d) => !d.isRestDay).length).toBe(4);
  });

  it('schedules 5 workout days', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 5 }));
    expect(plan.days.filter((d) => !d.isRestDay).length).toBe(5);
  });

  it('each workout day has 3-5 diverse exercises', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 3 }));
    for (const day of plan.days.filter((d) => !d.isRestDay)) {
      expect(day.exercises.length >= 3 && day.exercises.length <= 5).toBeTruthy();
      const patterns = new Set(
        day.exercises.map((ex) => CATALOG.find((c) => c.key === ex.exerciseKey)?.movementPattern),
      );
      expect(patterns.size >= 2).toBeTruthy();
    }
  });

  it('empty equipment filters to NONE/BODYWEIGHT only', () => {
    const filtered = filterCatalog(CATALOG, {
      trainingLevel: 'BEGINNER',
      equipmentCodes: [],
      excludedKeys: [],
    });
    expect(filtered.every((ex) => ex.equipmentCodes.every((c) => c === 'NONE' || c === 'BODYWEIGHT'))).toBeTruthy();
    expect(!filtered.some((ex) => ex.key === 'dumbbell_row')).toBeTruthy();
  });

  it('dumbbell equipment includes dumbbell exercises for intermediate', () => {
    const filtered = filterCatalog(CATALOG, {
      trainingLevel: 'INTERMEDIATE',
      equipmentCodes: ['DUMBBELL'],
      excludedKeys: [],
    });
    expect(filtered.some((ex) => ex.key === 'goblet_squat')).toBeTruthy();
  });

  it('excluded exercise keys are omitted', () => {
    const plan = generateWeeklyPlan(
      CATALOG,
      baseInput({ excludedKeys: ['bodyweight_squats', 'push_ups'] }),
    );
    const keys = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseKey));
    expect(!keys.includes('bodyweight_squats')).toBeTruthy();
    expect(!keys.includes('push_ups')).toBeTruthy();
  });

  it('insufficient catalog throws WORKOUT_CATALOG_INSUFFICIENT', () => {
    expect(() =>
      generateWeeklyPlan(CATALOG.slice(0, 2), baseInput({ equipmentCodes: [], excludedKeys: [] })),
    ).toThrow(/WORKOUT_CATALOG_INSUFFICIENT/);
  });

  it('incomplete setup throws WORKOUT_SETUP_INCOMPLETE', () => {
    expect(() => generateWeeklyPlan(CATALOG, baseInput({ goalKind: '' }))).toThrow(
      /WORKOUT_SETUP_INCOMPLETE/,
    );
  });

  it('generation is reproducible', () => {
    const a = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 4, trainingLevel: 'INTERMEDIATE' }));
    const b = generateWeeklyPlan(CATALOG, baseInput({ workoutsPerWeek: 4, trainingLevel: 'INTERMEDIATE' }));
    expect(a).toEqual(b);
  });

  it('writes coherent REPS and DURATION prescriptions from catalog metadata', () => {
    const catalog = CATALOG.filter((exercise) =>
      ['bodyweight_squats', 'core_plank', 'push_ups'].includes(exercise.key),
    ).map((exercise) => ({
      ...exercise,
      repetitionMode: exercise.key === 'core_plank' ? 'DURATION' as const : 'REPS' as const,
      defaultSets: 1,
      defaultDurationSeconds: exercise.key === 'core_plank' ? 45 : null,
    }));
    const plan = generateWeeklyPlan(catalog, baseInput({ workoutsPerWeek: 2 }));
    const exercises = plan.days.find((day) => !day.isRestDay)!.exercises;
    const duration = exercises.find((exercise) => exercise.exerciseKey === 'core_plank')!;
    const reps = exercises.find((exercise) => exercise.exerciseKey === 'push_ups')!;

    expect(duration).toMatchObject({
      prescriptionMode: 'DURATION',
      sets: 1,
      repsMin: null,
      repsMax: null,
      durationSecondsPerSet: 45,
    });
    expect(reps.prescriptionMode).toBe('REPS');
    expect(reps.durationSecondsPerSet).toBeNull();
    expect(reps.repsMax).toBeGreaterThan(0);
    expect(reps.sets).toBeGreaterThan(1);
  });

  it('fail-closes DURATION revisions with defaultSets != 1', () => {
    const catalog = CATALOG.map((exercise) =>
      exercise.key === 'core_plank'
        ? {
            ...exercise,
            repetitionMode: 'DURATION' as const,
            defaultSets: 3,
            defaultDurationSeconds: 300,
          }
        : exercise,
    );
    expect(() => generateWeeklyPlan(catalog, baseInput({ workoutsPerWeek: 2 }))).toThrow(
      /UNSUPPORTED_DURATION_SET_SEMANTICS/,
    );
  });

  it('preferred available days are used when sufficient', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({ availableDays: [1, 3, 6] }));
    expect(plan.days.filter((day) => !day.isRestDay).map((day) => day.dayIndex)).toEqual([1, 3, 6]);
  });

  it('short home plan has three exercises and no gym equipment', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({
      trainingPlace: 'HOME',
      preferredDuration: 'SHORT',
      equipmentCodes: ['GYM_MACHINES', 'CARDIO_MACHINE'],
    }));
    for (const day of plan.days.filter((item) => !item.isRestDay)) {
      expect(day.exercises.length).toBe(3);
      expect(day.trainingPlace).toBe('HOME');
      expect(day.exercises.every((exercise) => !exercise.exerciseKey?.includes('machine'))).toBeTruthy();
    }
  });

  it('gym plan can use gym equipment', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({
      trainingPlace: 'GYM',
      equipmentCodes: ['GYM_MACHINES', 'CARDIO_MACHINE'],
    }));
    const keys = plan.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseKey));
    expect(keys.includes('machine_leg_press') || keys.includes('cable_row')).toBeTruthy();
  });

  it('mixed plan alternates home and gym titles', () => {
    const plan = generateWeeklyPlan(CATALOG, baseInput({
      trainingPlace: 'MIXED',
      equipmentCodes: ['GYM_MACHINES', 'CARDIO_MACHINE'],
    }));
    const workouts = plan.days.filter((day) => !day.isRestDay);
    expect(workouts[0]?.trainingPlace).toBe('HOME');
    expect(workouts[1]?.trainingPlace).toBe('GYM');
    expect(workouts[0]?.dayTitle ?? '').toMatch(/Домашняя/);
    expect(workouts[1]?.dayTitle ?? '').toMatch(/зале/);
  });
});
