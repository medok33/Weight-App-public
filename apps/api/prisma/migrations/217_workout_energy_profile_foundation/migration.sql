-- 217: WORKOUT-ENERGY-01A exercise energy profile foundation
-- Additive. Does not amend 1–216. Safe to re-run (IF NOT EXISTS).
-- Schema only — no MET backfill, no ExerciseRevision mutation,
-- no WorkoutSession / WorkoutSessionExercise changes.
-- Not applied to shared/staging/production in this package.

CREATE TABLE IF NOT EXISTS "ExerciseEnergyProfile" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseRevisionId" uuid NOT NULL
    REFERENCES "ExerciseRevision"(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  "calculationMethod" text NOT NULL
    CHECK ("calculationMethod" IN ('MET_DURATION')),
  "populationType" text NOT NULL
    CHECK ("populationType" IN ('ADULT_STANDARD_2024')),
  "compendiumEdition" text NOT NULL
    CHECK ("compendiumEdition" IN ('ADULT_2024')),
  "compendiumCode" text NOT NULL
    CHECK (char_length(trim("compendiumCode")) >= 4),
  "metValue" numeric(6,3) NOT NULL
    CHECK ("metValue" > 0 AND "metValue" <= 30),
  "sourceType" text NOT NULL
    CHECK ("sourceType" IN ('COMPENDIUM_ADULT_2024')),
  "sourceReference" text NOT NULL
    CHECK (char_length(trim("sourceReference")) > 0),
  "sourceVersion" text NOT NULL
    CHECK (char_length(trim("sourceVersion")) > 0),
  "policyVersion" text NOT NULL
    CHECK (char_length(trim("policyVersion")) > 0),
  "enabledForCalculation" boolean NOT NULL DEFAULT false,
  "reviewedAt" timestamptz,
  "reviewedBy" text,
  "approvedAt" timestamptz,
  "retiredAt" timestamptz,
  "retirementReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseEnergyProfile_approved_review_chk" CHECK (
    status <> 'APPROVED'
    OR (
      "reviewedAt" IS NOT NULL
      AND "reviewedBy" IS NOT NULL
      AND char_length(trim("reviewedBy")) > 0
      AND "approvedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "ExerciseEnergyProfile_enabled_approved_chk" CHECK (
    "enabledForCalculation" = false OR status = 'APPROVED'
  ),
  CONSTRAINT "ExerciseEnergyProfile_retired_at_chk" CHECK (
    status <> 'RETIRED' OR "retiredAt" IS NOT NULL
  )
);

-- One non-retired profile per revision + policy lineage.
CREATE UNIQUE INDEX IF NOT EXISTS "ExerciseEnergyProfile_revision_policy_active_uidx"
  ON "ExerciseEnergyProfile" ("exerciseRevisionId", "policyVersion")
  WHERE status IN ('DRAFT', 'APPROVED');

CREATE INDEX IF NOT EXISTS "ExerciseEnergyProfile_revision_idx"
  ON "ExerciseEnergyProfile" ("exerciseRevisionId");

CREATE INDEX IF NOT EXISTS "ExerciseEnergyProfile_status_idx"
  ON "ExerciseEnergyProfile" (status);

CREATE INDEX IF NOT EXISTS "ExerciseEnergyProfile_runtime_idx"
  ON "ExerciseEnergyProfile" ("exerciseRevisionId", "policyVersion")
  WHERE status = 'APPROVED' AND "enabledForCalculation" = true;
