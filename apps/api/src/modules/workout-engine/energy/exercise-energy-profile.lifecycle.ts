import {
  COMPENDIUM_EDITIONS,
  ENERGY_MET_MAX,
  ENERGY_MET_MIN,
  ENERGY_POPULATION_TYPES,
  ENERGY_SOURCE_TYPES,
  EXERCISE_ENERGY_CALCULATION_METHODS,
  WORKOUT_ENERGY_POLICY_VERSION,
  type ExerciseEnergyProfileDraftInput,
  type ExerciseEnergyProfileRecord,
  type ExerciseEnergyProfileStatus,
} from './workout-energy.types';

export function assertDraftEnergyMetadata(input: ExerciseEnergyProfileDraftInput): void {
  if (!input.exerciseRevisionId?.trim()) throw new Error('ENERGY_PROFILE_REVISION_REQUIRED');
  if (!(EXERCISE_ENERGY_CALCULATION_METHODS as readonly string[]).includes(input.calculationMethod)) {
    throw new Error('ENERGY_PROFILE_METHOD_INVALID');
  }
  if (!(ENERGY_POPULATION_TYPES as readonly string[]).includes(input.populationType)) {
    throw new Error('ENERGY_PROFILE_POPULATION_INVALID');
  }
  if (!(COMPENDIUM_EDITIONS as readonly string[]).includes(input.compendiumEdition)) {
    throw new Error('ENERGY_PROFILE_EDITION_INVALID');
  }
  if (!(ENERGY_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) {
    throw new Error('ENERGY_PROFILE_SOURCE_TYPE_INVALID');
  }
  const code = String(input.compendiumCode ?? '').trim();
  if (!/^\d{5}$/.test(code)) throw new Error('ENERGY_PROFILE_COMPENDIUM_CODE_INVALID');
  if (
    typeof input.metValue !== 'number' ||
    !Number.isFinite(input.metValue) ||
    input.metValue < ENERGY_MET_MIN ||
    input.metValue > ENERGY_MET_MAX
  ) {
    throw new Error('ENERGY_PROFILE_MET_INVALID');
  }
  if (!String(input.sourceReference ?? '').trim()) throw new Error('ENERGY_PROFILE_SOURCE_REFERENCE_REQUIRED');
  if (!String(input.sourceVersion ?? '').trim()) throw new Error('ENERGY_PROFILE_SOURCE_VERSION_REQUIRED');
}

export function assertCanApprove(profile: ExerciseEnergyProfileRecord, reviewedBy: string): void {
  if (profile.status !== 'DRAFT') throw new Error('ENERGY_PROFILE_NOT_DRAFT');
  assertDraftEnergyMetadata({
    exerciseRevisionId: profile.exerciseRevisionId,
    calculationMethod: profile.calculationMethod,
    populationType: profile.populationType,
    compendiumEdition: profile.compendiumEdition,
    compendiumCode: profile.compendiumCode,
    metValue: profile.metValue,
    sourceType: profile.sourceType,
    sourceReference: profile.sourceReference,
    sourceVersion: profile.sourceVersion,
    policyVersion: profile.policyVersion,
  });
  if (!reviewedBy?.trim()) throw new Error('ENERGY_PROFILE_REVIEWER_REQUIRED');
}

export function assertCanUpdateDraft(profile: ExerciseEnergyProfileRecord): void {
  if (profile.status !== 'DRAFT') throw new Error('ENERGY_PROFILE_IMMUTABLE');
}

export function assertCanRetire(profile: ExerciseEnergyProfileRecord): void {
  if (profile.status !== 'APPROVED') throw new Error('ENERGY_PROFILE_NOT_APPROVED');
}

/**
 * Runtime selection: APPROVED + enabled + matching policy + population.
 * Ambiguous >1 match → INVALID_ENERGY_PROFILE (caller maps).
 */
export function selectApprovedEnergyProfile(
  profiles: ExerciseEnergyProfileRecord[],
  opts: {
    exerciseRevisionId: string;
    policyVersion?: string;
    populationType?: string;
  },
): ExerciseEnergyProfileRecord | null {
  const policy = opts.policyVersion ?? WORKOUT_ENERGY_POLICY_VERSION;
  const population = opts.populationType ?? 'ADULT_STANDARD_2024';
  const matches = profiles.filter(
    (row) =>
      row.exerciseRevisionId === opts.exerciseRevisionId &&
      row.status === 'APPROVED' &&
      row.enabledForCalculation === true &&
      row.policyVersion === policy &&
      row.populationType === population &&
      row.calculationMethod === 'MET_DURATION',
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error('INVALID_ENERGY_PROFILE');
  return matches[0]!;
}

export function isRuntimeSelectable(status: ExerciseEnergyProfileStatus, enabled: boolean): boolean {
  return status === 'APPROVED' && enabled === true;
}

export { WORKOUT_ENERGY_POLICY_VERSION };
