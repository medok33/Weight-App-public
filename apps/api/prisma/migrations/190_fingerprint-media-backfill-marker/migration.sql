-- RP2-02C backfill: fingerprints for existing RecipeVersion rows.
-- Does NOT mutate RecipeVersion checksum/content.
-- Media backfill is a no-op when no legacy image columns exist (current schema).
-- Fingerprint rows for existing versions are created by application backfill job
-- (deterministic SQL hash is insufficient for full algorithm); this migration only
-- records a ledger marker table for reproducibility of the media scan.

CREATE TABLE IF NOT EXISTS "RecipePlatformBackfillMarker" (
  "id" text PRIMARY KEY,
  "packageCode" text NOT NULL,
  "note" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "RecipePlatformBackfillMarker" ("id", "packageCode", "note")
VALUES (
  'RP2_02C_MEDIA_SCAN_V1',
  'RP2-02C',
  'No legacy Recipe image columns found; MediaAsset backfill deferred to app report (0 assets).'
)
ON CONFLICT ("id") DO NOTHING;

-- Placeholder ensures migration is not empty and is idempotent.
SELECT 1;
