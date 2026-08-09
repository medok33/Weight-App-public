export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type AppLocale = 'ru' | 'en';
export type TrainingLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type UserProfileRecord = {
  userId: string;
  displayName: string;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  locale: AppLocale;
  timezone?: string;
  trainingLevel?: TrainingLevel | null;
  workoutsPerWeek?: number | null;
  /** Legacy free-text notes — not hard filters. */
  dietaryPreferences?: string[] | null;
  foodRestrictions?: string[] | null;
  availableEquipment?: string[] | null;
  allergenCodes?: string[];
  dietaryCodes?: string[];
  intoleranceCodes?: string[];
  preferredProductIds?: string[];
  dislikedProductIds?: string[];
  equipmentCodes?: string[];
  profileStructureStatus?: 'STRUCTURED' | 'LEGACY_UNSTRUCTURED' | 'MIXED' | 'NEEDS_CONFIRMATION';
  legacyNeedsConfirmation?: boolean;
};

export type ProfileUpsertInput = {
  displayName: string;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  locale?: AppLocale;
  timezone?: string;
  trainingLevel?: TrainingLevel | null;
  workoutsPerWeek?: number | null;
  dietaryPreferences?: string[] | null;
  foodRestrictions?: string[] | null;
  availableEquipment?: string[] | null;
  allergenCodes?: string[] | null;
  dietaryCodes?: string[] | null;
  intoleranceCodes?: string[] | null;
  preferredProductIds?: string[] | null;
  dislikedProductIds?: string[] | null;
  equipmentCodes?: string[] | null;
};

export type GoalUpsertInput = {
  kind: string;
  target: number;
  unit: string;
  targetDate?: string | null;
};

export type UserGoalRecord = {
  userId: string;
  kind: string;
  target: number;
  unit: string;
  targetDate?: string | null;
};

export function parseStringList(raw: string | null | undefined): string[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    // comma-separated fallback
  }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

export function serializeStringList(value: string[] | null | undefined): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value.map((s) => s.trim()).filter(Boolean));
}
