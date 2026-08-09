-- Retailer is a first-class entity: business logic uses key + type, never display name.
ALTER TABLE "Retailer"
  ADD COLUMN IF NOT EXISTS "key" TEXT,
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'CHAIN';

UPDATE "Retailer"
SET "key" = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'))
WHERE "key" IS NULL OR "key" = '';

UPDATE "Retailer"
SET "key" = 'retailer_' || substr(id::text, 1, 8)
WHERE "key" IS NULL OR "key" = '';

WITH ranked AS (
  SELECT id, "key", row_number() OVER (PARTITION BY "key" ORDER BY id) AS rn
  FROM "Retailer"
)
UPDATE "Retailer" r
SET "key" = r."key" || '_' || substr(r.id::text, 1, 8)
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

UPDATE "Retailer" SET "type" = 'LOCAL' WHERE name = 'MVP Market' AND "type" = 'CHAIN';

CREATE UNIQUE INDEX IF NOT EXISTS "Retailer_key_key" ON "Retailer"("key");
