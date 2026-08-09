/**
 * WORKOUT-CATALOG-V3-01A — taxonomy domain contracts (foundation only).
 * Classification backfill is CATALOG-V3-01B. Generator behavior is out of scope.
 *
 * Lifecycle (FIX-01):
 * - REVISION-SEMANTIC (patterns/role/muscles/equipment): DB-frozen after parent
 *   ExerciseRevision is ever-approved; classify only on mutable DRAFT/*_REVIEW revisions.
 * - OPERATIONAL readiness (generator/energy/timing/media): intentionally mutable
 *   after approval so content gates can flip without fake new revisions.
 */
import { WORKOUT_CATALOG_EQUIPMENT } from './catalog-enums';

/** Audit target muscle taxonomy (independent of family). */
export const V3_MUSCLE_CODES = [
  'CHEST',
  'LATS',
  'UPPER_BACK',
  'TRAPS',
  'FRONT_DELTS',
  'SIDE_DELTS',
  'REAR_DELTS',
  'BICEPS',
  'TRICEPS',
  'FOREARMS_GRIP',
  'QUADS',
  'HAMSTRINGS',
  'GLUTES',
  'ADDUCTORS',
  'ABDUCTORS',
  'CALVES',
  'TIBIALIS',
  'ABS',
  'OBLIQUES',
  'DEEP_CORE',
  'LOWER_BACK',
  'HIP_FLEXORS',
  /** Systemic placeholders for conditioning/mobility/recovery (not anatomical). */
  'CONDITIONING_SYSTEMIC',
  'MOBILITY_SYSTEMIC',
  'RECOVERY_SYSTEMIC',
] as const;
export type V3MuscleCode = (typeof V3_MUSCLE_CODES)[number];

export const V3_MUSCLE_INVOLVEMENTS = ['PRIMARY', 'SECONDARY'] as const;
export type V3MuscleInvolvement = (typeof V3_MUSCLE_INVOLVEMENTS)[number];

/** Audit movement-pattern taxonomy (revision-bound; richer than generator 7-bucket). */
export const V3_MOVEMENT_PATTERN_CODES = [
  'HORIZONTAL_PUSH',
  'VERTICAL_PUSH',
  'HORIZONTAL_PULL',
  'VERTICAL_PULL',
  'SQUAT',
  'HINGE',
  'LUNGE',
  'KNEE_EXTENSION',
  'KNEE_FLEXION',
  'HIP_EXTENSION',
  'HIP_ABDUCTION',
  'HIP_ADDUCTION',
  'CALF_RAISE',
  'CARRY',
  'CORE_FLEXION',
  'CORE_ANTI_EXTENSION',
  'CORE_ANTI_ROTATION',
  'CORE_ROTATION',
  'LOCOMOTION',
  'JUMP',
  'CONDITIONING',
  'MOBILITY',
  'ELBOW_FLEXION',
  'ELBOW_EXTENSION',
] as const;
export type V3MovementPatternCode = (typeof V3_MOVEMENT_PATTERN_CODES)[number];

export const V3_TRAINING_ROLES = [
  'MAIN',
  'ACCESSORY',
  'ISOLATION',
  'CONDITIONING',
  'WARMUP',
  'MOBILITY',
  'RECOVERY',
] as const;
export type V3TrainingRole = (typeof V3_TRAINING_ROLES)[number];

export const V3_EQUIPMENT_GROUP_KINDS = ['ALL_OF', 'ANY_OF', 'OPTIONAL'] as const;
export type V3EquipmentGroupKind = (typeof V3_EQUIPMENT_GROUP_KINDS)[number];

/**
 * Expanded equipment vocabulary (S5).
 * Includes legacy 01B codes for dual-read compatibility.
 */
export const V3_EQUIPMENT_CODES = [
  ...WORKOUT_CATALOG_EQUIPMENT,
  'EZ_BAR',
  'SQUAT_RACK',
  'PULL_UP_BAR', // alias-friendly spelling; PULLUP_BAR remains legacy
  'SMITH_MACHINE',
  'LEG_PRESS',
  'HACK_SQUAT',
  'LEG_EXTENSION_MACHINE',
  'LEG_CURL_MACHINE',
  'CHEST_PRESS_MACHINE',
  'ROW_MACHINE',
  'LAT_PULLDOWN',
  'PEC_DECK',
  'HIP_ABDUCTION_MACHINE',
  'HIP_ADDUCTION_MACHINE',
  'CALF_MACHINE',
  'BOX_STEP',
  'JUMP_ROPE',
  'TREADMILL',
  'BIKE',
  'ELLIPTICAL',
  'ROW_ERG',
  'STAIR_CLIMBER',
  'FOAM_ROLLER',
  'AB_WHEEL',
  'BATTLE_ROPES',
  'SLED',
] as const;
export type V3EquipmentCode = (typeof V3_EQUIPMENT_CODES)[number];

/** Deduped unique list for seeding (PULL_UP_BAR + PULLUP_BAR both kept). */
export const V3_EQUIPMENT_CODES_UNIQUE: readonly string[] = [...new Set(V3_EQUIPMENT_CODES)];

export type V3MuscleInvolvementDraft = {
  muscleCode: string;
  involvement: string;
  sortOrder?: number;
};

export type V3EquipmentItemDraft = {
  equipmentCode: string;
  sortOrder?: number;
};

export type V3EquipmentGroupDraft = {
  groupKind: string;
  sortOrder?: number;
  items: readonly V3EquipmentItemDraft[];
};

export type V3RevisionTaxonomyDraft = {
  exerciseRevisionId: string;
  primaryMovementPattern?: string | null;
  secondaryMovementPattern?: string | null;
  trainingRole?: string | null;
  progressionGroup?: string | null;
  muscles?: readonly V3MuscleInvolvementDraft[];
  equipmentGroups?: readonly V3EquipmentGroupDraft[];
  readiness?: {
    catalogReady?: boolean | null;
    generatorReady?: boolean | null;
    energyReady?: boolean | null;
    timingReady?: boolean | null;
    mediaReady?: boolean | null;
  } | null;
};

export type V3TaxonomyIssue = { code: string; message: string; path?: string };

export function isV3MuscleCode(value: string): value is V3MuscleCode {
  return (V3_MUSCLE_CODES as readonly string[]).includes(value);
}

export function isV3MovementPatternCode(value: string): value is V3MovementPatternCode {
  return (V3_MOVEMENT_PATTERN_CODES as readonly string[]).includes(value);
}

export function isV3TrainingRole(value: string): value is V3TrainingRole {
  return (V3_TRAINING_ROLES as readonly string[]).includes(value);
}

export function isV3EquipmentGroupKind(value: string): value is V3EquipmentGroupKind {
  return (V3_EQUIPMENT_GROUP_KINDS as readonly string[]).includes(value);
}

export function isV3EquipmentCode(value: string): boolean {
  return V3_EQUIPMENT_CODES_UNIQUE.includes(value);
}
