-- RP2-01B STEP_199: RetailProduct + PriceObservation.retailProductId
-- Path B: new RetailProduct; ExternalProduct/ProductMatch remain compatibility layer.

CREATE TABLE IF NOT EXISTS "RetailProduct" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "retailerId" uuid NOT NULL REFERENCES "Retailer"("id") ON DELETE RESTRICT,
  "canonicalProductId" uuid REFERENCES "Product"("id") ON DELETE RESTRICT,
  "externalSku" text,
  "title" text NOT NULL,
  "brand" text,
  "packageWeight" numeric(12,4),
  "packageUnit" text,
  "packageQuantity" numeric(12,4),
  "barcode" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "mappingStatus" text NOT NULL DEFAULT 'NEEDS_PRODUCT_MAPPING',
  "source" text NOT NULL DEFAULT 'LEGACY_BACKFILL',
  "externalProductId" uuid REFERENCES "ExternalProduct"("id") ON DELETE SET NULL,
  "lastMatchedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RetailProduct_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'MERGED', 'ARCHIVED')),
  CONSTRAINT "RetailProduct_mappingStatus_check" CHECK ("mappingStatus" IN ('MAPPED', 'NEEDS_PRODUCT_MAPPING')),
  CONSTRAINT "RetailProduct_source_check" CHECK ("source" IN (
    'LEGACY_BACKFILL', 'IMPORT', 'MANUAL', 'FIXTURE', 'SYSTEM', 'PRODUCT_MATCH'
  )),
  CONSTRAINT "RetailProduct_packageWeight_check" CHECK ("packageWeight" IS NULL OR "packageWeight" > 0),
  CONSTRAINT "RetailProduct_packageQuantity_check" CHECK ("packageQuantity" IS NULL OR "packageQuantity" > 0),
  CONSTRAINT "RetailProduct_mapped_requires_product" CHECK (
    "mappingStatus" <> 'MAPPED' OR "canonicalProductId" IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "RetailProduct_retailerId_externalSku_uidx"
  ON "RetailProduct" ("retailerId", "externalSku")
  WHERE "externalSku" IS NOT NULL AND "status" <> 'MERGED';

CREATE UNIQUE INDEX IF NOT EXISTS "RetailProduct_externalProductId_uidx"
  ON "RetailProduct" ("externalProductId")
  WHERE "externalProductId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "RetailProduct_canonicalProductId_idx"
  ON "RetailProduct" ("canonicalProductId")
  WHERE "canonicalProductId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "RetailProduct_retailerId_status_idx"
  ON "RetailProduct" ("retailerId", "status");

ALTER TABLE "PriceObservation"
  ADD COLUMN IF NOT EXISTS "retailProductId" uuid,
  ADD COLUMN IF NOT EXISTS "observedPackageWeight" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "observedPackageUnit" text,
  ADD COLUMN IF NOT EXISTS "availability" text,
  ADD COLUMN IF NOT EXISTS "confidence" numeric(5,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PriceObservation_retailProductId_fkey'
  ) THEN
    ALTER TABLE "PriceObservation"
      ADD CONSTRAINT "PriceObservation_retailProductId_fkey"
      FOREIGN KEY ("retailProductId") REFERENCES "RetailProduct"("id") ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE "PriceObservation" DROP CONSTRAINT IF EXISTS "PriceObservation_observedPackageWeight_check";
ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_observedPackageWeight_check"
  CHECK ("observedPackageWeight" IS NULL OR "observedPackageWeight" > 0);

ALTER TABLE "PriceObservation" DROP CONSTRAINT IF EXISTS "PriceObservation_confidence_check";
ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_confidence_check"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "PriceObservation" DROP CONSTRAINT IF EXISTS "PriceObservation_availability_check";
ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_availability_check"
  CHECK ("availability" IS NULL OR "availability" IN ('IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS "PriceObservation_retailProductId_collectedAt_idx"
  ON "PriceObservation" ("retailProductId", "collectedAt" DESC)
  WHERE "retailProductId" IS NOT NULL;

-- Backfill RetailProduct from ExternalProduct + ProductMatch (deterministic).
INSERT INTO "RetailProduct" (
  "retailerId", "canonicalProductId", "externalSku", "title",
  "packageWeight", "packageUnit", "status", "mappingStatus",
  "source", "externalProductId", "lastMatchedAt"
)
SELECT
  ep."retailerId",
  pm."productId",
  ep."externalId",
  ep.name,
  p."packageSize",
  p."packageUnit",
  'ACTIVE',
  'MAPPED',
  'PRODUCT_MATCH',
  ep.id,
  now()
FROM "ExternalProduct" ep
JOIN "ProductMatch" pm ON pm."externalProductId" = ep.id
JOIN "Product" p ON p.id = pm."productId"
WHERE NOT EXISTS (
  SELECT 1 FROM "RetailProduct" rp WHERE rp."externalProductId" = ep.id
)
  AND NOT EXISTS (
    SELECT 1 FROM "RetailProduct" rp
    WHERE rp."retailerId" = ep."retailerId"
      AND rp."externalSku" IS NOT DISTINCT FROM ep."externalId"
      AND rp.status <> 'MERGED'
  );

-- Link PriceObservation → RetailProduct only when exactly one mapped SKU matches product(+retailer).
UPDATE "PriceObservation" po
SET "retailProductId" = rp.id,
    "observedPackageWeight" = COALESCE(po."observedPackageWeight", rp."packageWeight"),
    "observedPackageUnit" = COALESCE(po."observedPackageUnit", rp."packageUnit")
FROM "RetailProduct" rp
WHERE po."retailProductId" IS NULL
  AND rp."canonicalProductId" = po."productId"
  AND rp."mappingStatus" = 'MAPPED'
  AND rp."status" = 'ACTIVE'
  AND (
    po."retailerId" IS NULL
    OR rp."retailerId" = po."retailerId"
  )
  AND (
    SELECT count(*) FROM "RetailProduct" rp2
    WHERE rp2."canonicalProductId" = po."productId"
      AND rp2."status" = 'ACTIVE'
      AND rp2."mappingStatus" = 'MAPPED'
      AND (po."retailerId" IS NULL OR rp2."retailerId" = po."retailerId")
  ) = 1;

-- ExternalProduct without ProductMatch → NEEDS_PRODUCT_MAPPING (no invented canonical).
INSERT INTO "RetailProduct" (
  "retailerId", "canonicalProductId", "externalSku", "title",
  "status", "mappingStatus", "source", "externalProductId"
)
SELECT
  ep."retailerId",
  NULL,
  ep."externalId",
  ep.name,
  'ACTIVE',
  'NEEDS_PRODUCT_MAPPING',
  'LEGACY_BACKFILL',
  ep.id
FROM "ExternalProduct" ep
WHERE NOT EXISTS (SELECT 1 FROM "ProductMatch" pm WHERE pm."externalProductId" = ep.id)
  AND NOT EXISTS (SELECT 1 FROM "RetailProduct" rp WHERE rp."externalProductId" = ep.id)
  AND NOT EXISTS (
    SELECT 1 FROM "RetailProduct" rp
    WHERE rp."retailerId" = ep."retailerId"
      AND rp."externalSku" IS NOT DISTINCT FROM ep."externalId"
      AND rp.status <> 'MERGED'
  );
