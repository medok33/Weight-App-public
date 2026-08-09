import { describe, expect, it } from 'vitest';
import { estimateExerciseEnergy } from '../workout-energy.calculator';
import { buildPlannedExerciseEnergySnapshot } from '../workout-session-energy-snapshot';
import type {
  ExerciseEnergyProfileRecord,
  ExerciseEnergyTimingProfileRecord,
  ResolveWeightResult,
} from '../workout-energy.types';

const startedAt = new Date('2026-08-05T12:00:00.000Z');
const weight: ResolveWeightResult = {
  status: 'AVAILABLE',
  weightKg: 80,
  source: 'PROGRESS_MEASUREMENT',
  sourceRecordedAt: '2026-08-04T08:00:00.000Z',
  asOf: startedAt.toISOString(),
};

const energyProfile: ExerciseEnergyProfileRecord = {
  id: 'energy-1',
  exerciseRevisionId: 'rev-1',
  status: 'APPROVED',
  calculationMethod: 'MET_DURATION',
  populationType: 'ADULT_STANDARD_2024',
  compendiumEdition: 'ADULT_2024',
  compendiumCode: '02022',
  metValue: 3.8,
  sourceType: 'COMPENDIUM_ADULT_2024',
  sourceReference: 'ref',
  sourceVersion: 'compendium-adult-2024.1',
  policyVersion: 'workout-energy-1.0',
  enabledForCalculation: true,
  reviewedAt: startedAt.toISOString(),
  reviewedBy: 'reviewer',
  approvedAt: startedAt.toISOString(),
  retiredAt: null,
  retirementReason: null,
  createdAt: startedAt.toISOString(),
  updatedAt: startedAt.toISOString(),
};

const timingProfile: ExerciseEnergyTimingProfileRecord = {
  id: 'timing-1',
  exerciseRevisionId: 'rev-1',
  status: 'APPROVED',
  timingMethod: 'SECONDS_PER_REP',
  secondsPerRep: 2.5,
  sourceType: 'INTERNAL_REVIEWED_POLICY',
  sourceReference: 'Internal reviewed cadence',
  sourceVersion: 'cadence-1',
  policyVersion: 'workout-energy-timing-1.0',
  enabledForCalculation: true,
  reviewedAt: startedAt.toISOString(),
  reviewedBy: 'reviewer',
  approvedAt: startedAt.toISOString(),
  retiredAt: null,
  retirementReason: null,
  createdAt: startedAt.toISOString(),
  updatedAt: startedAt.toISOString(),
};

describe('WORKOUT-ENERGY-01B planned session energy snapshot', () => {
  it('freezes precise duration-based estimate and provenance at session start', () => {
    const result = buildPlannedExerciseEnergySnapshot({
      prescriptionMode: 'DURATION',
      setTargets: [
        { targetReps: null, targetDurationSeconds: 45 },
        { targetReps: null, targetDurationSeconds: 45 },
      ],
      weightResult: weight,
      energyProfile,
      timingProfile: null,
      sessionStartedAt: startedAt,
      estimateExerciseEnergy,
    });

    expect(result).toMatchObject({
      energyEstimateStatus: 'AVAILABLE',
      plannedGrossEstimatedKcal: 7.6,
      plannedRestingEstimatedKcal: 2,
      plannedIncrementalEstimatedKcal: 5.6,
      energyWeightKgUsed: 80,
      energyActiveSecondsUsed: 90,
      exerciseEnergyProfileId: 'energy-1',
      exerciseEnergyTimingProfileId: null,
      energyCalculatedAt: startedAt,
    });
  });

  it('uses approved timing for reps and supports fractional derived seconds', () => {
    const result = buildPlannedExerciseEnergySnapshot({
      prescriptionMode: 'REPS',
      setTargets: [
        { targetReps: 11, targetDurationSeconds: null },
        { targetReps: 12, targetDurationSeconds: null },
      ],
      weightResult: weight,
      energyProfile,
      timingProfile,
      sessionStartedAt: startedAt,
      estimateExerciseEnergy,
    });
    expect(result.energyEstimateStatus).toBe('AVAILABLE');
    expect(result.energyActiveSecondsUsed).toBe(57.5);
    expect(result.exerciseEnergyTimingProfileId).toBe('timing-1');
  });

  it('stores unavailable as null kcal, never successful zero', () => {
    const missingWeight: ResolveWeightResult = {
      status: 'UNAVAILABLE_MISSING_WEIGHT',
      weightKg: null,
      source: null,
      sourceRecordedAt: null,
      asOf: startedAt.toISOString(),
    };
    const result = buildPlannedExerciseEnergySnapshot({
      prescriptionMode: 'DURATION',
      setTargets: [{ targetReps: null, targetDurationSeconds: 60 }],
      weightResult: missingWeight,
      energyProfile,
      timingProfile: null,
      sessionStartedAt: startedAt,
      estimateExerciseEnergy,
    });
    expect(result.energyEstimateStatus).toBe('UNAVAILABLE_MISSING_WEIGHT');
    expect(result.plannedGrossEstimatedKcal).toBeNull();
    expect(result.plannedRestingEstimatedKcal).toBeNull();
    expect(result.plannedIncrementalEstimatedKcal).toBeNull();
  });

  it('signals invalid plan and ambiguous timing without calculating', () => {
    const invalid = buildPlannedExerciseEnergySnapshot({
      prescriptionMode: null,
      setTargets: [{ targetReps: 12, targetDurationSeconds: null }],
      weightResult: weight,
      energyProfile,
      timingProfile: null,
      sessionStartedAt: startedAt,
      estimateExerciseEnergy,
    });
    expect(invalid.energyEstimateStatus).toBe('INVALID_PLAN_PRESCRIPTION');

    const ambiguous = buildPlannedExerciseEnergySnapshot({
      prescriptionMode: 'REPS',
      setTargets: [{ targetReps: 12, targetDurationSeconds: null }],
      weightResult: weight,
      energyProfile,
      timingProfile: { status: 'AMBIGUOUS_TIMING_PROFILE' },
      sessionStartedAt: startedAt,
      estimateExerciseEnergy,
    });
    expect(ambiguous.energyEstimateStatus).toBe('AMBIGUOUS_TIMING_PROFILE');
    expect(ambiguous.plannedGrossEstimatedKcal).toBeNull();
  });
});
