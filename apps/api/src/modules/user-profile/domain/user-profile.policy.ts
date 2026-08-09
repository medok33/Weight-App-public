import type {
  ActivityLevel,
  AppLocale,
  GoalUpsertInput,
  ProfileUpsertInput,
  TrainingLevel,
} from './user-profile.types';
import {
  computeProfileStructureStatus,
  normalizeAllergenCodes,
  normalizeDietaryCodes,
  normalizeEquipmentCodes,
  normalizeIntoleranceCodes,
} from './profile-structure.policy';

const ACTIVITY_LEVELS: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const LOCALES: AppLocale[] = ['ru', 'en'];
const TRAINING_LEVELS: TrainingLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

export function validateLocale(locale?: string): AppLocale {
  if (!locale) return 'ru';
  if (!LOCALES.includes(locale as AppLocale)) throw new Error('PROFILE_INVALID_LOCALE');
  return locale as AppLocale;
}

export function validateProfileInput(input: ProfileUpsertInput): ProfileUpsertInput {
  const displayName = input.displayName?.trim();
  if (!displayName || displayName.length < 2) throw new Error('PROFILE_INVALID_NAME');
  if (!Number.isInteger(input.ageYears) || input.ageYears < 14 || input.ageYears > 100) throw new Error('PROFILE_INVALID_AGE');
  if (!Number.isInteger(input.heightCm) || input.heightCm < 120 || input.heightCm > 230) throw new Error('PROFILE_INVALID_HEIGHT');
  if (!Number.isFinite(input.weightKg) || input.weightKg < 35 || input.weightKg > 250) throw new Error('PROFILE_INVALID_WEIGHT');
  if (!ACTIVITY_LEVELS.includes(input.activityLevel)) throw new Error('PROFILE_INVALID_ACTIVITY');
  const locale = validateLocale(input.locale);

  const trainingLevel = input.trainingLevel ?? null;
  if (trainingLevel && !TRAINING_LEVELS.includes(trainingLevel)) throw new Error('PROFILE_INVALID_TRAINING_LEVEL');

  const workoutsPerWeek = input.workoutsPerWeek ?? null;
  if (workoutsPerWeek != null) {
    if (!Number.isInteger(workoutsPerWeek) || workoutsPerWeek < 0 || workoutsPerWeek > 14) {
      throw new Error('PROFILE_INVALID_WORKOUTS_PER_WEEK');
    }
  }

  const allergenCodes = normalizeAllergenCodes(input.allergenCodes);
  const dietaryCodes = normalizeDietaryCodes(input.dietaryCodes);
  const intoleranceCodes = normalizeIntoleranceCodes(input.intoleranceCodes);
  const equipmentCodes = normalizeEquipmentCodes(input.equipmentCodes);
  const preferredProductIds = (input.preferredProductIds ?? []).filter((id) =>
    /^[0-9a-f-]{36}$/i.test(id),
  );
  const dislikedProductIds = (input.dislikedProductIds ?? []).filter((id) =>
    /^[0-9a-f-]{36}$/i.test(id),
  );

  return {
    ...input,
    displayName,
    locale,
    trainingLevel,
    workoutsPerWeek,
    // Legacy free-text retained as optional notes only.
    dietaryPreferences: input.dietaryPreferences?.map((s) => s.trim()).filter(Boolean) ?? null,
    foodRestrictions: input.foodRestrictions?.map((s) => s.trim()).filter(Boolean) ?? null,
    availableEquipment: input.availableEquipment?.map((s) => s.trim()).filter(Boolean) ?? null,
    allergenCodes,
    dietaryCodes,
    intoleranceCodes,
    preferredProductIds,
    dislikedProductIds,
    equipmentCodes,
  };
}

export function resolveProfileStructureStatus(input: ProfileUpsertInput) {
  const hasStructured = Boolean(
    (input.allergenCodes?.length ?? 0) ||
      (input.dietaryCodes?.length ?? 0) ||
      (input.equipmentCodes?.length ?? 0) ||
      (input.intoleranceCodes?.length ?? 0),
  );
  const hasLegacyText = Boolean(
    (input.dietaryPreferences?.length ?? 0) ||
      (input.foodRestrictions?.length ?? 0) ||
      (input.availableEquipment?.length ?? 0),
  );
  return computeProfileStructureStatus({ hasStructured, hasLegacyText });
}

export function validateGoalInput(input: GoalUpsertInput): GoalUpsertInput {
  const kind = input.kind?.trim();
  if (!kind) throw new Error('GOAL_INVALID_KIND');
  if (!Number.isFinite(input.target) || input.target <= 0) throw new Error('GOAL_INVALID_TARGET');
  const unit = input.unit?.trim();
  if (!unit) throw new Error('GOAL_INVALID_UNIT');
  let targetDate = input.targetDate ?? null;
  if (targetDate) {
    const d = new Date(targetDate);
    if (Number.isNaN(d.getTime())) throw new Error('GOAL_INVALID_TARGET_DATE');
    targetDate = targetDate.slice(0, 10);
  }
  return { kind, target: input.target, unit, targetDate };
}

export function activityFactor(level: ActivityLevel): number {
  const map: Record<ActivityLevel, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };
  return map[level];
}
