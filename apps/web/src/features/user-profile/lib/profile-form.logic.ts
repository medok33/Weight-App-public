import type { ProfileFormValues } from '../model/user-profile.types';

export type ProfileFieldErrorKey =
  | 'displayName'
  | 'ageYears'
  | 'heightCm'
  | 'weightKg'
  | 'goalKind'
  | 'goalTarget'
  | 'workoutsPerWeek'
  | 'legacy';

/** Align with backend user-profile.policy + onboarding UX ranges. */
export function validateProfileForm(form: ProfileFormValues): Partial<Record<ProfileFieldErrorKey, true>> {
  const errors: Partial<Record<ProfileFieldErrorKey, true>> = {};
  if (!form.displayName.trim() || form.displayName.trim().length < 2) errors.displayName = true;
  const age = Number(form.ageYears);
  if (!form.ageYears || !Number.isInteger(age) || age < 14 || age > 100) errors.ageYears = true;
  const height = Number(form.heightCm);
  if (!form.heightCm || !Number.isInteger(height) || height < 120 || height > 230) errors.heightCm = true;
  const weight = Number(form.weightKg);
  if (!form.weightKg || !Number.isFinite(weight) || weight < 35 || weight > 250) errors.weightKg = true;
  if (!form.goalKind.trim()) errors.goalKind = true;
  const target = Number(form.goalTarget);
  if (!form.goalTarget || !Number.isFinite(target) || target <= 0 || target > 250) errors.goalTarget = true;
  if (form.workoutsPerWeek !== '') {
    const w = Number(form.workoutsPerWeek);
    if (!Number.isInteger(w) || w < 0 || w > 14) errors.workoutsPerWeek = true;
  }
  return errors;
}

export function serializeProfileForm(form: ProfileFormValues): string {
  return JSON.stringify({
    displayName: form.displayName.trim(),
    ageYears: form.ageYears,
    heightCm: form.heightCm,
    weightKg: form.weightKg,
    goalKind: form.goalKind,
    goalTarget: form.goalTarget,
    targetDate: form.targetDate,
    activityLevel: form.activityLevel,
    trainingLevel: form.trainingLevel,
    workoutsPerWeek: form.workoutsPerWeek,
    allergenCodes: [...form.allergenCodes].sort(),
    dietaryCodes: [...form.dietaryCodes].sort(),
    intoleranceCodes: [...form.intoleranceCodes].sort(),
    equipmentCodes: [...form.equipmentCodes].sort(),
    dietaryPreferencesNote: form.dietaryPreferencesNote,
    foodRestrictionsNote: form.foodRestrictionsNote,
    equipmentNote: form.equipmentNote,
    locale: form.locale,
    legacyStructureConfirmed: form.legacyStructureConfirmed,
  });
}

export function isProfileFormDirty(current: ProfileFormValues, baselineSerialized: string | null): boolean {
  if (!baselineSerialized) return false;
  return serializeProfileForm(current) !== baselineSerialized;
}
