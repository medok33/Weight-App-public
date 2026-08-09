-- RP2-03C Phase 0: price dataClass hygiene + controlled profile structure

-- 1) PriceObservation.dataClass
ALTER TABLE "PriceObservation"
  ADD COLUMN IF NOT EXISTS "dataClass" text NOT NULL DEFAULT 'PRODUCTION';

ALTER TABLE "PriceObservation"
  DROP CONSTRAINT IF EXISTS "PriceObservation_dataClass_check";

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_dataClass_check" CHECK ("dataClass" IN (
    'PRODUCTION', 'TEST_ONLY', 'FIXTURE', 'HISTORICAL_TEST'
  ));

CREATE INDEX IF NOT EXISTS "PriceObservation_dataClass_collected_idx"
  ON "PriceObservation" ("dataClass", "collectedAt" DESC);

-- Backfill fixture/test observations from persisted source/provenance (not display-name alone).
UPDATE "PriceObservation" po
SET "dataClass" = 'FIXTURE'
WHERE po."dataClass" = 'PRODUCTION'
  AND (
    lower(po.source) IN ('step092_fixture', 'fixture', 'test_fixture')
    OR lower(po."sourceName") LIKE '%step092%'
    OR lower(po."sourceName") LIKE '%fixture%'
    OR EXISTS (
      SELECT 1 FROM "RetailProduct" rp
      WHERE rp.id = po."retailProductId" AND rp.source = 'FIXTURE'
    )
    OR EXISTS (
      SELECT 1 FROM "Retailer" r
      WHERE r.id = COALESCE(po."retailerId", (SELECT rp2."retailerId" FROM "RetailProduct" rp2 WHERE rp2.id = po."retailProductId"))
        AND (
          lower(r.code) IN ('step092_fixture', 'fixture', 'test')
          OR lower(COALESCE(r.key, '')) IN ('step092_fixture', 'fixture')
        )
    )
  );

UPDATE "PriceObservation" po
SET "dataClass" = 'TEST_ONLY'
WHERE po."dataClass" = 'PRODUCTION'
  AND (
    lower(po.source) LIKE 'e2e%'
    OR lower(po.source) LIKE 'test%'
    OR lower(po."sourceName") LIKE '%e2e%'
    OR lower(po."sourceName") LIKE 'test %'
    OR lower(po."sourceName") LIKE '% test'
  );

-- 2) Controlled profile structure (legacy free-text columns retained)
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "allergenCodesJson" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "dietaryCodesJson" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "intoleranceCodesJson" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "preferredProductIdsJson" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "dislikedProductIdsJson" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "equipmentCodesJson" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "profileStructureStatus" text NOT NULL DEFAULT 'LEGACY_UNSTRUCTURED';

ALTER TABLE "UserProfile"
  DROP CONSTRAINT IF EXISTS "UserProfile_profileStructureStatus_check";

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_profileStructureStatus_check" CHECK (
    "profileStructureStatus" IN ('STRUCTURED', 'LEGACY_UNSTRUCTURED', 'MIXED', 'NEEDS_CONFIRMATION')
  );

-- Mark existing free-text profiles as legacy (do not auto-interpret as hard filters).
UPDATE "UserProfile"
SET "profileStructureStatus" = 'LEGACY_UNSTRUCTURED'
WHERE COALESCE(NULLIF(trim("dietaryPreferences"), ''), NULLIF(trim("foodRestrictions"), ''), NULLIF(trim("availableEquipment"), '')) IS NOT NULL
  AND "profileStructureStatus" = 'LEGACY_UNSTRUCTURED';
