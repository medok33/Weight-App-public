/** WORKOUT-ENERGY-01A — domain types for exercise energy metadata + calculator. */

export const WORKOUT_ENERGY_POLICY_VERSION = 'workout-energy-1.0' as const;
export const WORKOUT_ENERGY_TIMING_POLICY_VERSION = 'workout-energy-timing-1.0' as const;

export const EXERCISE_ENERGY_PROFILE_STATUSES = ['DRAFT', 'APPROVED', 'RETIRED'] as const;
export type ExerciseEnergyProfileStatus = (typeof EXERCISE_ENERGY_PROFILE_STATUSES)[number];

export const EXERCISE_ENERGY_CALCULATION_METHODS = ['MET_DURATION'] as const;
export type ExerciseEnergyCalculationMethod = (typeof EXERCISE_ENERGY_CALCULATION_METHODS)[number];

export const EXERCISE_ENERGY_TIMING_PROFILE_STATUSES = ['DRAFT', 'APPROVED', 'RETIRED'] as const;
export type ExerciseEnergyTimingProfileStatus =
  (typeof EXERCISE_ENERGY_TIMING_PROFILE_STATUSES)[number];

export const EXERCISE_ENERGY_TIMING_METHODS = ['SECONDS_PER_REP'] as const;
export type ExerciseEnergyTimingMethod = (typeof EXERCISE_ENERGY_TIMING_METHODS)[number];

export const ENERGY_TIMING_SOURCE_TYPES = ['INTERNAL_REVIEWED_POLICY'] as const;
export type EnergyTimingSourceType = (typeof ENERGY_TIMING_SOURCE_TYPES)[number];

export const ENERGY_POPULATION_TYPES = ['ADULT_STANDARD_2024'] as const;
export type EnergyPopulationType = (typeof ENERGY_POPULATION_TYPES)[number];

export const COMPENDIUM_EDITIONS = ['ADULT_2024'] as const;
export type CompendiumEdition = (typeof COMPENDIUM_EDITIONS)[number];

export const ENERGY_SOURCE_TYPES = ['COMPENDIUM_ADULT_2024'] as const;
export type EnergySourceType = (typeof ENERGY_SOURCE_TYPES)[number];

export const ENERGY_WEIGHT_SOURCES = ['PROGRESS_MEASUREMENT', 'PROFILE_FALLBACK'] as const;
export type EnergyWeightSource = (typeof ENERGY_WEIGHT_SOURCES)[number];

export const ENERGY_ESTIMATE_STATUSES = [
  'AVAILABLE',
  'UNAVAILABLE_MISSING_WEIGHT',
  'UNAVAILABLE_MISSING_ENERGY_PROFILE',
  'UNAVAILABLE_UNSUPPORTED_POPULATION',
  'UNAVAILABLE_MISSING_ACTIVE_DURATION',
  'INVALID_ENERGY_PROFILE',
  'INVALID_CALCULATION_INPUT',
  'UNSUPPORTED_CALCULATION_METHOD',
  'INVALID_PLAN_PRESCRIPTION',
  'AMBIGUOUS_TIMING_PROFILE',
] as const;
export type EnergyEstimateStatus = (typeof ENERGY_ESTIMATE_STATUSES)[number];

/** Domain bounds aligned with profile/progress weight validation. */
export const ENERGY_WEIGHT_KG_MIN = 35;
export const ENERGY_WEIGHT_KG_MAX = 250;
export const ENERGY_MET_MIN = 0.000_001;
export const ENERGY_MET_MAX = 30;
export const ENERGY_ACTIVE_SECONDS_MIN = 1;
export const ENERGY_ACTIVE_SECONDS_MAX = 3 * 60 * 60;
export const ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE = 0;
export const ENERGY_SECONDS_PER_REP_MAX = 60;
/** Sanity cap per exercise estimate (gross). */
export const ENERGY_GROSS_KCAL_SANITY_CAP = 500;
export const ENERGY_INTERNAL_DECIMAL_PLACES = 4;

export type ExerciseEnergyProfileRecord = {
  id: string;
  exerciseRevisionId: string;
  status: ExerciseEnergyProfileStatus;
  calculationMethod: ExerciseEnergyCalculationMethod;
  populationType: EnergyPopulationType;
  compendiumEdition: CompendiumEdition;
  compendiumCode: string;
  metValue: number;
  sourceType: EnergySourceType;
  sourceReference: string;
  sourceVersion: string;
  policyVersion: string;
  enabledForCalculation: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  approvedAt: string | null;
  retiredAt: string | null;
  retirementReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExerciseEnergyProfileDraftInput = {
  exerciseRevisionId: string;
  calculationMethod: ExerciseEnergyCalculationMethod;
  populationType: EnergyPopulationType;
  compendiumEdition: CompendiumEdition;
  compendiumCode: string;
  metValue: number;
  sourceType: EnergySourceType;
  sourceReference: string;
  sourceVersion: string;
  policyVersion?: string;
};

export type ExerciseEnergyTimingProfileRecord = {
  id: string;
  exerciseRevisionId: string;
  status: ExerciseEnergyTimingProfileStatus;
  timingMethod: ExerciseEnergyTimingMethod;
  secondsPerRep: number;
  sourceType: EnergyTimingSourceType;
  sourceReference: string;
  sourceVersion: string;
  policyVersion: string;
  enabledForCalculation: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  approvedAt: string | null;
  retiredAt: string | null;
  retirementReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExerciseEnergyTimingProfileDraftInput = {
  exerciseRevisionId: string;
  timingMethod: ExerciseEnergyTimingMethod;
  secondsPerRep: number;
  sourceType: EnergyTimingSourceType;
  sourceReference: string;
  sourceVersion: string;
  policyVersion?: string;
};

export type EnergyCalculatorInput = {
  weightKg: number;
  activeSeconds: number;
  metValue: number;
  calculationMethod: ExerciseEnergyCalculationMethod;
  populationType: EnergyPopulationType;
  sourceVersion: string;
  policyVersion: string;
};

export type EnergyEstimateAvailable = {
  status: 'AVAILABLE';
  grossEstimatedKcalPrecise: number;
  restingEstimatedKcalPrecise: number;
  incrementalEstimatedKcalPrecise: number;
  activeSecondsUsed: number;
  weightKgUsed: number;
  metValueUsed: number;
  calculationMethod: ExerciseEnergyCalculationMethod;
  populationType: EnergyPopulationType;
  sourceVersion: string;
  policyVersion: string;
};

export type EnergyEstimateUnavailable = {
  status: Exclude<EnergyEstimateStatus, 'AVAILABLE'>;
  grossEstimatedKcalPrecise: null;
  restingEstimatedKcalPrecise: null;
  incrementalEstimatedKcalPrecise: null;
  activeSecondsUsed: number | null;
  weightKgUsed: number | null;
  metValueUsed: number | null;
  calculationMethod: ExerciseEnergyCalculationMethod | null;
  populationType: EnergyPopulationType | null;
  sourceVersion: string | null;
  policyVersion: string | null;
};

export type EnergyEstimateResult = EnergyEstimateAvailable | EnergyEstimateUnavailable;

export type ResolveWeightResult =
  | {
      status: 'AVAILABLE';
      weightKg: number;
      source: EnergyWeightSource;
      sourceRecordedAt: string | null;
      asOf: string;
    }
  | {
      status: 'UNAVAILABLE_MISSING_WEIGHT';
      weightKg: null;
      source: null;
      sourceRecordedAt: null;
      asOf: string;
    };

export type SessionEnergySnapshotFields = {
  energyEstimateStatus: EnergyEstimateStatus;
  plannedGrossEstimatedKcal: number | null;
  plannedRestingEstimatedKcal: number | null;
  plannedIncrementalEstimatedKcal: number | null;
  energyWeightKgUsed: number | null;
  energyWeightSource: EnergyWeightSource | null;
  energyWeightSourceRecordedAt: string | null;
  energyActiveSecondsUsed: number | null;
  exerciseEnergyProfileId: string | null;
  exerciseEnergyTimingProfileId: string | null;
  energyCalculationMethod: ExerciseEnergyCalculationMethod | null;
  energyPopulationType: EnergyPopulationType | null;
  energyPolicyVersion: string | null;
  energySourceVersion: string | null;
  energyCalculatedAt: Date;
};
