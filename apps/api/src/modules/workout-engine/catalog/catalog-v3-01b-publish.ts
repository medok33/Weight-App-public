/**
 * CATALOG-V3-01B-PUBLISH — constants for the V3 classification pin/publish bridge.
 * Does not change Generator algorithm. Migration 220 remains ABSENT.
 */
export const CATALOG_V3_01B_PUBLISH_RELEASE_CODE =
  'workout-catalog-v3-01b-publish' as const;

export const CATALOG_V3_01B_PUBLISH_CREATED_BY =
  'system:catalog-v3-01b-publish' as const;

/** Manifest stamp for this release (inventory unchanged; pin revisions carry V3). */
export const CATALOG_V3_01B_PUBLISH_MANIFEST_VERSION =
  'workout-catalog-manifest-v3-01b.1' as const;

export const CATALOG_V3_01B_PUBLISH_VERSION =
  'workout-catalog-v3-01b-publish.1' as const;

/**
 * Advisory lock for disposable publish-bridge apply (distinct from classify 21901001
 * and catalog publish 21000101 used inside the publish SQL step).
 */
export const CATALOG_V3_01B_PUBLISH_ADVISORY_LOCK_KEY = 219_01_002;

/** Expected pin / canonical exercise count for this bridge. */
export const CATALOG_V3_01B_PUBLISH_PIN_COUNT = 84;
