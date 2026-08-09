-- RP2-03B STEP_210: RecipeCoverageAnalysisRun ledger

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeCoverageAnalysisRun" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "matrixVersion" text NOT NULL,
  "mode" text NOT NULL,
  "triggerType" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "dryRun" boolean NOT NULL DEFAULT false,
  "inputChecksum" text,
  "resultChecksum" text,
  "requestedBy" uuid,
  "startedAt" timestamptz,
  "completedAt" timestamptz,
  "durationMs" integer,
  "slotCount" integer NOT NULL DEFAULT 0,
  "eligibleRecipeCount" integer NOT NULL DEFAULT 0,
  "comparisonCount" integer NOT NULL DEFAULT 0,
  "resultJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "errorCode" text,
  "errorSummary" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeCoverageAnalysisRun_mode_check" CHECK ("mode" IN (
    'FULL', 'INCREMENTAL_SLOTS', 'INCREMENTAL_RECIPES'
  )),
  CONSTRAINT "RecipeCoverageAnalysisRun_status_check" CHECK ("status" IN (
    'QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'
  )),
  CONSTRAINT "RecipeCoverageAnalysisRun_trigger_check" CHECK ("triggerType" IN (
    'MANUAL', 'SCHEDULED', 'DIRTY_QUEUE', 'SYSTEM', 'SEED'
  ))
);

CREATE INDEX IF NOT EXISTS "RecipeCoverageAnalysisRun_matrix_created_idx"
  ON "RecipeCoverageAnalysisRun" ("matrixVersion", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "RecipeCoverageAnalysisRun_status_idx"
  ON "RecipeCoverageAnalysisRun" ("status") WHERE "status" IN ('QUEUED', 'RUNNING');
