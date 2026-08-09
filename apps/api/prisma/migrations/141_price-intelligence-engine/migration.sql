-- Universal retailer + product normalization for Price Intelligence Engine.

ALTER TABLE "Retailer"
  ADD COLUMN IF NOT EXISTS "code" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT NOT NULL DEFAULT 'RU',
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Retailer"
SET "code" = upper(regexp_replace(COALESCE("key", name), '[^a-zA-Z0-9]+', '_', 'g'))
WHERE "code" IS NULL OR "code" = '';

UPDATE "Retailer"
SET "code" = 'RETAILER_' || substr(id::text, 1, 8)
WHERE "code" IS NULL OR "code" = '';

WITH ranked AS (
  SELECT id, code, row_number() OVER (PARTITION BY code ORDER BY id) AS rn
  FROM "Retailer"
)
UPDATE "Retailer" r
SET code = r.code || '_' || substr(r.id::text, 1, 8)
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Retailer_code_key" ON "Retailer"("code");

INSERT INTO "Retailer" (name, "key", type, code, region, active)
VALUES
  ('Магнит', 'magnit', 'CHAIN', 'MAGNIT', 'RU', true),
  ('Пятёрочка', 'pyaterochka', 'CHAIN', 'PYATEROCHKA', 'RU', true),
  ('ВкусВилл', 'vkusvill', 'CHAIN', 'VKUSVILL', 'RU', true),
  ('X5', 'x5', 'CHAIN', 'X5', 'RU', true),
  ('Азбука вкуса', 'azbuka_vkusa', 'CHAIN', 'AZBUKA_VKUSA', 'RU', true)
ON CONFLICT ("key") DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  active = EXCLUDED.active;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "productKey" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "weight" TEXT;

UPDATE "Product"
SET "productKey" = "canonicalName"
WHERE "productKey" IS NULL OR "productKey" = '';

UPDATE "Product"
SET "name" = COALESCE(NULLIF("name", ''), "canonicalName")
WHERE "name" IS NULL OR "name" = '';

CREATE UNIQUE INDEX IF NOT EXISTS "Product_productKey_key" ON "Product"("productKey");
