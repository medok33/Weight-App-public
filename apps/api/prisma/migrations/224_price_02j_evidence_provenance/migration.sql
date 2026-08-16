-- PRICE-02J: preserve evidence provenance without treating normalization time as acquisition time.
ALTER TABLE "PriceObservation"
  ADD COLUMN IF NOT EXISTS "sourceUrl" text,
  ADD COLUMN IF NOT EXISTS "evidenceSha256" text,
  ADD COLUMN IF NOT EXISTS "acquiredAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "acquisitionTimeQuality" text;

CREATE INDEX IF NOT EXISTS "PriceObservation_evidenceSha256_idx"
  ON "PriceObservation" ("evidenceSha256");
