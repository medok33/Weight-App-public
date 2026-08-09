/**
 * CATALOG-V3-01B — deterministic V3 classification SoT for the current 84 exercises.
 * Generated from WORKOUT-CATALOG-V3-SCOPE-01/03_EXISTING_84_AUDIT_MATRIX.csv.
 * Do not invent UNKNOWN/OTHER/fake readiness. Regenerator:
 *   node apps/api/scripts/generate-catalog-v3-01b-classification.mjs
 */
import type { V3EquipmentGroupDraft, V3MuscleInvolvementDraft } from './catalog-v3-taxonomy';

export const CATALOG_V3_01B_CLASSIFICATION_VERSION =
  'workout-catalog-v3-01b-classification.1' as const;

export const CATALOG_V3_01B_CREATED_BY = 'system:catalog-v3-01b' as const;

/** Advisory lock for disposable-apply of 01B classification (distinct from publish/energy). */
export const CATALOG_V3_01B_ADVISORY_LOCK_KEY = 219_01_001;

export const V3_01B_DISPOSITIONS = [
  'KEEP',
  'KEEP_RENAME',
  'KEEP_RECLASSIFY',
  'MERGE_VARIANT',
  'KEEP_NOT_DEFAULT',
  'DEPRECATE',
] as const;
export type V301bDisposition = (typeof V3_01B_DISPOSITIONS)[number];

export const V3_01B_DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type V301bDifficulty = (typeof V3_01B_DIFFICULTIES)[number];

export type V301bIdentityAction =
  | 'KEEP_IDENTITY'
  | 'PLAN_ONLY_NO_PHYSICAL_MERGE';

export type V301bClassificationEntry = {
  exerciseKey: string;
  disposition: V301bDisposition;
  /** Audit matrix revision column (published pin revision at audit time). */
  auditBaseRevisionNumber: number;
  identityAction: V301bIdentityAction;
  primaryMovementPattern: string;
  trainingRole: string;
  difficulty: V301bDifficulty;
  progressionGroup: string;
  muscles: readonly V3MuscleInvolvementDraft[];
  equipmentGroups: readonly V3EquipmentGroupDraft[];
  reason: string;
};

export const CATALOG_V3_01B_CLASSIFICATION: readonly V301bClassificationEntry[] = [
  {
    exerciseKey: 'ankle_rocks',
    disposition: 'KEEP',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'gentle_stretch',
    muscles: [
      { muscleCode: 'CALVES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Stable mobility/recovery identity; still add V3 trainingRole=MOBILITY/RECOVERY but no rename/merge.",
  },
  {
    exerciseKey: 'assisted_pull_up_machine',
    disposition: 'KEEP_NOT_DEFAULT',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'lat_pulldown',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts. Also KEEP_NOT_DEFAULT: advanced/gym-biased; eligible when equipment+level allow, not default home beginner pool.",
  },
  {
    exerciseKey: 'back_extension_machine',
    disposition: 'KEEP_NOT_DEFAULT',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HINGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'romanian_deadlift',
    muscles: [
      { muscleCode: 'LOWER_BACK', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts. Also KEEP_NOT_DEFAULT: advanced/gym-biased; eligible when equipment+level allow, not default home beginner pool.",
  },
  {
    exerciseKey: 'band_chest_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'band_press',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_face_pull',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'band_pull_apart',
    muscles: [
      { muscleCode: 'UPPER_BACK', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'REAR_DELTS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_glute_bridge',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'glute_bridge',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'band_lat_pulldown',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'lat_pulldown',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_lateral_walk',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'hip_abduction',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_overhead_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'shoulder_press',
    muscles: [
      { muscleCode: 'SIDE_DELTS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_pull_apart',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'band_pull_apart',
    muscles: [
      { muscleCode: 'UPPER_BACK', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'REAR_DELTS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_row',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'band_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'band_squat',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'bodyweight_squat',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'barbell_bench_press',
    disposition: 'KEEP_NOT_DEFAULT',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'ADVANCED',
    progressionGroup: 'bench_press',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BARBELL', sortOrder: 0 },
          { equipmentCode: 'BENCH', sortOrder: 1 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts. Also KEEP_NOT_DEFAULT: advanced/gym-biased; eligible when equipment+level allow, not default home beginner pool.",
  },
  {
    exerciseKey: 'barbell_bent_over_row',
    disposition: 'KEEP_NOT_DEFAULT',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'ADVANCED',
    progressionGroup: 'barbell_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BARBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts. Also KEEP_NOT_DEFAULT: advanced/gym-biased; eligible when equipment+level allow, not default home beginner pool.",
  },
  {
    exerciseKey: 'barbell_hip_thrust',
    disposition: 'KEEP_NOT_DEFAULT',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'ADVANCED',
    progressionGroup: 'hip_thrust',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BARBELL', sortOrder: 0 },
          { equipmentCode: 'BENCH', sortOrder: 1 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization. Also KEEP_NOT_DEFAULT: advanced/gym-biased; eligible when equipment+level allow, not default home beginner pool.",
  },
  {
    exerciseKey: 'barbell_romanian_deadlift',
    disposition: 'KEEP_NOT_DEFAULT',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HINGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'romanian_deadlift',
    muscles: [
      { muscleCode: 'HAMSTRINGS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BARBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts. Also KEEP_NOT_DEFAULT: advanced/gym-biased; eligible when equipment+level allow, not default home beginner pool.",
  },
  {
    exerciseKey: 'bird_dog',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'bird_dog',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'bodyweight_hip_thrust',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'hip_thrust',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'bodyweight_squats',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'bodyweight_squat',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'box_squat_to_chair',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'bodyweight_squat',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CHAIR', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'brisk_outdoor_walk',
    disposition: 'MERGE_VARIANT',
    auditBaseRevisionNumber: 1,
    identityAction: 'PLAN_ONLY_NO_PHYSICAL_MERGE',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'BEGINNER',
    progressionGroup: 'WALKING',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Third outdoor walk variant; intensity/context should be prescription/intent, not separate identity long-term.",
  },
  {
    exerciseKey: 'cable_chest_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'chest_press_machine',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CABLE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'cable_row',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'cable_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'cat_cow_flow',
    disposition: 'KEEP',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'mobility_flow',
    muscles: [
      { muscleCode: 'MOBILITY_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Stable mobility/recovery identity; still add V3 trainingRole=MOBILITY/RECOVERY but no rename/merge.",
  },
  {
    exerciseKey: 'chair_sit_to_stand',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'bodyweight_squat',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CHAIR', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'chest_press_machine',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'chest_press_machine',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'chest_supported_dumbbell_row',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'dumbbell_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 },
          { equipmentCode: 'BENCH', sortOrder: 1 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'core_plank',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'plank',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'dead_bug',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'dead_bug',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dead_bug_hold',
    disposition: 'KEEP',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'dead_bug',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Duration hold sibling of dead_bug reps; distinct prescription mode justifies separate key.",
  },
  {
    exerciseKey: 'diaphragmatic_breathing',
    disposition: 'KEEP',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LOCOMOTION',
    trainingRole: 'RECOVERY',
    difficulty: 'BEGINNER',
    progressionGroup: 'recovery',
    muscles: [
      { muscleCode: 'RECOVERY_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Stable mobility/recovery identity; still add V3 trainingRole=MOBILITY/RECOVERY but no rename/merge.",
  },
  {
    exerciseKey: 'dumbbell_floor_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'dumbbell_press',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dumbbell_goblet_split_squat',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LUNGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'lunge_split',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dumbbell_lateral_raise',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'shoulder_press',
    muscles: [
      { muscleCode: 'SIDE_DELTS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dumbbell_romanian_deadlift',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HINGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'romanian_deadlift',
    muscles: [
      { muscleCode: 'HAMSTRINGS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dumbbell_row',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'dumbbell_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dumbbell_shoulder_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'shoulder_press',
    muscles: [
      { muscleCode: 'SIDE_DELTS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'dumbbell_step_up',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LUNGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'step_up',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 },
          { equipmentCode: 'BENCH', sortOrder: 1 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'elliptical_easy',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'BEGINNER',
    progressionGroup: 'low_impact_cardio',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CARDIO_MACHINE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'farmer_carry_dumbbell',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CARRY',
    trainingRole: 'ACCESSORY',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'farmer_carry',
    muscles: [
      { muscleCode: 'FOREARMS_GRIP', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'SIDE_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'forearm_plank_knees',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'plank',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'glute_bridge',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HINGE',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'glute_bridge',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'HAMSTRINGS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'glute_bridge_march',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'glute_bridge',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'goblet_squat',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'goblet_squat',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'good_morning_bodyweight',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HINGE',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'romanian_deadlift',
    muscles: [
      { muscleCode: 'HAMSTRINGS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'heel_taps',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'dead_bug',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'hip_flexor_stretch',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'gentle_stretch',
    muscles: [
      { muscleCode: 'HIP_FLEXORS', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'incline_push_ups',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'push_up',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'knee_push_ups',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'push_up',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'lat_pulldown',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'lat_pulldown',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'lat_pulldown_neutral_grip',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'lat_pulldown',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'leg_extension_machine',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'leg_press',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'light_jog',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'easy_jog',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'low_step_up',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LUNGE',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'step_up',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BENCH', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'machine_hip_abduction',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'hip_abduction',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'machine_leg_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'leg_press',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'mat_glute_bridge_hold',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'glute_bridge',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'mobility_flow',
    disposition: 'KEEP',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'mobility_flow',
    muscles: [
      { muscleCode: 'MOBILITY_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Stable mobility/recovery identity; still add V3 trainingRole=MOBILITY/RECOVERY but no rename/merge.",
  },
  {
    exerciseKey: 'morning_walk',
    disposition: 'MERGE_VARIANT',
    auditBaseRevisionNumber: 2,
    identityAction: 'PLAN_ONLY_NO_PHYSICAL_MERGE',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'BEGINNER',
    progressionGroup: 'WALKING',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Same outdoor walking locomotion; currently distinct keys encode plan/context intent (morning vs recovery) rather than distinct movement identity. Keep both published until V3 walking canonical + intent layer; do not merge now.",
  },
  {
    exerciseKey: 'pallof_press_band',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_ROTATION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'anti_rotation',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'pec_deck_machine',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'chest_press_machine',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'push_ups',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'push_up',
    muscles: [
      { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'SIDE_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'recovery_walk',
    disposition: 'MERGE_VARIANT',
    auditBaseRevisionNumber: 2,
    identityAction: 'PLAN_ONLY_NO_PHYSICAL_MERGE',
    primaryMovementPattern: 'LOCOMOTION',
    trainingRole: 'RECOVERY',
    difficulty: 'BEGINNER',
    progressionGroup: 'WALKING',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Same outdoor walking locomotion; currently distinct keys encode plan/context intent (morning vs recovery) rather than distinct movement identity. Keep both published until V3 walking canonical + intent layer; do not merge now.",
  },
  {
    exerciseKey: 'reverse_lunge',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LUNGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'lunge_split',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'seated_cable_row',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'cable_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CABLE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'seated_calf_raise_machine',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CALF_RAISE',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'calf_raise',
    muscles: [
      { muscleCode: 'CALVES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'seated_leg_curl_machine',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HINGE',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'leg_curl',
    muscles: [
      { muscleCode: 'HAMSTRINGS', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'seated_machine_shoulder_press',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'VERTICAL_PUSH',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'shoulder_press',
    muscles: [
      { muscleCode: 'SIDE_DELTS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'GYM_MACHINES', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'seated_march',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'BEGINNER',
    progressionGroup: 'low_impact_cardio',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'HIP_FLEXORS', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CHAIR', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'side_lying_clamshell',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HIP_EXTENSION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'hip_abduction',
    muscles: [
      { muscleCode: 'GLUTES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'side_plank',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_ROTATION',
    trainingRole: 'ACCESSORY',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'side_plank',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'side_plank_knee',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CORE_ANTI_ROTATION',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'side_plank',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'standing_band_row',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'HORIZONTAL_PULL',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'band_row',
    muscles: [
      { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'RESISTANCE_BAND', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'standing_calf_raise',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CALF_RAISE',
    trainingRole: 'ACCESSORY',
    difficulty: 'BEGINNER',
    progressionGroup: 'calf_raise',
    muscles: [
      { muscleCode: 'CALVES', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'static_split_squat',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LUNGE',
    trainingRole: 'MAIN',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'lunge_split',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'stationary_bike_easy',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'BEGINNER',
    progressionGroup: 'low_impact_cardio',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CARDIO_MACHINE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'stretching',
    disposition: 'KEEP',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'gentle_stretch',
    muscles: [
      { muscleCode: 'MOBILITY_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Stable mobility/recovery identity; still add V3 trainingRole=MOBILITY/RECOVERY but no rename/merge.",
  },
  {
    exerciseKey: 'suitcase_carry_dumbbell',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CARRY',
    trainingRole: 'ACCESSORY',
    difficulty: 'INTERMEDIATE',
    progressionGroup: 'farmer_carry',
    muscles: [
      { muscleCode: 'ABS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'DEEP_CORE', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'FOREARMS_GRIP', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'DUMBBELL', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'supine_knee_hugs',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LOCOMOTION',
    trainingRole: 'RECOVERY',
    difficulty: 'BEGINNER',
    progressionGroup: 'gentle_stretch',
    muscles: [
      { muscleCode: 'MOBILITY_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'supported_reverse_lunge',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'LUNGE',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'lunge_split',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Valid separate progression/regression variant; needs V3 primary/secondary muscles, trainingRole, richer equipment ALL_OF, and graph formalization.",
  },
  {
    exerciseKey: 'thoracic_opener_open_book',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'gentle_stretch',
    muscles: [
      { muscleCode: 'UPPER_BACK', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'NONE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'treadmill_walk',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 2,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'CONDITIONING',
    trainingRole: 'CONDITIONING',
    difficulty: 'BEGINNER',
    progressionGroup: 'treadmill_walk',
    muscles: [
      { muscleCode: 'CONDITIONING_SYSTEMIC', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'CARDIO_MACHINE', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  },
  {
    exerciseKey: 'wall_angels',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'MOBILITY',
    trainingRole: 'MOBILITY',
    difficulty: 'BEGINNER',
    progressionGroup: 'gentle_stretch',
    muscles: [
      { muscleCode: 'UPPER_BACK', involvement: 'PRIMARY', sortOrder: 0 },
      { muscleCode: 'SIDE_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 2 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Keep identity; REPS_OR_DURATION mode blocks energy/timing readiness; V3 needs decisive mode + mobility role.",
  },
  {
    exerciseKey: 'wall_sit',
    disposition: 'KEEP_RECLASSIFY',
    auditBaseRevisionNumber: 1,
    identityAction: 'KEEP_IDENTITY',
    primaryMovementPattern: 'SQUAT',
    trainingRole: 'MAIN',
    difficulty: 'BEGINNER',
    progressionGroup: 'bodyweight_squat',
    muscles: [
      { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 }
    ],
    equipmentGroups: [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: 'BODYWEIGHT', sortOrder: 0 }
        ],
      }
    ],
    reason: "Retain identity/revision; reclassify onto independent V3 dimensions (muscles, pattern, equipment requirement, trainingRole). Current familySlug conflates multiple concepts.",
  }
];
