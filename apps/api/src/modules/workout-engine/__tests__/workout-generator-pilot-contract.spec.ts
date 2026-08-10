import { describe, expect, it } from 'vitest';
import {
  GENERATOR_CONTRACT_VERSION,
  generateWeeklyPlanForPilot,
  selectHomeShortReplacementForPilot,
} from '../domain/workout-generator-pilot-contract';
import type { CatalogExercise, WorkoutPlanGenerateInput } from '../domain/workout-engine.types';

const release = {
  id: 'published-84-pin-release',
  code: 'workout-catalog-01b-published',
  manifestVersion: 'workout-catalog-manifest-01b.1',
};

const catalog: CatalogExercise[] = [
  ['squat', 'squat', 'BODYWEIGHT'],
  ['hinge', 'hinge', 'BODYWEIGHT'],
  ['push', 'push', 'BODYWEIGHT'],
  ['pull', 'pull', 'RESISTANCE_BAND'],
  ['core', 'core', 'BODYWEIGHT'],
  ['cardio', 'cardio', 'NONE'],
  ['machine_press', 'push', 'GYM_MACHINES', 'INTERMEDIATE'],
].map(([key, movementPattern, equipment, difficulty = 'BEGINNER']) => ({
  id: `exercise-${key}`,
  exerciseRevisionId: `revision-${key}`,
  key: String(key),
  name: String(key),
  riskLevel: 'low' as const,
  movementPattern: movementPattern as CatalogExercise['movementPattern'],
  difficulty: difficulty as CatalogExercise['difficulty'],
  equipmentCodes: [String(equipment)],
}));

const base: WorkoutPlanGenerateInput = {
  goalKind: 'general',
  trainingLevel: 'BEGINNER',
  trainingPlace: 'HOME',
  workoutsPerWeek: 3,
  preferredDuration: 'SHORT',
  availableDays: [0, 2, 4],
  equipmentCodes: ['BODYWEIGHT', 'RESISTANCE_BAND'],
  excludedKeys: [],
};

function success(input: WorkoutPlanGenerateInput = base) {
  const result = generateWeeklyPlanForPilot(catalog, input, release);
  expect(result.status).toBe('SUCCESS');
  if (result.status !== 'SUCCESS') throw new Error('expected successful fixture');
  return result;
}

describe('WORKOUT-01A generator pilot golden contract', () => {
  it('HOME basic: selects only compatible stable published refs with bounded evidence', () => {
    const result = success();
    expect(result.trace.catalogRelease.id).toBe(release.id);
    expect(result.trace.selectedExercises.every((item) => item.exerciseId?.startsWith('exercise-'))).toBe(true);
    expect(result.trace.selectedExercises.every((item) => item.evidence.includes('EQUIPMENT_COMPATIBLE'))).toBe(true);
    expect(result.trace.selectedExercises.map((item) => item.exerciseKey)).not.toContain('machine_press');
  });

  it('GYM standard: permits gym capability only with the requested equipment', () => {
    const result = success({ ...base, trainingPlace: 'GYM', trainingLevel: 'INTERMEDIATE', equipmentCodes: ['GYM_MACHINES'] });
    expect(result.trace.appliedHardConstraints.trainingPlace).toBe('GYM');
    expect(result.trace.filterSummary.eligible).toBeGreaterThanOrEqual(3);
  });

  it('travel/minimal equipment remains valid through the existing bodyweight capability', () => {
    const result = generateWeeklyPlanForPilot(catalog, { ...base, equipmentCodes: ['NONE'], preferredDuration: 'SHORT' }, release);
    expect(result.status).toBe('SUCCESS');
    expect(result.trace.appliedHardConstraints.equipmentCodes).toEqual(['NONE']);
  });

  it('hard and duplicate exclusions are normalized and win over selection', () => {
    const result = success({ ...base, excludedKeys: ['push', 'push', 'machine_press'] });
    expect(result.trace.appliedHardConstraints.excludedKeys).toEqual(['machine_press', 'push']);
    expect(result.trace.selectedExercises.map((item) => item.exerciseKey)).not.toContain('push');
    expect(result.trace.filterSummary.hardExcluded).toBe(2);
  });

  it('equipment mismatch and whole-workout impossible inputs fail closed with machine-readable evidence', () => {
    const result = generateWeeklyPlanForPilot(catalog, {
      ...base,
      equipmentCodes: ['NONE'],
      excludedKeys: ['squat', 'hinge', 'push', 'pull', 'core', 'cardio'],
    }, release);
    expect(result.status).toBe('NO_VIABLE_CANDIDATE');
    expect(result.plan).toBeNull();
    expect(result.trace.reasonCodes).toEqual(['NO_ELIGIBLE_EXERCISES']);
    expect(result.trace.filterSummary.eligible).toBe(0);
  });

  it('level eligibility rejects a gym variant for beginners', () => {
    const result = success({ ...base, trainingPlace: 'GYM', equipmentCodes: ['GYM_MACHINES', 'BODYWEIGHT'] });
    expect(result.trace.selectedExercises.map((item) => item.exerciseKey)).not.toContain('machine_press');
    expect(result.trace.filterSummary.levelIncompatible).toBeGreaterThanOrEqual(1);
  });

  it('same effective input has the same decision-relevant output and trace', () => {
    const first = success({ ...base, excludedKeys: ['push', 'hinge'] });
    const second = success({ ...base, excludedKeys: ['hinge', 'push', 'push'] });
    expect(first.plan).toEqual(second.plan);
    expect(first.trace).toEqual(second.trace);
    expect(first.trace.generatorContractVersion).toBe(GENERATOR_CONTRACT_VERSION);
  });

  it('published-pin guard: an additional unpublished catalog record cannot leak when omitted from the release input', () => {
    const published = catalog.filter((item) => item.key !== 'machine_press');
    const result = generateWeeklyPlanForPilot(published, { ...base, trainingPlace: 'GYM', equipmentCodes: ['GYM_MACHINES', 'BODYWEIGHT'] }, release);
    expect(result.status).toBe('SUCCESS');
    expect(result.trace.selectedExercises.map((item) => item.exerciseKey)).not.toContain('machine_press');
  });

  it('incomplete setup has an explicit typed outcome instead of an exception-only contract', () => {
    const result = generateWeeklyPlanForPilot(catalog, { ...base, goalKind: '' }, release);
    expect(result.status).toBe('INSUFFICIENT_INPUT');
    expect(result.trace.reasonCodes).toEqual(['WORKOUT_SETUP_INCOMPLETE']);
  });

  it('replacement golden: HOME_SHORT selection is pinned, traceable, and deterministic', () => {
    const replacement = { sourceWorkoutPlanId: 'plan-7', sourcePlanVersion: 7, originalExerciseKeys: ['push'] };
    const first = selectHomeShortReplacementForPilot(catalog, base, release, replacement);
    const second = selectHomeShortReplacementForPilot(catalog, { ...base, excludedKeys: [] }, release, replacement);
    expect(first.status).toBe('SUCCESS');
    expect(second).toEqual(first);
    if (first.status !== 'SUCCESS') throw new Error('expected viable replacement');
    expect(first.trace.requestKind).toBe('HOME_SHORT_REPLACEMENT');
    expect(first.trace.replacement).toEqual(replacement);
    expect(first.trace.selectedExercises).toHaveLength(3);
    expect(first.trace.selectedExercises.map((item) => item.exerciseKey)).not.toContain('machine_press');
  });

  it('replacement no-viable golden: constraints remain fail-closed with source evidence', () => {
    const result = selectHomeShortReplacementForPilot(catalog, {
      ...base, excludedKeys: ['squat', 'hinge', 'push', 'pull', 'core', 'cardio'],
    }, release, { sourceWorkoutPlanId: 'plan-8', sourcePlanVersion: 8, originalExerciseKeys: ['push'] });
    expect(result.status).toBe('NO_VIABLE_CANDIDATE');
    expect(result.exercises).toEqual([]);
    expect(result.trace.replacement?.originalExerciseKeys).toEqual(['push']);
    expect(result.trace.reasonCodes).toEqual(['NO_ELIGIBLE_EXERCISES']);
  });
});
