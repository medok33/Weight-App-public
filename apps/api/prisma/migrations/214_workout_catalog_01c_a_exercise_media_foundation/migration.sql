-- 214: WORKOUT-CATALOG-01C-A exercise media foundation (+ FIX1 readiness)
-- Evolves existing ExerciseMedia (does not create a duplicate table).
-- Additive. Does not amend 208–213. Safe to re-run.
-- Not applied to staging/production/shared DB before FIX1 amend.

-- ---------------------------------------------------------------------------
-- A. Metadata columns for versioned revision media assets
-- ---------------------------------------------------------------------------
ALTER TABLE "ExerciseMedia"
  ADD COLUMN IF NOT EXISTS "mimeType" text,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS "promptHash" text,
  ADD COLUMN IF NOT EXISTS "characterProfileKey" text,
  ADD COLUMN IF NOT EXISTS "visualStyleKey" text,
  ADD COLUMN IF NOT EXISTS "outfitProfileKey" text,
  ADD COLUMN IF NOT EXISTS "backgroundProfileKey" text,
  ADD COLUMN IF NOT EXISTS "approvedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "retiredAt" timestamptz;

-- ---------------------------------------------------------------------------
-- B. Expand role / status checks for 01C-A roles and lifecycle
-- Keep legacy cover/technique_step and draft/active/archived for compatibility.
-- ---------------------------------------------------------------------------
ALTER TABLE "ExerciseMedia" DROP CONSTRAINT IF EXISTS "ExerciseMedia_role_check";
ALTER TABLE "ExerciseMedia"
  ADD CONSTRAINT "ExerciseMedia_role_check"
  CHECK (role IN (
    'cover',
    'technique_step',
    'START_POSITION',
    'END_POSITION',
    'MUSCLE_MAP'
  ));

ALTER TABLE "ExerciseMedia" DROP CONSTRAINT IF EXISTS "ExerciseMedia_status_check";
ALTER TABLE "ExerciseMedia"
  ADD CONSTRAINT "ExerciseMedia_status_check"
  CHECK (status IN (
    'draft',
    'active',
    'archived',
    'DRAFT',
    'APPROVED',
    'RETIRED'
  ));

ALTER TABLE "ExerciseMedia" ALTER COLUMN status SET DEFAULT 'DRAFT';

-- ---------------------------------------------------------------------------
-- C. At most one APPROVED asset per (revision, foundation role)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ExerciseMedia_revision_role_approved_uidx"
  ON "ExerciseMedia" ("revisionId", role)
  WHERE status = 'APPROVED'
    AND "revisionId" IS NOT NULL
    AND role IN ('START_POSITION', 'END_POSITION', 'MUSCLE_MAP');

CREATE INDEX IF NOT EXISTS "ExerciseMedia_revision_status_idx"
  ON "ExerciseMedia" ("revisionId", status);
