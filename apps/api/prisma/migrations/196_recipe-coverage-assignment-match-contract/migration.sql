-- RP2-03B: expand assignment matchStatus for analyzer contract (STALE, EXACT_MATCH, PARTIAL_MATCH, …)

ALTER TABLE "RecipeCoverageAssignment"
  DROP CONSTRAINT IF EXISTS "RecipeCoverageAssignment_match_check";

ALTER TABLE "RecipeCoverageAssignment"
  ADD CONSTRAINT "RecipeCoverageAssignment_match_check" CHECK ("matchStatus" IN (
    'MATCHED',
    'PARTIAL',
    'NEEDS_REVIEW',
    'EXCLUDED',
    'EXACT_MATCH',
    'PARTIAL_MATCH',
    'AMBIGUOUS',
    'NO_MATCH',
    'INELIGIBLE',
    'STALE'
  ));

-- Optional cost status column for evidence (nullable for back-compat).
ALTER TABLE "RecipeCoverageAssignment"
  ADD COLUMN IF NOT EXISTS "costStatus" text;

ALTER TABLE "RecipeCoverageAssignment"
  ADD COLUMN IF NOT EXISTS "matchContractJson" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN "RecipeCoverageAssignment"."matchStatus" IS
  'STEP_210: EXACT_MATCH/PARTIAL_MATCH/AMBIGUOUS/STALE preferred; MATCHED/PARTIAL retained for STEP_209 rows';
