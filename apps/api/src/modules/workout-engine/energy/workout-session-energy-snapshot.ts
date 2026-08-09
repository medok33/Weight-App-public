import {
  deriveActiveSecondsFromTargets,
  type PlannedSetTarget,
} from './workout-energy-active-seconds';
import type { PrescriptionMode } from './workout-plan-prescription';
import type {
  EnergyCalculatorInput,
  EnergyEstimateResult,
  EnergyEstimateStatus,
  ExerciseEnergyProfileRecord,
  ExerciseEnergyTimingProfileRecord,
  ResolveWeightResult,
  SessionEnergySnapshotFields,
} from './workout-energy.types';

export type AmbiguousEnergyProfileSignal = { status: 'INVALID_ENERGY_PROFILE' };
export type AmbiguousTimingProfileSignal = { status: 'AMBIGUOUS_TIMING_PROFILE' };

type EstimateExerciseEnergy = (input: EnergyCalculatorInput) => EnergyEstimateResult;

function unavailableSnapshot(
  status: Exclude<EnergyEstimateStatus, 'AVAILABLE'>,
  sessionStartedAt: Date,
  partial: Partial<SessionEnergySnapshotFields> = {},
): SessionEnergySnapshotFields {
  return {
    energyEstimateStatus: status,
    plannedGrossEstimatedKcal: null,
    plannedRestingEstimatedKcal: null,
    plannedIncrementalEstimatedKcal: null,
    energyWeightKgUsed: null,
    energyWeightSource: null,
    energyWeightSourceRecordedAt: null,
    energyActiveSecondsUsed: null,
    exerciseEnergyProfileId: null,
    exerciseEnergyTimingProfileId: null,
    energyCalculationMethod: null,
    energyPopulationType: null,
    energyPolicyVersion: null,
    energySourceVersion: null,
    energyCalculatedAt: sessionStartedAt,
    ...partial,
  };
}

function isApprovedEnergyProfile(
  profile: ExerciseEnergyProfileRecord | AmbiguousEnergyProfileSignal | null,
): profile is ExerciseEnergyProfileRecord {
  return profile != null && profile.status === 'APPROVED' && profile.enabledForCalculation === true;
}

function isApprovedTimingProfile(
  profile: ExerciseEnergyTimingProfileRecord | AmbiguousTimingProfileSignal | null,
): profile is ExerciseEnergyTimingProfileRecord {
  return (
    profile != null &&
    profile.status === 'APPROVED' &&
    profile.enabledForCalculation === true &&
    profile.timingMethod === 'SECONDS_PER_REP'
  );
}

export function buildPlannedExerciseEnergySnapshot(input: {
  prescriptionMode: PrescriptionMode | null;
  setTargets: PlannedSetTarget[];
  weightResult: ResolveWeightResult;
  energyProfile: ExerciseEnergyProfileRecord | AmbiguousEnergyProfileSignal | null;
  timingProfile: ExerciseEnergyTimingProfileRecord | AmbiguousTimingProfileSignal | null;
  sessionStartedAt: Date;
  estimateExerciseEnergy: EstimateExerciseEnergy;
}): SessionEnergySnapshotFields {
  const weightFields =
    input.weightResult.status === 'AVAILABLE'
      ? {
          energyWeightKgUsed: input.weightResult.weightKg,
          energyWeightSource: input.weightResult.source,
          energyWeightSourceRecordedAt: input.weightResult.sourceRecordedAt,
        }
      : {};
  const energyProfileFields = isApprovedEnergyProfile(input.energyProfile)
    ? {
        exerciseEnergyProfileId: input.energyProfile.id,
        energyCalculationMethod: input.energyProfile.calculationMethod,
        energyPopulationType: input.energyProfile.populationType,
        energyPolicyVersion: input.energyProfile.policyVersion,
        energySourceVersion: input.energyProfile.sourceVersion,
      }
    : {};

  if (
    input.prescriptionMode === 'REPS' &&
    input.timingProfile?.status === 'AMBIGUOUS_TIMING_PROFILE'
  ) {
    return unavailableSnapshot('AMBIGUOUS_TIMING_PROFILE', input.sessionStartedAt, {
      ...weightFields,
      ...energyProfileFields,
    });
  }

  const timingProfile =
    input.prescriptionMode === 'REPS' && isApprovedTimingProfile(input.timingProfile)
      ? input.timingProfile
      : null;
  const activeSeconds = deriveActiveSecondsFromTargets({
    prescriptionMode: input.prescriptionMode,
    setTargets: input.setTargets,
    secondsPerRep: timingProfile?.secondsPerRep,
  });
  if (activeSeconds.status !== 'AVAILABLE') {
    return unavailableSnapshot(activeSeconds.status, input.sessionStartedAt, {
      ...weightFields,
      ...energyProfileFields,
      exerciseEnergyTimingProfileId: timingProfile?.id ?? null,
    });
  }

  const provenance = {
    ...weightFields,
    ...energyProfileFields,
    energyActiveSecondsUsed: activeSeconds.activeSeconds,
    exerciseEnergyTimingProfileId: timingProfile?.id ?? null,
  };

  if (input.weightResult.status !== 'AVAILABLE') {
    return unavailableSnapshot('UNAVAILABLE_MISSING_WEIGHT', input.sessionStartedAt, provenance);
  }
  if (input.energyProfile?.status === 'INVALID_ENERGY_PROFILE') {
    return unavailableSnapshot('INVALID_ENERGY_PROFILE', input.sessionStartedAt, provenance);
  }
  if (!isApprovedEnergyProfile(input.energyProfile)) {
    return unavailableSnapshot(
      'UNAVAILABLE_MISSING_ENERGY_PROFILE',
      input.sessionStartedAt,
      provenance,
    );
  }

  const estimate = input.estimateExerciseEnergy({
    weightKg: input.weightResult.weightKg,
    activeSeconds: activeSeconds.activeSeconds,
    metValue: input.energyProfile.metValue,
    calculationMethod: input.energyProfile.calculationMethod,
    populationType: input.energyProfile.populationType,
    sourceVersion: input.energyProfile.sourceVersion,
    policyVersion: input.energyProfile.policyVersion,
  });

  if (estimate.status !== 'AVAILABLE') {
    return unavailableSnapshot(estimate.status, input.sessionStartedAt, {
      ...provenance,
      energyActiveSecondsUsed: estimate.activeSecondsUsed ?? activeSeconds.activeSeconds,
    });
  }

  return {
    energyEstimateStatus: 'AVAILABLE',
    plannedGrossEstimatedKcal: estimate.grossEstimatedKcalPrecise,
    plannedRestingEstimatedKcal: estimate.restingEstimatedKcalPrecise,
    plannedIncrementalEstimatedKcal: estimate.incrementalEstimatedKcalPrecise,
    energyWeightKgUsed: estimate.weightKgUsed,
    energyWeightSource: input.weightResult.source,
    energyWeightSourceRecordedAt: input.weightResult.sourceRecordedAt,
    energyActiveSecondsUsed: estimate.activeSecondsUsed,
    exerciseEnergyProfileId: input.energyProfile.id,
    exerciseEnergyTimingProfileId: timingProfile?.id ?? null,
    energyCalculationMethod: estimate.calculationMethod,
    energyPopulationType: estimate.populationType,
    energyPolicyVersion: estimate.policyVersion,
    energySourceVersion: estimate.sourceVersion,
    energyCalculatedAt: input.sessionStartedAt,
  };
}
