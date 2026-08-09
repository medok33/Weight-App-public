-- RP2-03C STEP_211: RecipeSearchBeforeGenerateRun ledger

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeSearchBeforeGenerateRun" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "matrixVersion" text NOT NULL,
  "coverageSlotId" uuid,
  "searchSchemaVersion" text NOT NULL,
  "requestType" text NOT NULL,
  "inputChecksum" text NOT NULL,
  "status" text NOT NULL DEFAULT 'RUNNING',
  "requestedBy" uuid,
  "reason" text NOT NULL,
  "resultJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "resultChecksum" text,
  "expiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz,
  "durationMs" integer,
  "errorCode" text,
  "errorSummary" text,
  CONSTRAINT "RecipeSearchBeforeGenerateRun_requestType_check" CHECK ("requestType" IN (
    'COVERAGE_SLOT_REVIEW',
    'NEW_RECIPE_PREFLIGHT',
    'VARIANT_PREFLIGHT',
    'RESEARCH_PREFLIGHT',
    'MANUAL_OWNER_SEARCH'
  )),
  CONSTRAINT "RecipeSearchBeforeGenerateRun_status_check" CHECK ("status" IN (
    'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED', 'SUPERSEDED'
  )),
  CONSTRAINT "RecipeSearchBeforeGenerateRun_slot_fk"
    FOREIGN KEY ("coverageSlotId") REFERENCES "RecipeCoverageSlot"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "RecipeSearchBeforeGenerateRun_slot_created_idx"
  ON "RecipeSearchBeforeGenerateRun" ("coverageSlotId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "RecipeSearchBeforeGenerateRun_matrix_created_idx"
  ON "RecipeSearchBeforeGenerateRun" ("matrixVersion", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "RecipeSearchBeforeGenerateRun_status_idx"
  ON "RecipeSearchBeforeGenerateRun" ("status") WHERE "status" = 'RUNNING';
CREATE INDEX IF NOT EXISTS "RecipeSearchBeforeGenerateRun_input_idx"
  ON "RecipeSearchBeforeGenerateRun" ("inputChecksum");
