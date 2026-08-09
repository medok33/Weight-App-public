-- RP2-03B: dirty/debounce state for matrix coverage analysis

CREATE TABLE IF NOT EXISTS "RecipeCoverageDirtyState" (
  "matrixVersion" text PRIMARY KEY,
  "dirtySince" timestamptz NOT NULL DEFAULT now(),
  "nextEligibleRunAt" timestamptz NOT NULL DEFAULT now(),
  "reasonSetJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "affectedSlotIdsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "affectedRecipeVersionIdsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "RecipeCoverageMatrixMeta" (
  "matrixVersion" text PRIMARY KEY,
  "active" boolean NOT NULL DEFAULT false,
  "analyzerVersion" text NOT NULL DEFAULT 'coverage-analyzer/v1',
  "activatedAt" timestamptz,
  "activatedBy" uuid,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "RecipeCoverageMatrixMeta" ("matrixVersion", "active", "activatedAt")
VALUES ('coverage-core-v1', true, now())
ON CONFLICT ("matrixVersion") DO NOTHING;

-- At most one active matrix.
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeCoverageMatrixMeta_one_active_uidx"
  ON "RecipeCoverageMatrixMeta" ((1))
  WHERE "active" = true;
