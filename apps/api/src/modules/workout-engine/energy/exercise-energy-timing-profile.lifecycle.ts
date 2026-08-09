import {
  ENERGY_SECONDS_PER_REP_MAX,
  ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE,
  ENERGY_TIMING_SOURCE_TYPES,
  EXERCISE_ENERGY_TIMING_METHODS,
  WORKOUT_ENERGY_TIMING_POLICY_VERSION,
  type ExerciseEnergyTimingProfileDraftInput,
  type ExerciseEnergyTimingProfileRecord,
  type ExerciseEnergyTimingProfileStatus,
} from './workout-energy.types';

export function assertDraftTimingMetadata(input: ExerciseEnergyTimingProfileDraftInput): void {
  if (!input.exerciseRevisionId?.trim()) throw new Error('ENERGY_TIMING_PROFILE_REVISION_REQUIRED');
  if (!(EXERCISE_ENERGY_TIMING_METHODS as readonly string[]).includes(input.timingMethod)) {
    throw new Error('ENERGY_TIMING_PROFILE_METHOD_INVALID');
  }
  if (!(ENERGY_TIMING_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) {
    throw new Error('ENERGY_TIMING_PROFILE_SOURCE_TYPE_INVALID');
  }
  if (
    typeof input.secondsPerRep !== 'number' ||
    !Number.isFinite(input.secondsPerRep) ||
    input.secondsPerRep <= ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE ||
    input.secondsPerRep > ENERGY_SECONDS_PER_REP_MAX
  ) {
    throw new Error('ENERGY_TIMING_PROFILE_SECONDS_PER_REP_INVALID');
  }
  if (!String(input.sourceReference ?? '').trim()) {
    throw new Error('ENERGY_TIMING_PROFILE_SOURCE_REFERENCE_REQUIRED');
  }
  if (!String(input.sourceVersion ?? '').trim()) {
    throw new Error('ENERGY_TIMING_PROFILE_SOURCE_VERSION_REQUIRED');
  }
}

export function assertCanApproveTimingProfile(
  profile: ExerciseEnergyTimingProfileRecord,
  reviewedBy: string,
): void {
  if (profile.status !== 'DRAFT') throw new Error('ENERGY_TIMING_PROFILE_NOT_DRAFT');
  assertDraftTimingMetadata({
    exerciseRevisionId: profile.exerciseRevisionId,
    timingMethod: profile.timingMethod,
    secondsPerRep: profile.secondsPerRep,
    sourceType: profile.sourceType,
    sourceReference: profile.sourceReference,
    sourceVersion: profile.sourceVersion,
    policyVersion: profile.policyVersion,
  });
  if (!reviewedBy?.trim()) throw new Error('ENERGY_TIMING_PROFILE_REVIEWER_REQUIRED');
}

export function assertCanUpdateTimingDraft(profile: ExerciseEnergyTimingProfileRecord): void {
  if (profile.status !== 'DRAFT') throw new Error('ENERGY_TIMING_PROFILE_IMMUTABLE');
}

export function assertCanRetireTimingProfile(profile: ExerciseEnergyTimingProfileRecord): void {
  if (profile.status !== 'APPROVED') throw new Error('ENERGY_TIMING_PROFILE_NOT_APPROVED');
}

export function selectApprovedTimingProfile(
  profiles: ExerciseEnergyTimingProfileRecord[],
  opts: {
    exerciseRevisionId: string;
    policyVersion?: string;
  },
): ExerciseEnergyTimingProfileRecord | null {
  const policy = opts.policyVersion ?? WORKOUT_ENERGY_TIMING_POLICY_VERSION;
  const matches = profiles.filter(
    (row) =>
      row.exerciseRevisionId === opts.exerciseRevisionId &&
      row.status === 'APPROVED' &&
      row.enabledForCalculation === true &&
      row.policyVersion === policy &&
      row.timingMethod === 'SECONDS_PER_REP',
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error('AMBIGUOUS_TIMING_PROFILE');
  return matches[0]!;
}

export function isTimingRuntimeSelectable(
  status: ExerciseEnergyTimingProfileStatus,
  enabled: boolean,
): boolean {
  return status === 'APPROVED' && enabled === true;
}

export { WORKOUT_ENERGY_TIMING_POLICY_VERSION };
