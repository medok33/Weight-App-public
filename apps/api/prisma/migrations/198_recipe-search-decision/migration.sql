-- RP2-03C STEP_211: RecipeSearchDecision gate token (durable + signed)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeSearchDecision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "searchRunId" uuid NOT NULL,
  "coverageSlotId" uuid,
  "matrixVersion" text NOT NULL,
  "recommendation" text NOT NULL,
  "inputChecksum" text NOT NULL,
  "resultChecksum" text NOT NULL,
  "catalogStateChecksum" text NOT NULL,
  "token" text NOT NULL,
  "tokenHash" text NOT NULL,
  "issuedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "usedAt" timestamptz,
  "invalidatedAt" timestamptz,
  "invalidationReason" text,
  "issuedBy" uuid,
  "oneTime" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeSearchDecision_recommendation_check" CHECK ("recommendation" IN (
    'USE_EXISTING_RECIPE',
    'ADJUST_PORTION_OF_EXISTING',
    'ADAPT_EXISTING_RECIPE',
    'CREATE_FAMILY_VARIANT',
    'REVIEW_DUPLICATE_CANDIDATES',
    'RESEARCH_REQUIRED',
    'BLOCKED_NO_SAFE_ACTION'
  )),
  CONSTRAINT "RecipeSearchDecision_run_fk"
    FOREIGN KEY ("searchRunId") REFERENCES "RecipeSearchBeforeGenerateRun"("id") ON DELETE CASCADE,
  CONSTRAINT "RecipeSearchDecision_slot_fk"
    FOREIGN KEY ("coverageSlotId") REFERENCES "RecipeCoverageSlot"("id") ON DELETE SET NULL,
  CONSTRAINT "RecipeSearchDecision_token_hash_unique" UNIQUE ("tokenHash")
);

CREATE INDEX IF NOT EXISTS "RecipeSearchDecision_run_idx"
  ON "RecipeSearchDecision" ("searchRunId");
CREATE INDEX IF NOT EXISTS "RecipeSearchDecision_slot_idx"
  ON "RecipeSearchDecision" ("coverageSlotId", "issuedAt" DESC);
CREATE INDEX IF NOT EXISTS "RecipeSearchDecision_active_idx"
  ON "RecipeSearchDecision" ("expiresAt")
  WHERE "usedAt" IS NULL AND "invalidatedAt" IS NULL;
