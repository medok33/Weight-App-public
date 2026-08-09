-- RP2-01A STEP_193/194: ProductCategory + Product form/state fields
-- Does not modify migrations 001–170.

CREATE TABLE IF NOT EXISTS "ProductCategory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "parentId" uuid NULL REFERENCES "ProductCategory"("id") ON DELETE RESTRICT,
  "position" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProductCategory_code_key" UNIQUE ("code"),
  CONSTRAINT "ProductCategory_position_check" CHECK ("position" >= 0),
  CONSTRAINT "ProductCategory_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT "ProductCategory_no_self_parent" CHECK ("parentId" IS DISTINCT FROM "id")
);

CREATE INDEX IF NOT EXISTS "ProductCategory_parentId_idx" ON "ProductCategory" ("parentId");
CREATE INDEX IF NOT EXISTS "ProductCategory_status_position_idx" ON "ProductCategory" ("status", "position", "code");

INSERT INTO "ProductCategory" ("id", "code", "name", "parentId", "position", "status")
VALUES
  ('b1930001-0000-4000-8000-000000000001', 'meat_poultry', 'Мясо и птица', NULL, 10, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000002', 'fish_seafood', 'Рыба и морепродукты', NULL, 20, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000003', 'dairy', 'Молочные продукты', NULL, 30, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000004', 'eggs', 'Яйца', NULL, 40, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000005', 'grains', 'Крупы', NULL, 50, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000006', 'pasta', 'Макароны', NULL, 60, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000007', 'vegetables', 'Овощи', NULL, 70, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000008', 'fruits', 'Фрукты', NULL, 80, 'ACTIVE'),
  ('b1930001-0000-4000-8000-000000000009', 'legumes', 'Бобовые', NULL, 90, 'ACTIVE'),
  ('b1930001-0000-4000-8000-00000000000a', 'oils_fats', 'Масла и жиры', NULL, 100, 'ACTIVE'),
  ('b1930001-0000-4000-8000-00000000000b', 'sauces', 'Соусы', NULL, 110, 'ACTIVE'),
  ('b1930001-0000-4000-8000-00000000000c', 'spices', 'Специи', NULL, 120, 'ACTIVE'),
  ('b1930001-0000-4000-8000-00000000000d', 'technological_ingredients', 'Технологические ингредиенты', NULL, 130, 'ACTIVE'),
  ('b1930001-0000-4000-8000-0000000000ff', 'UNCLASSIFIED', 'Не классифицировано', NULL, 9999, 'ACTIVE')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "status" = EXCLUDED."status",
  "updatedAt" = now();

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "categoryId" uuid,
  ADD COLUMN IF NOT EXISTS "form" text,
  ADD COLUMN IF NOT EXISTS "fatPercent" numeric(8,4),
  ADD COLUMN IF NOT EXISTS "ediblePartPercent" numeric(8,4),
  ADD COLUMN IF NOT EXISTS "density" numeric(12,6),
  ADD COLUMN IF NOT EXISTS "averagePieceWeightGrams" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "yieldCoefficient" numeric(8,4),
  ADD COLUMN IF NOT EXISTS "defaultUnit" text,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_categoryId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_form_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_form_check"
  CHECK (
    "form" IS NULL OR "form" IN (
      'RAW','DRY','BOILED','BAKED','FRIED','STEWED','FROZEN','CANNED','DRAINED','READY_TO_EAT'
    )
  );

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_fatPercent_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_fatPercent_check"
  CHECK ("fatPercent" IS NULL OR ("fatPercent" >= 0 AND "fatPercent" <= 100));

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_ediblePartPercent_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_ediblePartPercent_check"
  CHECK ("ediblePartPercent" IS NULL OR ("ediblePartPercent" > 0 AND "ediblePartPercent" <= 100));

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_density_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_density_check"
  CHECK ("density" IS NULL OR "density" > 0);

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_averagePieceWeightGrams_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_averagePieceWeightGrams_check"
  CHECK ("averagePieceWeightGrams" IS NULL OR "averagePieceWeightGrams" > 0);

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_yieldCoefficient_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_yieldCoefficient_check"
  CHECK ("yieldCoefficient" IS NULL OR "yieldCoefficient" > 0);

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_defaultUnit_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_defaultUnit_check"
  CHECK (
    "defaultUnit" IS NULL OR "defaultUnit" IN (
      'g','kg','ml','l','piece','tsp','tbsp','GRAM','KILOGRAM','MILLILITER','LITER','PIECE','TEASPOON','TABLESPOON'
    )
  );

CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product" ("categoryId");
CREATE INDEX IF NOT EXISTS "Product_form_idx" ON "Product" ("form");

-- Deterministic category backfill from legacy Product.category / productKey / canonicalName.
UPDATE "Product" p
SET "categoryId" = c.id,
    "updatedAt" = now()
FROM "ProductCategory" c
WHERE p."categoryId" IS NULL
  AND c.code = CASE
    WHEN lower(COALESCE(p.category, '')) IN ('dairy') OR lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(milk|yogurt|butter|cheese|творог|молоко|йогурт|сыр)'
      THEN 'dairy'
    WHEN lower(COALESCE(p.category, '')) IN ('eggs') OR lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(egg|яйц)'
      THEN 'eggs'
    WHEN lower(COALESCE(p.category, '')) IN ('fish', 'seafood', 'protein') AND lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(fish|salmon|tuna|минтай|рыб|shrimp|shell)'
      THEN 'fish_seafood'
    WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(chicken|turkey|beef|pork|meat|куриц|индей|мясо|грудк)'
      THEN 'meat_poultry'
    WHEN lower(COALESCE(p.category, '')) IN ('grains') OR lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(oat|rice|buckwheat|quinoa|греч|рис|овсян|киноа)'
      THEN 'grains'
    WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(pasta|макарон|паста|noodle)'
      THEN 'pasta'
    WHEN lower(COALESCE(p.category, '')) IN ('vegetables') OR lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(broccoli|carrot|onion|potato|lettuce|tomato|овощ|картоф|брокк|морков|лук|томат)'
      THEN 'vegetables'
    WHEN lower(COALESCE(p.category, '')) IN ('fruit', 'fruits') OR lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(apple|banana|lemon|avocado|фрукт|яблок|лимон|авокадо)'
      THEN 'fruits'
    WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(bean|lentil|pea|chickpea|боб|чечев|горох)'
      THEN 'legumes'
    WHEN lower(COALESCE(p.category, '')) IN ('oils', 'fats', 'pantry') AND lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(oil|butter|fat|масл|жир)'
      THEN 'oils_fats'
    WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(sauce|соус)'
      THEN 'sauces'
    WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(spice|pepper|salt|спец|перец|соль)'
      THEN 'spices'
    WHEN lower(COALESCE(p.category, '')) IN ('protein') AND lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) !~ '(fish|yogurt|milk|egg)'
      THEN 'meat_poultry'
    ELSE 'UNCLASSIFIED'
  END;

UPDATE "Product" p
SET "categoryId" = c.id,
    "updatedAt" = now()
FROM "ProductCategory" c
WHERE p."categoryId" IS NULL AND c.code = 'UNCLASSIFIED';

-- Default form: DRY for grains/pasta dry goods, RAW otherwise (explicit, not invented nutrition).
UPDATE "Product"
SET "form" = CASE
  WHEN lower(COALESCE("productKey",'') || ' ' || COALESCE("canonicalName",'')) ~ '(oat|rice|buckwheat|quinoa|pasta|греч|рис|овсян|макарон|киноа|мук)'
    THEN 'DRY'
  WHEN lower(COALESCE("productKey",'') || ' ' || COALESCE("canonicalName",'')) ~ '(frozen|заморож)'
    THEN 'FROZEN'
  WHEN lower(COALESCE("productKey",'') || ' ' || COALESCE("canonicalName",'')) ~ '(canned|консерв)'
    THEN 'CANNED'
  ELSE 'RAW'
END,
"updatedAt" = now()
WHERE "form" IS NULL;

UPDATE "Product"
SET "defaultUnit" = CASE
  WHEN lower(unit) IN ('g', 'gram', 'grams', 'гр', 'г') THEN 'g'
  WHEN lower(unit) IN ('kg', 'kilogram', 'килограмм') THEN 'kg'
  WHEN lower(unit) IN ('ml', 'milliliter', 'millilitre', 'мл') THEN 'ml'
  WHEN lower(unit) IN ('l', 'liter', 'litre', 'л') THEN 'l'
  WHEN lower(unit) IN ('piece', 'pcs', 'pc', 'шт') THEN 'piece'
  WHEN lower(unit) IN ('tsp', 'teaspoon', 'ч.л', 'чл') THEN 'tsp'
  WHEN lower(unit) IN ('tbsp', 'tablespoon', 'ст.л', 'стл') THEN 'tbsp'
  ELSE NULL
END,
"updatedAt" = now()
WHERE "defaultUnit" IS NULL AND unit IS NOT NULL;

-- Reject cyclic category hierarchy on parentId changes.
CREATE OR REPLACE FUNCTION product_category_assert_acyclic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cursor_id uuid;
  hop int := 0;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."parentId" = NEW.id THEN
    RAISE EXCEPTION 'PRODUCT_CATEGORY_SELF_PARENT';
  END IF;
  cursor_id := NEW."parentId";
  WHILE cursor_id IS NOT NULL LOOP
    hop := hop + 1;
    IF hop > 64 THEN
      RAISE EXCEPTION 'PRODUCT_CATEGORY_CYCLE';
    END IF;
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'PRODUCT_CATEGORY_CYCLE';
    END IF;
    SELECT "parentId" INTO cursor_id FROM "ProductCategory" WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_category_acyclic_trg ON "ProductCategory";
CREATE TRIGGER product_category_acyclic_trg
  BEFORE INSERT OR UPDATE OF "parentId" ON "ProductCategory"
  FOR EACH ROW EXECUTE FUNCTION product_category_assert_acyclic();
