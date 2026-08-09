-- RP2-01B STEP_198: CulinaryRole + ProductCulinaryRole
-- Does not modify migrations 001–174.

CREATE TABLE IF NOT EXISTS "CulinaryRole" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CulinaryRole_code_key" UNIQUE ("code"),
  CONSTRAINT "CulinaryRole_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS "ProductCulinaryRole" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "culinaryRoleId" uuid NOT NULL REFERENCES "CulinaryRole"("id") ON DELETE RESTRICT,
  "isPrimary" boolean NOT NULL DEFAULT false,
  "source" text NOT NULL DEFAULT 'HEURISTIC',
  "confidence" numeric(5,4) NOT NULL DEFAULT 0.50,
  "reviewedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProductCulinaryRole_productId_culinaryRoleId_key" UNIQUE ("productId", "culinaryRoleId"),
  CONSTRAINT "ProductCulinaryRole_source_check" CHECK ("source" IN (
    'HEURISTIC', 'OWNER_REVIEWED', 'IMPORT', 'FIXTURE', 'SYSTEM', 'LEGACY_BACKFILL'
  )),
  CONSTRAINT "ProductCulinaryRole_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCulinaryRole_one_primary_uidx"
  ON "ProductCulinaryRole" ("productId")
  WHERE "isPrimary" = true;

CREATE INDEX IF NOT EXISTS "ProductCulinaryRole_culinaryRoleId_idx"
  ON "ProductCulinaryRole" ("culinaryRoleId");

INSERT INTO "CulinaryRole" ("id", "code", "name", "description", "status") VALUES
  ('b1980001-0000-4000-8000-000000000001', 'MAIN_PROTEIN', 'Основной белок', 'Primary protein ingredient', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000002', 'STARCH', 'Крахмал / крупа', 'Starch / grain base', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000003', 'VEGETABLE_BASE', 'Овощная основа', 'Vegetable base', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000004', 'FAT', 'Жир', 'Fat / oil', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000005', 'BINDER', 'Связующее', 'Binder', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000006', 'MOISTURE_SOURCE', 'Источник влаги', 'Moisture source', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000007', 'SAUCE_BASE', 'Основа соуса', 'Sauce base', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000008', 'AROMATIC', 'Ароматика', 'Aromatic', 'ACTIVE'),
  ('b1980001-0000-4000-8000-000000000009', 'ACID', 'Кислота', 'Acid', 'ACTIVE'),
  ('b1980001-0000-4000-8000-00000000000a', 'THICKENER', 'Загуститель', 'Thickener', 'ACTIVE'),
  ('b1980001-0000-4000-8000-00000000000b', 'SEASONING', 'Приправа', 'Seasoning', 'ACTIVE')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "status" = EXCLUDED."status",
  "updatedAt" = now();

-- Deterministic heuristic role backfill (no LLM). Absence of match leaves product without roles.
INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", "source", "confidence")
SELECT p.id, r.id, true, 'HEURISTIC', 0.70
FROM "Product" p
JOIN "CulinaryRole" r ON r.code = CASE
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(chicken|turkey|beef|pork|fish|salmon|tuna|egg|yogurt|meat|куриц|индей|рыб|яйц)'
    THEN 'MAIN_PROTEIN'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(rice|buckwheat|oat|quinoa|pasta|potato|греч|рис|овсян|макарон|картоф)'
    THEN 'STARCH'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(broccoli|carrot|onion|lettuce|tomato|овощ|брокк|морков|лук|салат)'
    THEN 'VEGETABLE_BASE'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(oil|butter|fat|масл|жир)'
    THEN 'FAT'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(sauce|соус)'
    THEN 'SAUCE_BASE'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(lemon|vinegar|лимон|уксус)'
    THEN 'ACID'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(milk|water|молоко)'
    THEN 'MOISTURE_SOURCE'
  WHEN lower(COALESCE(p."productKey",'') || ' ' || COALESCE(p."canonicalName",''))
    ~ '(salt|pepper|spice|соль|перец|спец)'
    THEN 'SEASONING'
  ELSE NULL
END
WHERE r.id IS NOT NULL
ON CONFLICT ("productId", "culinaryRoleId") DO NOTHING;

-- Secondary vegetable role for protein dishes' common sides is not auto-inferred here.
