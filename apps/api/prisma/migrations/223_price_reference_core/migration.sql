-- PRICE-01A dependable reference-price core. 223 is intentionally after main's
-- current 221 and does not include the reserved Assistant Brain migration 222.
ALTER TABLE "RetailStore"
  ADD COLUMN IF NOT EXISTS "city" text,
  ADD COLUMN IF NOT EXISTS "address" text,
  ADD COLUMN IF NOT EXISTS "externalStoreId" text,
  ADD COLUMN IF NOT EXISTS "locationScope" text NOT NULL DEFAULT 'REGION';

CREATE UNIQUE INDEX IF NOT EXISTS "RetailStore_retailerId_externalStoreId_uidx"
  ON "RetailStore" ("retailerId", "externalStoreId")
  WHERE "externalStoreId" IS NOT NULL;

ALTER TABLE "RetailProduct" DROP CONSTRAINT IF EXISTS "RetailProduct_mappingStatus_check";
ALTER TABLE "RetailProduct" ADD CONSTRAINT "RetailProduct_mappingStatus_check"
  CHECK ("mappingStatus" IN ('MAPPED', 'UNMAPPED', 'AMBIGUOUS', 'NEEDS_PRODUCT_MAPPING'));

ALTER TABLE "PriceObservation"
  ADD COLUMN IF NOT EXISTS "observationKey" text,
  ADD COLUMN IF NOT EXISTS "normalizedPackageQuantity" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "normalizedPackageUnit" text,
  ADD COLUMN IF NOT EXISTS "unitPrice" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "unitPriceUnit" text,
  ADD COLUMN IF NOT EXISTS "priceCondition" text NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS "regularPrice" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "conditionDescription" text,
  ADD COLUMN IF NOT EXISTS "validFrom" timestamptz,
  ADD COLUMN IF NOT EXISTS "validTo" timestamptz,
  ADD COLUMN IF NOT EXISTS "loyaltyRequired" boolean,
  ADD COLUMN IF NOT EXISTS "quantityRequirement" numeric(12,4);

UPDATE "PriceObservation"
SET "observationKey" = md5(concat_ws('|', "productId", "storeId", "sourceType", "sourceName", "price", "observedAt", "source", id::text))
WHERE "observationKey" IS NULL;
ALTER TABLE "PriceObservation" ALTER COLUMN "observationKey" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "PriceObservation_observationKey_uidx"
  ON "PriceObservation" ("observationKey");

ALTER TABLE "PriceSnapshot"
  ADD COLUMN IF NOT EXISTS "retailerId" uuid,
  ADD COLUMN IF NOT EXISTS "storeId" uuid,
  ADD COLUMN IF NOT EXISTS "evidenceObservationId" uuid,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'CURRENT',
  ADD COLUMN IF NOT EXISTS "freshUntil" timestamptz,
  ADD COLUMN IF NOT EXISTS "normalizedPackageQuantity" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "normalizedPackageUnit" text,
  ADD COLUMN IF NOT EXISTS "unitPrice" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "unitPriceUnit" text,
  ADD COLUMN IF NOT EXISTS "priceCondition" text NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS "sourceType" text,
  ADD COLUMN IF NOT EXISTS "sourceName" text;

ALTER TABLE "PriceObservation" DROP CONSTRAINT IF EXISTS "PriceObservation_priceCondition_check";
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_priceCondition_check"
  CHECK ("priceCondition" IN ('REGULAR', 'PROMOTIONAL', 'LOYALTY_ONLY', 'CONDITIONAL', 'UNKNOWN_CONDITION'));
ALTER TABLE "PriceSnapshot" DROP CONSTRAINT IF EXISTS "PriceSnapshot_status_check";
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_status_check"
  CHECK ("status" IN ('CURRENT', 'STALE', 'UNKNOWN', 'APPROXIMATE'));
ALTER TABLE "PriceSnapshot" DROP CONSTRAINT IF EXISTS "PriceSnapshot_priceCondition_check";
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_priceCondition_check"
  CHECK ("priceCondition" IN ('REGULAR', 'PROMOTIONAL', 'LOYALTY_ONLY', 'CONDITIONAL', 'UNKNOWN_CONDITION'));

CREATE INDEX IF NOT EXISTS "PriceObservation_product_store_collected_idx"
  ON "PriceObservation" ("productId", "storeId", "collectedAt" DESC);
CREATE INDEX IF NOT EXISTS "PriceObservation_priceCondition_valid_idx"
  ON "PriceObservation" ("priceCondition", "validTo");

INSERT INTO "Retailer" ("key", code, name, type, region, active)
VALUES
  ('lenta', 'LENTA', 'Лента', 'HYPERMARKET', 'RU', true),
  ('perekrestok', 'PEREKRESTOK', 'Перекрёсток', 'CHAIN', 'RU', true),
  ('chizhik', 'CHIZHIK', 'Чижик', 'DISCOUNTER', 'RU', true),
  ('yarche', 'YARCHE', 'Ярче', 'DISCOUNTER', 'RU', true)
ON CONFLICT (code) DO NOTHING;
