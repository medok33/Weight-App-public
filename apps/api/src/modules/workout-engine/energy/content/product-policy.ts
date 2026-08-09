/**
 * WORKOUT-ENERGY-CONTENT-01A — approved product policy (versioned, deterministic).
 * Do not re-negotiate these decisions in later packages without explicit product change.
 */

export const WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY = {
  policyVersion: 'workout-energy-content-1.0',
  coverageRequirement: 'FULL_GENERATOR_VISIBLE',
  requiredCoveragePercent: 100,
  unavailableExerciseCopy: 'Расход пока не рассчитан',
  sessionTotalPolicy: 'NO_SESSION_TOTAL_UNTIL_FULL_COVERAGE',
  repsTimingPolicy: 'MOVEMENT_SPECIFIC_REVIEWED_ONLY',
  universalTimingAllowed: false,
  familyFallbackAllowed: false,
  nameFallbackAllowed: false,
  estimatedDurationFallbackAllowed: false,
  partialCoverageAllowed: false,
  wallAngelsTargetMode: 'REPS',
  wallAngelsExerciseKey: 'wall_angels',
  externalTimingDatasetRequiredForV1: false,
  timingInternalReviewedPolicyAllowed: true,
  catalogReleaseKey: 'workout-catalog-canonical-01b',
  coverageUnit: 'PUBLISHED_RELEASE_PIN',
  familyCountIsNotCoverageUnit: true,
  adaptationReplacementIncludedInCoverage: true,
  repositoryContentIsNotRuntimeApplied: true,
} as const;

export type WorkoutEnergyContentProductPolicy = typeof WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY;
