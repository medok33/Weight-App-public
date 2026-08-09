-- RP2-01A STEP_197: Allergen / DietaryTag dictionaries + product links + jsonb backfill

CREATE TABLE IF NOT EXISTS "Allergen" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Allergen_code_key" UNIQUE ("code"),
  CONSTRAINT "Allergen_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE IF NOT EXISTS "DietaryTag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "DietaryTag_code_key" UNIQUE ("code"),
  CONSTRAINT "DietaryTag_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE IF NOT EXISTS "ProductAllergen" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "allergenId" uuid NOT NULL REFERENCES "Allergen"("id") ON DELETE RESTRICT,
  "presence" text NOT NULL DEFAULT 'CONTAINS',
  "source" text NOT NULL DEFAULT 'LEGACY_BACKFILL',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProductAllergen_productId_allergenId_key" UNIQUE ("productId", "allergenId"),
  CONSTRAINT "ProductAllergen_presence_check" CHECK (
    "presence" IN ('CONTAINS', 'MAY_CONTAIN', 'CROSS_CONTAMINATION_RISK')
  ),
  CONSTRAINT "ProductAllergen_source_check" CHECK ("source" IN (
    'LEGACY_BACKFILL', 'MANUAL', 'IMPORT', 'FIXTURE', 'RECIPE_JSON', 'SYSTEM'
  ))
);

CREATE TABLE IF NOT EXISTS "ProductDietaryTag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "dietaryTagId" uuid NOT NULL REFERENCES "DietaryTag"("id") ON DELETE RESTRICT,
  "source" text NOT NULL DEFAULT 'LEGACY_BACKFILL',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProductDietaryTag_productId_dietaryTagId_key" UNIQUE ("productId", "dietaryTagId"),
  CONSTRAINT "ProductDietaryTag_source_check" CHECK ("source" IN (
    'LEGACY_BACKFILL', 'MANUAL', 'IMPORT', 'FIXTURE', 'RECIPE_JSON', 'SYSTEM'
  ))
);

CREATE INDEX IF NOT EXISTS "ProductAllergen_allergenId_idx" ON "ProductAllergen" ("allergenId");
CREATE INDEX IF NOT EXISTS "ProductDietaryTag_dietaryTagId_idx" ON "ProductDietaryTag" ("dietaryTagId");

INSERT INTO "Allergen" ("id", "code", "name") VALUES
  ('b1970001-0000-4000-8000-000000000001', 'milk', 'Молоко'),
  ('b1970001-0000-4000-8000-000000000002', 'eggs', 'Яйца'),
  ('b1970001-0000-4000-8000-000000000003', 'gluten', 'Глютен'),
  ('b1970001-0000-4000-8000-000000000004', 'fish', 'Рыба'),
  ('b1970001-0000-4000-8000-000000000005', 'peanuts', 'Арахис'),
  ('b1970001-0000-4000-8000-000000000006', 'tree_nuts', 'Орехи'),
  ('b1970001-0000-4000-8000-000000000007', 'soy', 'Соя'),
  ('b1970001-0000-4000-8000-000000000008', 'shellfish', 'Ракообразные'),
  ('b1970001-0000-4000-8000-000000000009', 'sesame', 'Кунжут'),
  ('b1970001-0000-4000-8000-00000000000a', 'celery', 'Сельдерей'),
  ('b1970001-0000-4000-8000-00000000000b', 'mustard', 'Горчица'),
  ('b1970001-0000-4000-8000-00000000000c', 'sulphites', 'Сульфиты')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = now();

INSERT INTO "DietaryTag" ("id", "code", "name") VALUES
  ('b1970002-0000-4000-8000-000000000001', 'vegetarian', 'Vegetarian'),
  ('b1970002-0000-4000-8000-000000000002', 'vegan', 'Vegan'),
  ('b1970002-0000-4000-8000-000000000003', 'gluten_free', 'Gluten free'),
  ('b1970002-0000-4000-8000-000000000004', 'lactose_free', 'Lactose free'),
  ('b1970002-0000-4000-8000-000000000005', 'pescatarian', 'Pescatarian')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = now();

-- Product-level heuristics from productKey / canonicalName (not AI).
INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "Allergen" a ON a.code = 'milk'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(milk|yogurt|butter|cheese|dairy|молоко|йогурт|сыр|творог)'
ON CONFLICT ("productId", "allergenId") DO NOTHING;

INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "Allergen" a ON a.code = 'eggs'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(egg|яйц)'
ON CONFLICT ("productId", "allergenId") DO NOTHING;

INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "Allergen" a ON a.code = 'fish'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(fish|salmon|tuna|минтай|рыб)'
ON CONFLICT ("productId", "allergenId") DO NOTHING;

INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "Allergen" a ON a.code = 'gluten'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(pasta|wheat|flour|oat|макарон|пшен|мук|овсян)'
ON CONFLICT ("productId", "allergenId") DO NOTHING;

INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
SELECT p.id, a.id, 'CONTAINS', 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "Allergen" a ON a.code = 'peanuts'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",'')) ~ '(peanut|арахис)'
ON CONFLICT ("productId", "allergenId") DO NOTHING;

-- Recipe jsonb allergens → product ingredients (via RecipeIngredient).
INSERT INTO "ProductAllergen" ("productId", "allergenId", "presence", "source")
SELECT DISTINCT ri."productId", a.id, 'CONTAINS', 'RECIPE_JSON'
FROM "Recipe" r
JOIN "RecipeIngredient" ri ON ri."recipeId" = r.id
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.allergens, '[]'::jsonb)) AS raw(tag)
JOIN "Allergen" a ON a.code = CASE
  WHEN lower(raw.tag) IN ('dairy', 'milk', 'lactose') THEN 'milk'
  WHEN lower(raw.tag) IN ('egg', 'eggs') THEN 'eggs'
  WHEN lower(raw.tag) IN ('fish') THEN 'fish'
  WHEN lower(raw.tag) IN ('gluten', 'wheat') THEN 'gluten'
  WHEN lower(raw.tag) IN ('peanut', 'peanuts') THEN 'peanuts'
  WHEN lower(raw.tag) IN ('soy', 'soya') THEN 'soy'
  WHEN lower(raw.tag) IN ('treenut', 'tree_nut', 'tree_nuts', 'nut', 'nuts') THEN 'tree_nuts'
  WHEN lower(raw.tag) IN ('shellfish', 'crustacean') THEN 'shellfish'
  WHEN lower(raw.tag) IN ('sesame') THEN 'sesame'
  WHEN lower(raw.tag) IN ('celery') THEN 'celery'
  WHEN lower(raw.tag) IN ('mustard') THEN 'mustard'
  WHEN lower(raw.tag) IN ('sulphite', 'sulphites', 'sulfite') THEN 'sulphites'
  ELSE NULL
END
WHERE a.id IS NOT NULL
ON CONFLICT ("productId", "allergenId") DO NOTHING;

-- Recipe jsonb dietaryTags → products used in those recipes.
INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", "source")
SELECT DISTINCT ri."productId", t.id, 'RECIPE_JSON'
FROM "Recipe" r
JOIN "RecipeIngredient" ri ON ri."recipeId" = r.id
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r."dietaryTags", '[]'::jsonb)) AS raw(tag)
JOIN "DietaryTag" t ON t.code = CASE
  WHEN lower(replace(raw.tag, '-', '_')) IN ('vegetarian') THEN 'vegetarian'
  WHEN lower(replace(raw.tag, '-', '_')) IN ('vegan') THEN 'vegan'
  WHEN lower(replace(raw.tag, '-', '_')) IN ('gluten_free', 'glutenfree') THEN 'gluten_free'
  WHEN lower(replace(raw.tag, '-', '_')) IN ('lactose_free', 'lactosefree') THEN 'lactose_free'
  WHEN lower(replace(raw.tag, '-', '_')) IN ('pescatarian') THEN 'pescatarian'
  ELSE NULL
END
WHERE t.id IS NOT NULL
ON CONFLICT ("productId", "dietaryTagId") DO NOTHING;

-- Fixture-style product dietary tags from keys.
INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", "source")
SELECT p.id, t.id, 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "DietaryTag" t ON t.code = 'vegan'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
  ~ '(broccoli|carrot|onion|potato|lettuce|tomato|oat|rice|buckwheat|quinoa|oil|lemon|avocado|греч|рис|овощ)'
  AND lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
  !~ '(milk|yogurt|egg|chicken|turkey|fish|butter|meat|cheese)'
ON CONFLICT ("productId", "dietaryTagId") DO NOTHING;

INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", "source")
SELECT p.id, t.id, 'LEGACY_BACKFILL'
FROM "Product" p
JOIN "DietaryTag" t ON t.code = 'gluten_free'
WHERE lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
  ~ '(buckwheat|rice|potato|греч|рис|картоф|fish|chicken|egg|yogurt)'
  AND lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
  !~ '(pasta|wheat|flour|oat|макарон|мук|овсян)'
ON CONFLICT ("productId", "dietaryTagId") DO NOTHING;

-- Compatibility serialization helpers: keep Recipe.allergens / dietaryTags jsonb as DTO surface,
-- but normalized ProductAllergen / ProductDietaryTag are the product-layer source of truth.
-- Absence of ProductAllergen does NOT mean allergen-free (allergenPresenceKnown=false in resolver).
