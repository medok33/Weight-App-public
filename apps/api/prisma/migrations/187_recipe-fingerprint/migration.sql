-- RP2-02C STEP_207: RecipeFingerprint (immutable snapshot derived, versioned algorithm).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeFingerprint" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "fingerprintSchemaVersion" text NOT NULL,
  "exactContentHash" text NOT NULL,
  "ingredientSetHash" text NOT NULL,
  "ingredientQuantityHash" text NOT NULL,
  "cookingStructureHash" text NOT NULL,
  "titleNormalizationHash" text NOT NULL,
  "familyFeatureHash" text,
  "normalizedFeaturesJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "checksum" text NOT NULL,
  "confidence" text NOT NULL DEFAULT 'HIGH',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeFingerprint_schema_check" CHECK ("fingerprintSchemaVersion" <> ''),
  CONSTRAINT "RecipeFingerprint_confidence_check" CHECK ("confidence" IN ('HIGH', 'MEDIUM', 'LOW')),
  CONSTRAINT "RecipeFingerprint_version_schema_key" UNIQUE ("recipeVersionId", "fingerprintSchemaVersion")
);

CREATE INDEX IF NOT EXISTS "RecipeFingerprint_exactContentHash_idx"
  ON "RecipeFingerprint" ("fingerprintSchemaVersion", "exactContentHash");
CREATE INDEX IF NOT EXISTS "RecipeFingerprint_ingredientSetHash_idx"
  ON "RecipeFingerprint" ("fingerprintSchemaVersion", "ingredientSetHash");
CREATE INDEX IF NOT EXISTS "RecipeFingerprint_familyFeatureHash_idx"
  ON "RecipeFingerprint" ("fingerprintSchemaVersion", "familyFeatureHash");
