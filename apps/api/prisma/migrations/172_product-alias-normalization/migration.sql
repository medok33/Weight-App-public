-- RP2-01A STEP_195: ProductAlias normalization columns + backfill

ALTER TABLE "ProductAlias"
  ADD COLUMN IF NOT EXISTS "normalizedAlias" text,
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'LEGACY_BACKFILL',
  ADD COLUMN IF NOT EXISTS "confidence" numeric(5,4) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now();

ALTER TABLE "ProductAlias" DROP CONSTRAINT IF EXISTS "ProductAlias_confidence_check";
ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_confidence_check"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "ProductAlias" DROP CONSTRAINT IF EXISTS "ProductAlias_status_check";
ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_status_check"
  CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'REJECTED'));

ALTER TABLE "ProductAlias" DROP CONSTRAINT IF EXISTS "ProductAlias_source_check";
ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_source_check"
  CHECK ("source" IN (
    'LEGACY_BACKFILL', 'MANUAL', 'IMPORT', 'FIXTURE', 'RESEARCH', 'SYSTEM'
  ));

-- Deterministic normalize in SQL for backfill (mirrors app policy: lower, ё→е, collapse spaces).
UPDATE "ProductAlias"
SET "normalizedAlias" = regexp_replace(
      replace(lower(trim(alias)), 'ё', 'е'),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    "updatedAt" = now()
WHERE "normalizedAlias" IS NULL OR "normalizedAlias" = '';

-- Drop global unique on alias text if present; replace with (productId, normalizedAlias) unique for active rows.
ALTER TABLE "ProductAlias" DROP CONSTRAINT IF EXISTS "ProductAlias_alias_key";
DROP INDEX IF EXISTS "ProductAlias_alias_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ProductAlias_productId_normalizedAlias_uidx"
  ON "ProductAlias" ("productId", "normalizedAlias")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "ProductAlias_normalizedAlias_idx"
  ON "ProductAlias" ("normalizedAlias")
  WHERE "status" = 'ACTIVE';

-- Seed aliases from Product.canonicalName / productKey / name when missing.
INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
SELECT
  p.id,
  p."canonicalName",
  regexp_replace(replace(lower(trim(p."canonicalName")), 'ё', 'е'), '[[:space:]]+', ' ', 'g'),
  'LEGACY_BACKFILL',
  1.0,
  'ACTIVE'
FROM "Product" p
WHERE p."canonicalName" IS NOT NULL AND length(trim(p."canonicalName")) > 0
ON CONFLICT ("productId", "normalizedAlias") WHERE ("status" = 'ACTIVE') DO NOTHING;

INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
SELECT
  p.id,
  p."productKey",
  regexp_replace(replace(lower(trim(p."productKey")), 'ё', 'е'), '[[:space:]]+', ' ', 'g'),
  'LEGACY_BACKFILL',
  1.0,
  'ACTIVE'
FROM "Product" p
WHERE p."productKey" IS NOT NULL
  AND length(trim(p."productKey")) > 0
  AND regexp_replace(replace(lower(trim(p."productKey")), 'ё', 'е'), '[[:space:]]+', ' ', 'g')
      IS DISTINCT FROM regexp_replace(replace(lower(trim(p."canonicalName")), 'ё', 'е'), '[[:space:]]+', ' ', 'g')
ON CONFLICT ("productId", "normalizedAlias") WHERE ("status" = 'ACTIVE') DO NOTHING;
