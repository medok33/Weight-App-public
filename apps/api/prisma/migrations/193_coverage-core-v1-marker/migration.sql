-- RP2-03A: coverage-core-v1 seed is applied by application service (productKey resolution).
-- Marker ensures migration ledger entry; repeated apply is no-op.

CREATE TABLE IF NOT EXISTS "RecipePlatformBackfillMarker" (
  "id" text PRIMARY KEY,
  "packageCode" text NOT NULL,
  "note" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "RecipePlatformBackfillMarker" ("id", "packageCode", "note")
VALUES (
  'RP2_03A_COVERAGE_CORE_V1_MARKER',
  'RP2-03A',
  'Seed coverage-core-v1 via RecipeCoverageService.seedMatrixV1 (idempotent).'
)
ON CONFLICT ("id") DO NOTHING;

SELECT 1;
