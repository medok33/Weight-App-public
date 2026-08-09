-- RP2-01C2A STEP_201 phase A: CatalogSeedBatch ledger + Product seed provenance.
-- Does not modify migrations 001–178.

CREATE TABLE IF NOT EXISTS "CatalogSeedBatch" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "datasetVersion" text NOT NULL,
  "checksum" text NOT NULL,
  "productCount" integer NOT NULL,
  "status" text NOT NULL,
  "appliedAt" timestamptz NOT NULL DEFAULT now(),
  "durationMs" integer NOT NULL DEFAULT 0,
  "resultJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "CatalogSeedBatch_productCount_check" CHECK ("productCount" >= 0),
  CONSTRAINT "CatalogSeedBatch_durationMs_check" CHECK ("durationMs" >= 0),
  CONSTRAINT "CatalogSeedBatch_status_check" CHECK (
    "status" IN ('APPLIED', 'NO_OP', 'FAILED', 'BLOCKED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogSeedBatch_datasetVersion_uidx"
  ON "CatalogSeedBatch" ("datasetVersion");

CREATE INDEX IF NOT EXISTS "CatalogSeedBatch_appliedAt_idx"
  ON "CatalogSeedBatch" ("appliedAt" DESC);

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "seedDatasetVersion" text,
  ADD COLUMN IF NOT EXISTS "seedProvenance" jsonb;

CREATE INDEX IF NOT EXISTS "Product_seedDatasetVersion_idx"
  ON "Product" ("seedDatasetVersion")
  WHERE "seedDatasetVersion" IS NOT NULL;
