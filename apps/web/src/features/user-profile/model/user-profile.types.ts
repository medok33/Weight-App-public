import type { ProfileStructureStatus } from './profile-controlled-codes';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type AppLocale = 'ru' | 'en';
export type TrainingLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | '';

export type UserProfile = {
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
  /** Optional free-text notes — not hard filters. */
  dietaryPreferences?: string[] | null;
  foodRestrictions?: string[] | null;
  availableEquipment?: string[] | null;
  allergenCodes?: string[];
  dietaryCodes?: string[];
  intoleranceCodes?: string[];
  equipmentCodes?: string[];
  preferredProductIds?: string[];
  dislikedProductIds?: string[];
  profileStructureStatus?: ProfileStructureStatus;
  legacyNeedsConfirmation?: boolean;
};

export type UserGoal = {
  userId: string;
  kind: string;
  target: number;
  unit: string;
  targetDate?: string | null;
};

export type ProfileFormValues = {
  displayName: string;
  ageYears: string;
  heightCm: string;
  weightKg: string;
  goalKind: string;
  goalTarget: string;
  targetDate: string;
  activityLevel: ActivityLevel;
  trainingLevel: TrainingLevel;
  workoutsPerWeek: string;
  allergenCodes: string[];
  dietaryCodes: string[];
  intoleranceCodes: string[];
  equipmentCodes: string[];
  dietaryPreferencesNote: string;
  foodRestrictionsNote: string;
  equipmentNote: string;
  locale: AppLocale;
  legacyStructureConfirmed: boolean;
};

export function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
