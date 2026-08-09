-- RP2-03A STEP_209: RecipeCoverageAssignment (evidenced link; does not mutate RecipeVersion)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeCoverageAssignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slotId" uuid NOT NULL REFERENCES "RecipeCoverageSlot"("id") ON DELETE CASCADE,
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "assignmentType" text NOT NULL,
  "matchStatus" text NOT NULL,
  "matchScore" numeric(6,4) NOT NULL DEFAULT 0,
  "reasonsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "contentGroupId" text,
  "assignedBy" uuid,
  "assignedAt" timestamptz NOT NULL DEFAULT now(),
  "analyzedAt" timestamptz NOT NULL DEFAULT now(),
  "active" boolean NOT NULL DEFAULT true,
  CONSTRAINT "RecipeCoverageAssignment_type_check" CHECK ("assignmentType" IN (
    'PRIMARY','SECONDARY','MANUAL_OVERRIDE'
  )),
  CONSTRAINT "RecipeCoverageAssignment_match_check" CHECK ("matchStatus" IN (
    'MATCHED','PARTIAL','NEEDS_REVIEW','EXCLUDED'
  )),
  CONSTRAINT "RecipeCoverageAssignment_score_check" CHECK ("matchScore" >= 0 AND "matchScore" <= 1)
);

-- At most one active PRIMARY per RecipeVersion.
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeCoverageAssignment_one_primary_per_version_uidx"
  ON "RecipeCoverageAssignment" ("recipeVersionId")
  WHERE "active" = true AND "assignmentType" = 'PRIMARY';

-- At most one active PRIMARY of a content group per slot (exact-duplicate collapse).
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeCoverageAssignment_slot_group_primary_uidx"
  ON "RecipeCoverageAssignment" ("slotId", "contentGroupId")
  WHERE "active" = true AND "assignmentType" = 'PRIMARY' AND "contentGroupId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "RecipeCoverageAssignment_slot_version_type_uidx"
  ON "RecipeCoverageAssignment" ("slotId", "recipeVersionId", "assignmentType")
  WHERE "active" = true;

CREATE INDEX IF NOT EXISTS "RecipeCoverageAssignment_slot_idx"
  ON "RecipeCoverageAssignment" ("slotId");
CREATE INDEX IF NOT EXISTS "RecipeCoverageAssignment_version_idx"
  ON "RecipeCoverageAssignment" ("recipeVersionId");
