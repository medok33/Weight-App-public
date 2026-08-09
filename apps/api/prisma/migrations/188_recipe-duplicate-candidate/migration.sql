-- RP2-02C STEP_207: durable RecipeDuplicateCandidate pairs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeDuplicateCandidate" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "leftRecipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "rightRecipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "fingerprintSchemaVersion" text NOT NULL,
  "classification" text NOT NULL,
  "score" numeric(6,4) NOT NULL,
  "reasonsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'OPEN',
  "detectedAt" timestamptz NOT NULL DEFAULT now(),
  "lastEvaluatedAt" timestamptz NOT NULL DEFAULT now(),
  "reviewedAt" timestamptz,
  "reviewedBy" uuid,
  "resolutionCode" text,
  "resolutionNote" text,
  "pairKey" text NOT NULL,
  CONSTRAINT "RecipeDuplicateCandidate_pair_order_check" CHECK ("leftRecipeVersionId" < "rightRecipeVersionId"),
  CONSTRAINT "RecipeDuplicateCandidate_classification_check" CHECK ("classification" IN (
    'EXACT_DUPLICATE', 'NEAR_DUPLICATE', 'FAMILY_VARIANT', 'POSSIBLE_DUPLICATE', 'DISTINCT'
  )),
  CONSTRAINT "RecipeDuplicateCandidate_status_check" CHECK ("status" IN (
    'OPEN', 'CONFIRMED_DUPLICATE', 'CONFIRMED_VARIANT', 'DISMISSED', 'RESOLVED'
  )),
  CONSTRAINT "RecipeDuplicateCandidate_score_check" CHECK ("score" >= 0 AND "score" <= 1),
  CONSTRAINT "RecipeDuplicateCandidate_pair_schema_key" UNIQUE ("pairKey", "fingerprintSchemaVersion")
);

CREATE INDEX IF NOT EXISTS "RecipeDuplicateCandidate_status_class_idx"
  ON "RecipeDuplicateCandidate" ("status", "classification");
CREATE INDEX IF NOT EXISTS "RecipeDuplicateCandidate_left_idx"
  ON "RecipeDuplicateCandidate" ("leftRecipeVersionId");
CREATE INDEX IF NOT EXISTS "RecipeDuplicateCandidate_right_idx"
  ON "RecipeDuplicateCandidate" ("rightRecipeVersionId");
CREATE INDEX IF NOT EXISTS "RecipeDuplicateCandidate_score_idx"
  ON "RecipeDuplicateCandidate" ("score" DESC);
