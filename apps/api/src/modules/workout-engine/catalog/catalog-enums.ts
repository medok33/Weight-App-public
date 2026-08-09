/** WORKOUT-CATALOG-01A — catalog enums (manifest + domain). */

export const TRAINING_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export type CatalogTrainingLevel = (typeof TRAINING_LEVELS)[number];

export const CATALOG_PLACES = ["HOME", "GYM"] as const;
export type CatalogPlace = (typeof CATALOG_PLACES)[number];

export const MANIFEST_MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "lunge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "carry",
  "anti_extension_core",
  "anti_rotation_core",
  "lateral_core",
  "glute_isolation",
  "calf",
  "mobility",
  "low_impact_conditioning",
  "recovery",
] as const;
export type ManifestMovementPattern = (typeof MANIFEST_MOVEMENT_PATTERNS)[number];

/** Maps rich catalog patterns onto WORKOUT-V2 generator MovementPattern. */
export const GENERATOR_MOVEMENT_PATTERN: Record<
  ManifestMovementPattern,
  "squat" | "hinge" | "push" | "pull" | "core" | "cardio" | "mobility"
> = {
  squat: "squat",
  hinge: "hinge",
  lunge: "squat",
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  carry: "cardio",
  anti_extension_core: "core",
  anti_rotation_core: "core",
  lateral_core: "core",
  glute_isolation: "hinge",
  calf: "mobility",
  mobility: "mobility",
  low_impact_conditioning: "cardio",
  recovery: "mobility",
};

export const REPETITION_MODES = ["REPS", "DURATION", "REPS_OR_DURATION"] as const;
export type RepetitionMode = (typeof REPETITION_MODES)[number];

export const LOAD_LEVELS = ["LOW", "MODERATE", "HIGH"] as const;
export type LoadLevel = (typeof LOAD_LEVELS)[number];

export const INITIAL_CATALOG_STATUSES = [
  "EXISTING_APPROVED",
  "PLANNED_FOR_01B",
  "CANONICAL_01B",
  "RETIRED_ALIAS",
] as const;
export type InitialCatalogStatus = (typeof INITIAL_CATALOG_STATUSES)[number];

export const PLANNED_CONTENT_PACKAGES = ["EXISTING", "WORKOUT_CATALOG_01B"] as const;
export type PlannedContentPackage = (typeof PLANNED_CONTENT_PACKAGES)[number];

export const EXERCISE_REVISION_STATUSES = [
  "CANDIDATE",
  "DRAFT",
  "TECHNIQUE_REVIEW",
  "SAFETY_REVIEW",
  "MEDIA_REVIEW",
  "APPROVED",
  "RETIRED",
] as const;
export type ExerciseRevisionStatus = (typeof EXERCISE_REVISION_STATUSES)[number];

export const CATALOG_RELEASE_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export type CatalogReleaseStatus = (typeof CATALOG_RELEASE_STATUSES)[number];

export const VARIANT_RELATION_TYPES = [
  "EASIER",
  "SAME_LEVEL",
  "HARDER",
  "EQUIPMENT_SWAP",
  "NO_EQUIPMENT",
  "HOME_ALTERNATIVE",
  "GYM_ALTERNATIVE",
  "LOW_IMPACT",
  "NO_FLOOR",
  "QUIET_ALTERNATIVE",
] as const;
export type VariantRelationType = (typeof VARIANT_RELATION_TYPES)[number];

export const WORKOUT_CATALOG_EQUIPMENT = [
  "NONE",
  "BODYWEIGHT",
  "RESISTANCE_BAND",
  "DUMBBELL",
  "KETTLEBELL",
  "BENCH",
  "CHAIR",
  "MAT",
  "PULLUP_BAR",
  "GYM_MACHINES",
  "CABLE",
  "BARBELL",
  "CARDIO_MACHINE",
] as const;
export type WorkoutCatalogEquipment = (typeof WORKOUT_CATALOG_EQUIPMENT)[number];

/** Movements explicitly excluded from the Weight App general-fitness catalog. */
export const EXCLUDED_COMPLEX_SLUG_FRAGMENTS = [
  "clean",
  "snatch",
  "jerk",
  "kipping",
  "muscle_up",
  "muscle-up",
  "pistol_squat",
  "turkish_get_up",
  "turkish-get-up",
  "box_jump",
  "high_impact_box",
] as const;

export const BOOTSTRAP_RELEASE_CODE = "workout-catalog-bootstrap-01a";
export const CANONICAL_RELEASE_CODE = "workout-catalog-canonical-01b";
/** Historical 01A inventory stamp (bootstrap). */
export const CATALOG_MANIFEST_VERSION_01A = "workout-catalog-manifest-01a.1";
export const CATALOG_MANIFEST_VERSION = "workout-catalog-manifest-01b.1";
export const CATALOG_ALGORITHM_VERSION_01A = "workout-catalog-01a.1";
export const CATALOG_ALGORITHM_VERSION = "workout-catalog-01b.1";
