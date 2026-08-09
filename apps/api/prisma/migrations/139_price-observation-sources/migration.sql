-- Price Intelligence sources: provenance columns independent of any single retailer/API.
ALTER TABLE "PriceObservation"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'RUB',
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "sourceName" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "retailerId" UUID,
  ADD COLUMN IF NOT EXISTS "collectedAt" TIMESTAMP(3);

UPDATE "PriceObservation"
SET "collectedAt" = "observedAt"
WHERE "collectedAt" IS NULL;

UPDATE "PriceObservation"
SET "sourceType" = CASE
  WHEN lower(source) IN ('csv', 'open_data') THEN 'CSV'
  WHEN lower(source) IN ('retailer', 'api') THEN 'API'
  WHEN lower(source) IN ('parser') THEN 'PARSER'
  WHEN lower(source) IN ('manual', 'unknown') THEN 'MANUAL'
  ELSE COALESCE(NULLIF("sourceType", ''), 'MANUAL')
END
WHERE "sourceType" IS NULL OR "sourceType" = 'MANUAL';

UPDATE "PriceObservation" AS po
SET "retailerId" = rs."retailerId",
    "sourceName" = CASE
      WHEN po."sourceName" IS NULL OR po."sourceName" = 'unknown' THEN COALESCE(r.name, po.source, 'unknown')
      ELSE po."sourceName"
    END
FROM "RetailStore" AS rs
LEFT JOIN "Retailer" AS r ON r.id = rs."retailerId"
WHERE po."storeId" = rs.id
  AND po."retailerId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PriceObservation_retailerId_fkey'
  ) THEN
    ALTER TABLE "PriceObservation"
      ADD CONSTRAINT "PriceObservation_retailerId_fkey"
      FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PriceObservation_productId_collectedAt_idx"
  ON "PriceObservation" ("productId", "collectedAt" DESC);

CREATE INDEX IF NOT EXISTS "PriceObservation_sourceType_collectedAt_idx"
  ON "PriceObservation" ("sourceType", "collectedAt" DESC);
