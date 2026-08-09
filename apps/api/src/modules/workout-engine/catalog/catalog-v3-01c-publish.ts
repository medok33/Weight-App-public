/**
 * CATALOG-V3-01C-PUBLISH-BRIDGE — constants for the 156-pin DRAFT release candidate.
 * Does NOT activate / PUBLISH the candidate (Generator still reads current PUBLISHED).
 * Migration 220 remains ABSENT. Readiness is never fabricated.
 */
export const CATALOG_V3_01C_PUBLISH_RELEASE_CODE =
  'workout-catalog-v3-01c-candidate' as const;

export const CATALOG_V3_01C_PUBLISH_CREATED_BY =
  'system:catalog-v3-01c-publish-bridge' as const;

export const CATALOG_V3_01C_PUBLISH_MANIFEST_VERSION =
  'workout-catalog-manifest-v3-01c.1' as const;

export const CATALOG_V3_01C_PUBLISH_VERSION =
  'workout-catalog-v3-01c-publish-bridge.1' as const;

/**
 * Advisory lock for disposable candidate apply (distinct from classify / 01B publish /
 * Batch A / Batch B / catalog publish locks).
 */
export const CATALOG_V3_01C_PUBLISH_ADVISORY_LOCK_KEY = 219_01_005;

/** Quality-complete Catalog V3 active canonical set. */
export const CATALOG_V3_01C_PUBLISH_PIN_COUNT = 156;

/** Published runtime pin set that must remain unchanged by this bridge. */
export const CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT = 84;

/** Keys that must never appear on the candidate pin set. */
export const CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS = [
  'machine_chest_fly',
  'glute_bridge_march_hold',
  'ankle_mobility_knee_over_toe',
  'tibialis_raise',
  'lat_pulldown_wide',
] as const;
