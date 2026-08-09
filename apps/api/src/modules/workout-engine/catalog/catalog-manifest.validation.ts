import {
  EXCLUDED_COMPLEX_SLUG_FRAGMENTS,
  INITIAL_CATALOG_STATUSES,
  LOAD_LEVELS,
  MANIFEST_MOVEMENT_PATTERNS,
  PLANNED_CONTENT_PACKAGES,
  REPETITION_MODES,
  TRAINING_LEVELS,
  WORKOUT_CATALOG_EQUIPMENT,
  CATALOG_PLACES,
} from "./catalog-enums";
import { WORKOUT_CATALOG_MANIFEST, type CatalogManifestEntry } from "./catalog-manifest";

/** Legacy Exercise.key values that WORKOUT-V2-01A/01B generator could select. */
export const LEGACY_GENERATOR_EXERCISE_KEYS = [
  "morning_walk",
  "bodyweight_squats",
  "stretching",
  "light_jog",
  "core_plank",
  "mobility_flow",
  "recovery_walk",
  "push_ups",
  "glute_bridge",
  "dead_bug",
  "band_row",
  "band_pull_apart",
  "dumbbell_row",
  "goblet_squat",
  "machine_leg_press",
  "cable_row",
  "treadmill_walk",
  "chest_press_machine",
  "barbell_romanian_deadlift",
  "lat_pulldown",
] as const;

const BARBELL_ADVANCED_BASICS = new Set([
  "barbell_bench_press",
  "barbell_bent_over_row",
  "barbell_romanian_deadlift",
  "barbell_hip_thrust",
]);

export type ManifestValidationIssue = {
  code: string;
  message: string;
};

function isNonEmptyName(value: string): boolean {
  return typeof value === "string" && value.trim().length >= 2;
}

export function validateWorkoutCatalogManifest(
  entries: readonly CatalogManifestEntry[] = WORKOUT_CATALOG_MANIFEST,
): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  if (entries.length !== 84) {
    issues.push({ code: "COUNT", message: `Expected 84 entries, got ${entries.length}` });
  }

  const ordinals = new Set<number>();
  const slugs = new Set<string>();
  const families = new Set<string>();
  const legacyMapped = new Map<string, string>();

  for (const entry of entries) {
    if (ordinals.has(entry.ordinal)) {
      issues.push({ code: "ORDINAL_DUP", message: `Duplicate ordinal ${entry.ordinal}` });
    }
    ordinals.add(entry.ordinal);

    if (slugs.has(entry.slug)) {
      issues.push({ code: "SLUG_DUP", message: `Duplicate slug ${entry.slug}` });
    }
    slugs.add(entry.slug);
    families.add(entry.familySlug);

    if (!isNonEmptyName(entry.nameRu) || !isNonEmptyName(entry.nameEn)) {
      issues.push({ code: "NAME", message: `Invalid name on ${entry.slug}` });
    }
    if (!(TRAINING_LEVELS as readonly string[]).includes(entry.minLevel)) {
      issues.push({ code: "LEVEL", message: `Invalid minLevel on ${entry.slug}` });
    }
    if (!(MANIFEST_MOVEMENT_PATTERNS as readonly string[]).includes(entry.movementPattern)) {
      issues.push({ code: "PATTERN", message: `Invalid movementPattern on ${entry.slug}` });
    }
    if (!(REPETITION_MODES as readonly string[]).includes(entry.repetitionMode)) {
      issues.push({ code: "REPS_MODE", message: `Invalid repetitionMode on ${entry.slug}` });
    }
    if (!(LOAD_LEVELS as readonly string[]).includes(entry.impactLevel)) {
      issues.push({ code: "IMPACT", message: `Invalid impactLevel on ${entry.slug}` });
    }
    if (!(LOAD_LEVELS as readonly string[]).includes(entry.balanceRequirement)) {
      issues.push({ code: "BALANCE", message: `Invalid balanceRequirement on ${entry.slug}` });
    }
    if (!(INITIAL_CATALOG_STATUSES as readonly string[]).includes(entry.initialCatalogStatus)) {
      issues.push({ code: "STATUS", message: `Invalid initialCatalogStatus on ${entry.slug}` });
    }
    if (!(PLANNED_CONTENT_PACKAGES as readonly string[]).includes(entry.plannedContentPackage)) {
      issues.push({ code: "PACKAGE", message: `Invalid plannedContentPackage on ${entry.slug}` });
    }
    if (!entry.supportedPlaces.length) {
      issues.push({ code: "PLACE_EMPTY", message: `supportedPlaces empty on ${entry.slug}` });
    }
    for (const place of entry.supportedPlaces) {
      if (!(CATALOG_PLACES as readonly string[]).includes(place)) {
        issues.push({ code: "PLACE", message: `Invalid place ${place} on ${entry.slug}` });
      }
    }
    for (const eq of [...entry.requiredEquipment, ...entry.optionalEquipment]) {
      if (!(WORKOUT_CATALOG_EQUIPMENT as readonly string[]).includes(eq)) {
        issues.push({ code: "EQUIPMENT", message: `Invalid equipment ${eq} on ${entry.slug}` });
      }
    }

    if (entry.beginnerAllowed && entry.minLevel !== "BEGINNER") {
      issues.push({
        code: "BEGINNER_LEVEL",
        message: `beginnerAllowed true requires minLevel BEGINNER on ${entry.slug}`,
      });
    }
    if (BARBELL_ADVANCED_BASICS.has(entry.slug) && entry.beginnerAllowed) {
      issues.push({
        code: "BARBELL_BEGINNER",
        message: `Barbell advanced basic must not be beginnerAllowed: ${entry.slug}`,
      });
    }

    const slugLower = entry.slug.toLowerCase();
    for (const frag of EXCLUDED_COMPLEX_SLUG_FRAGMENTS) {
      if (slugLower.includes(frag.replace(/-/g, "_")) || slugLower.includes(frag)) {
        // allow false positives only for fragments that are substrings of safe words — none expected
        if (frag === "clean" && !/(^|_)clean(_|$)/.test(slugLower)) continue;
        if (frag === "jerk" && !/(^|_)jerk(_|$)/.test(slugLower)) continue;
        issues.push({
          code: "EXCLUDED_MOVEMENT",
          message: `Excluded complex movement fragment "${frag}" in ${entry.slug}`,
        });
      }
    }

    if (entry.initialCatalogStatus === "PLANNED_FOR_01B") {
      if (entry.plannedContentPackage !== "WORKOUT_CATALOG_01B") {
        issues.push({
          code: "PLANNED_PACKAGE",
          message: `PLANNED_FOR_01B must use WORKOUT_CATALOG_01B package: ${entry.slug}`,
        });
      }
      if (entry.legacyExerciseKey) {
        issues.push({
          code: "PLANNED_LEGACY",
          message: `PLANNED_FOR_01B must not map legacy key: ${entry.slug}`,
        });
      }
    }

    if (entry.initialCatalogStatus === "CANONICAL_01B") {
      if (entry.plannedContentPackage !== "WORKOUT_CATALOG_01B") {
        issues.push({
          code: "CANONICAL_PACKAGE",
          message: `CANONICAL_01B must use WORKOUT_CATALOG_01B package: ${entry.slug}`,
        });
      }
      if (entry.legacyExerciseKey) {
        issues.push({
          code: "CANONICAL_LEGACY",
          message: `CANONICAL_01B must not map legacy key: ${entry.slug}`,
        });
      }
    }

    if (entry.initialCatalogStatus === "EXISTING_APPROVED") {
      if (!entry.legacyExerciseKey) {
        issues.push({
          code: "EXISTING_MAP",
          message: `EXISTING_APPROVED requires legacyExerciseKey: ${entry.slug}`,
        });
      } else if (legacyMapped.has(entry.legacyExerciseKey)) {
        issues.push({
          code: "LEGACY_DUP",
          message: `Duplicate legacy mapping ${entry.legacyExerciseKey}`,
        });
      } else {
        legacyMapped.set(entry.legacyExerciseKey, entry.slug);
      }
      if (entry.plannedContentPackage !== "EXISTING") {
        issues.push({
          code: "EXISTING_PACKAGE",
          message: `EXISTING_APPROVED must use EXISTING package: ${entry.slug}`,
        });
      }
    }
  }

  if (families.size < 35 || families.size > 40) {
    issues.push({
      code: "FAMILY_COUNT",
      message: `Family count ${families.size} outside 35–40`,
    });
  }

  for (const key of LEGACY_GENERATOR_EXERCISE_KEYS) {
    if (!legacyMapped.has(key)) {
      issues.push({
        code: "LEGACY_UNMAPPED",
        message: `Legacy generator exercise not mapped: ${key}`,
      });
    }
  }

  return issues;
}

export function assertWorkoutCatalogManifestValid(
  entries: readonly CatalogManifestEntry[] = WORKOUT_CATALOG_MANIFEST,
): void {
  const issues = validateWorkoutCatalogManifest(entries);
  if (issues.length) {
    throw new Error(
      `WORKOUT_CATALOG_MANIFEST_INVALID: ${issues.map((i) => `${i.code}:${i.message}`).join("; ")}`,
    );
  }
}

export function manifestFamilyCount(
  entries: readonly CatalogManifestEntry[] = WORKOUT_CATALOG_MANIFEST,
): number {
  return new Set(entries.map((e) => e.familySlug)).size;
}

export function manifestStatusCounts(
  entries: readonly CatalogManifestEntry[] = WORKOUT_CATALOG_MANIFEST,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.initialCatalogStatus] = (counts[entry.initialCatalogStatus] ?? 0) + 1;
  }
  return counts;
}
