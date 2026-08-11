import { describe, expect, it } from 'vitest';
import { selectHomeShortReplacementForPilot } from '../domain/workout-generator-pilot-contract';
import type { CatalogExercise, WorkoutPlanGenerateInput } from '../domain/workout-engine.types';

const release = { id: 'release-01b', code: 'published-01b', manifestVersion: 'workout-catalog-manifest-01b.1' };
const input: WorkoutPlanGenerateInput = {
  goalKind: 'general', trainingLevel: 'BEGINNER', trainingPlace: 'HOME', workoutsPerWeek: 3,
  equipmentCodes: ['NONE', 'BODYWEIGHT'], excludedKeys: [],
};

function exercise(key: string, mode: CatalogExercise['repetitionMode'] = 'REPS'): CatalogExercise {
  return {
    id: `id-${key}`, exerciseRevisionId: `revision-${key}`, key, name: key,
    riskLevel: 'low', movementPattern: 'core', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'],
    repetitionMode: mode,
    defaultSets: mode === 'DURATION' ? 1 : 2,
    defaultDurationSeconds: mode === 'DURATION' ? 300 : null,
  };
}

const catalog = ['ankle_rocks', 'bird_dog', 'bodyweight_hip_thrust', 'cat_cow_flow', 'dead_bug']
  .map((key) => exercise(key, key === 'ankle_rocks' ? 'DURATION' : 'REPS'));

describe('HOME_SHORT replacement integrity', () => {
  it('excludes one original key that would otherwise be the top candidate', () => {
    const result = selectHomeShortReplacementForPilot(catalog, input, release, {
      sourceWorkoutPlanId: 'plan-1', sourcePlanVersion: 1, originalExerciseKeys: ['ankle_rocks'],
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') throw new Error('expected replacement');
    expect(result.exercises.map((item) => item.key)).not.toContain('ankle_rocks');
  });

  it('excludes multiple originals before bounded deterministic selection', () => {
    const context = { sourceWorkoutPlanId: 'plan-2', sourcePlanVersion: 1, originalExerciseKeys: ['ankle_rocks', 'bird_dog'] };
    const first = selectHomeShortReplacementForPilot(catalog, input, release, context);
    const second = selectHomeShortReplacementForPilot(catalog, input, release, context);
    expect(first).toEqual(second);
    expect(first.status).toBe('SUCCESS');
    if (first.status !== 'SUCCESS') throw new Error('expected replacement');
    expect(first.exercises.map((item) => item.key)).toEqual(['bodyweight_hip_thrust', 'cat_cow_flow', 'dead_bug']);
  });

  it('fails closed when all otherwise viable candidates are originals', () => {
    const result = selectHomeShortReplacementForPilot(catalog.slice(0, 3), input, release, {
      sourceWorkoutPlanId: 'plan-3', sourcePlanVersion: 1,
      originalExerciseKeys: ['ankle_rocks', 'bird_dog', 'bodyweight_hip_thrust'],
    });
    expect(result.status).toBe('NO_VIABLE_CANDIDATE');
    expect(result.trace.reasonCodes).toEqual(['NO_ELIGIBLE_EXERCISES']);
  });
});
