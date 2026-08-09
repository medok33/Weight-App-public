-- RP2-01A STEP_196: ProductNutritionVersion + legacy macros backfill

CREATE TABLE IF NOT EXISTS "ProductNutritionVersion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL,
  "calories" numeric(10,2) NOT NULL,
  "protein" numeric(10,2) NOT NULL,
  "fat" numeric(10,2) NOT NULL,
  "carbohydrate" numeric(10,2) NOT NULL,
  "fiber" numeric(10,2),
  "sodium" numeric(10,2),
  "source" text NOT NULL,
  "validFrom" timestamptz NOT NULL DEFAULT now(),
  "reviewedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" uuid,
  CONSTRAINT "ProductNutritionVersion_productId_version_key" UNIQUE ("productId", "version"),
  CONSTRAINT "ProductNutritionVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProductNutritionVersion_calories_check" CHECK ("calories" >= 0),
  CONSTRAINT "ProductNutritionVersion_protein_check" CHECK ("protein" >= 0),
  CONSTRAINT "ProductNutritionVersion_fat_check" CHECK ("fat" >= 0),
  CONSTRAINT "ProductNutritionVersion_carbohydrate_check" CHECK ("carbohydrate" >= 0),
  CONSTRAINT "ProductNutritionVersion_fiber_check" CHECK ("fiber" IS NULL OR "fiber" >= 0),
  CONSTRAINT "ProductNutritionVersion_sodium_check" CHECK ("sodium" IS NULL OR "sodium" >= 0),
  CONSTRAINT "ProductNutritionVersion_source_check" CHECK ("source" IN (
    'LEGACY_BACKFILL', 'MANUAL', 'LAB', 'IMPORT', 'FIXTURE', 'SYSTEM'
  ))
);

CREATE INDEX IF NOT EXISTS "ProductNutritionVersion_productId_validFrom_idx"
  ON "ProductNutritionVersion" ("productId", "validFrom" DESC);

-- Current version pointer (nullable until first version exists).
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "currentNutritionVersionId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_currentNutritionVersionId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_currentNutritionVersionId_fkey"
      FOREIGN KEY ("currentNutritionVersionId") REFERENCES "ProductNutritionVersion"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill version 1 from Product macro columns when any macro present.
INSERT INTO "ProductNutritionVersion" (
  "productId", "version", "calories", "protein", "fat", "carbohydrate",
  "fiber", "sodium", "source", "validFrom", "reviewedAt"
)
SELECT
  p.id,
  1,
  COALESCE(p."caloriesPer100g", 0),
  COALESCE(p."proteinPer100g", 0),
  COALESCE(p."fatPer100g", 0),
  COALESCE(p."carbsPer100g", 0),
  NULL,
  NULL,
  'LEGACY_BACKFILL',
  COALESCE(p."createdAt", now()),
  NULL
FROM "Product" p
WHERE p."caloriesPer100g" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProductNutritionVersion" v WHERE v."productId" = p.id AND v."version" = 1
  );

UPDATE "Product" p
SET "currentNutritionVersionId" = v.id,
    "updatedAt" = now()
FROM "ProductNutritionVersion" v
WHERE v."productId" = p.id
  AND v."version" = (
    SELECT MAX(v2."version") FROM "ProductNutritionVersion" v2 WHERE v2."productId" = p.id
  )
  AND (p."currentNutritionVersionId" IS NULL OR p."currentNutritionVersionId" IS DISTINCT FROM v.id);

-- Published nutrition versions are append-only / immutable.
CREATE OR REPLACE FUNCTION product_nutrition_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PRODUCT_NUTRITION_VERSION_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS product_nutrition_version_no_update ON "ProductNutritionVersion";
CREATE TRIGGER product_nutrition_version_no_update
  BEFORE UPDATE ON "ProductNutritionVersion"
  FOR EACH ROW EXECUTE FUNCTION product_nutrition_version_immutable();

DROP TRIGGER IF EXISTS product_nutrition_version_no_delete ON "ProductNutritionVersion";
CREATE TRIGGER product_nutrition_version_no_delete
  BEFORE DELETE ON "ProductNutritionVersion"
  FOR EACH ROW EXECUTE FUNCTION product_nutrition_version_immutable();
