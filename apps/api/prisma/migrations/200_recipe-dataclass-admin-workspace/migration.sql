-- RP2-03D STEP_212: Recipe editorial dataClass + indexes

ALTER TABLE "Recipe"
  ADD COLUMN IF NOT EXISTS "dataClass" text NOT NULL DEFAULT 'PRODUCTION';

ALTER TABLE "Recipe"
  DROP CONSTRAINT IF EXISTS "Recipe_dataClass_check";

ALTER TABLE "Recipe"
  ADD CONSTRAINT "Recipe_dataClass_check" CHECK ("dataClass" IN (
    'PRODUCTION',
    'TEST_ONLY',
    'FIXTURE',
    'HISTORICAL_ONLY',
    'LEGACY',
    'ARCHIVED_DATA'
  ));

CREATE INDEX IF NOT EXISTS "Recipe_dataClass_updated_idx"
  ON "Recipe" ("dataClass", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Recipe_dataClass_name_idx"
  ON "Recipe" ("dataClass", "name");

-- Backfill from recipeKey / provenance patterns (not display name alone).
UPDATE "Recipe" r
SET "dataClass" = 'TEST_ONLY'
WHERE r."dataClass" = 'PRODUCTION'
  AND r."recipeKey" IS NOT NULL
  AND (
    lower(r."recipeKey") ~ '^(cust_|hist_|rp2|rp202|csv_|clone_|e2e_|test_)'
    OR lower(r."recipeKey") LIKE '%_e2e_%'
    OR lower(r."recipeKey") LIKE '%_test_%'
  );

UPDATE "Recipe" r
SET "dataClass" = 'HISTORICAL_ONLY'
WHERE r."dataClass" = 'TEST_ONLY'
  AND r."recipeKey" IS NOT NULL
  AND lower(r."recipeKey") ~ '^hist_';

UPDATE "Recipe" r
SET "dataClass" = 'FIXTURE'
WHERE r."dataClass" = 'PRODUCTION'
  AND r."recipeKey" IS NOT NULL
  AND (
    lower(r."recipeKey") LIKE '%fixture%'
    OR lower(r."recipeKey") LIKE 'step092%'
    OR lower(r."recipeKey") LIKE 'step093%'
  );

-- Legacy shells without recipeKey remain PRODUCTION unless only historical versions exist.
UPDATE "Recipe" r
SET "dataClass" = 'LEGACY'
WHERE r."dataClass" = 'PRODUCTION'
  AND r."recipeKey" IS NULL
  AND EXISTS (
    SELECT 1 FROM "RecipeVersion" v
    WHERE v."recipeId" = r.id
      AND lower(COALESCE(v.provenance, '')) IN ('legacy', 'backfill', 'system_backfill')
  );
