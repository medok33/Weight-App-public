-- RP2-01B STEP_198: ProductSubstitution curated edges + cooking method lookup
-- Does not modify migrations 001–174.

CREATE TABLE IF NOT EXISTS "CookingMethod" (
  "code" text PRIMARY KEY,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CookingMethod_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

INSERT INTO "CookingMethod" ("code", "name", "status") VALUES
  ('RAW', 'Сырой / без термообработки', 'ACTIVE'),
  ('BOIL', 'Варка', 'ACTIVE'),
  ('BAKE', 'Запекание', 'ACTIVE'),
  ('FRY', 'Жарка', 'ACTIVE'),
  ('STEW', 'Тушение', 'ACTIVE'),
  ('STEAM', 'На пару', 'ACTIVE'),
  ('GRILL', 'Гриль', 'ACTIVE'),
  ('MIX', 'Смешивание', 'ACTIVE'),
  ('BLEND', 'Измельчение / блендер', 'ACTIVE')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "status" = EXCLUDED."status";

CREATE TABLE IF NOT EXISTS "ProductSubstitution" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sourceProductId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "replacementProductId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "culinaryRoleId" uuid REFERENCES "CulinaryRole"("id") ON DELETE RESTRICT,
  "replacementRatio" numeric(12,6) NOT NULL,
  "replacementRatioMin" numeric(12,6) NOT NULL,
  "replacementRatioMax" numeric(12,6) NOT NULL,
  "nutritionImpact" text NOT NULL DEFAULT 'UNKNOWN',
  "textureImpact" text NOT NULL DEFAULT 'UNKNOWN',
  "supportedMethods" text[] NOT NULL DEFAULT '{}'::text[],
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "source" text NOT NULL DEFAULT 'MANUAL',
  "confidence" numeric(5,4) NOT NULL DEFAULT 1.0,
  "reviewedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProductSubstitution_no_self" CHECK ("sourceProductId" <> "replacementProductId"),
  CONSTRAINT "ProductSubstitution_ratio_positive" CHECK ("replacementRatio" > 0),
  CONSTRAINT "ProductSubstitution_ratio_min_positive" CHECK ("replacementRatioMin" > 0),
  CONSTRAINT "ProductSubstitution_ratio_max_positive" CHECK ("replacementRatioMax" > 0),
  CONSTRAINT "ProductSubstitution_ratio_bounds" CHECK (
    "replacementRatioMin" <= "replacementRatio"
    AND "replacementRatio" <= "replacementRatioMax"
  ),
  CONSTRAINT "ProductSubstitution_nutritionImpact_check" CHECK ("nutritionImpact" IN (
    'LOWER', 'SIMILAR', 'HIGHER', 'VARIABLE', 'UNKNOWN'
  )),
  CONSTRAINT "ProductSubstitution_textureImpact_check" CHECK ("textureImpact" IN (
    'MINIMAL', 'NOTICEABLE', 'MAJOR', 'METHOD_DEPENDENT', 'UNKNOWN'
  )),
  CONSTRAINT "ProductSubstitution_status_check" CHECK ("status" IN (
    'ACTIVE', 'NEEDS_REVIEW', 'SUSPENDED', 'REJECTED', 'ARCHIVED'
  )),
  CONSTRAINT "ProductSubstitution_source_check" CHECK ("source" IN (
    'MANUAL', 'OWNER_REVIEWED', 'IMPORT', 'FIXTURE', 'SYSTEM', 'LEGACY_BACKFILL'
  )),
  CONSTRAINT "ProductSubstitution_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

-- PG15+: NULLS NOT DISTINCT for optional culinaryRoleId
CREATE UNIQUE INDEX IF NOT EXISTS "ProductSubstitution_edge_role_uidx"
  ON "ProductSubstitution" ("sourceProductId", "replacementProductId", "culinaryRoleId")
  NULLS NOT DISTINCT
  WHERE "status" IN ('ACTIVE', 'NEEDS_REVIEW', 'SUSPENDED');

CREATE INDEX IF NOT EXISTS "ProductSubstitution_sourceProductId_status_idx"
  ON "ProductSubstitution" ("sourceProductId", "status");

CREATE INDEX IF NOT EXISTS "ProductSubstitution_replacementProductId_idx"
  ON "ProductSubstitution" ("replacementProductId");

-- Curated fixtures for STEP_093 (idempotent by productKey).
INSERT INTO "ProductSubstitution" (
  "sourceProductId", "replacementProductId", "culinaryRoleId",
  "replacementRatio", "replacementRatioMin", "replacementRatioMax",
  "nutritionImpact", "textureImpact", "supportedMethods",
  "status", "source", "confidence", "reviewedAt"
)
SELECT
  src.id, dst.id, role.id,
  1.0, 0.8, 1.25,
  'SIMILAR', 'NOTICEABLE', ARRAY['BOIL', 'STEW', 'STEAM']::text[],
  'ACTIVE', 'FIXTURE', 0.95, now()
FROM "Product" src
JOIN "Product" dst ON dst."productKey" = 'step093_white_rice'
JOIN "CulinaryRole" role ON role.code = 'STARCH'
WHERE src."productKey" = 'step093_buckwheat'
  AND NOT EXISTS (
    SELECT 1 FROM "ProductSubstitution" ps
    WHERE ps."sourceProductId" = src.id
      AND ps."replacementProductId" = dst.id
      AND ps."culinaryRoleId" IS NOT DISTINCT FROM role.id
      AND ps.status IN ('ACTIVE', 'NEEDS_REVIEW', 'SUSPENDED')
  );

INSERT INTO "ProductSubstitution" (
  "sourceProductId", "replacementProductId", "culinaryRoleId",
  "replacementRatio", "replacementRatioMin", "replacementRatioMax",
  "nutritionImpact", "textureImpact", "supportedMethods",
  "status", "source", "confidence", "reviewedAt"
)
SELECT
  src.id, dst.id, role.id,
  1.05, 0.85, 1.30,
  'SIMILAR', 'MINIMAL', ARRAY['BOIL', 'BAKE', 'STEW', 'STEAM', 'GRILL', 'FRY']::text[],
  'ACTIVE', 'FIXTURE', 0.95, now()
FROM "Product" src
JOIN "Product" dst ON dst."productKey" = 'step093_turkey'
JOIN "CulinaryRole" role ON role.code = 'MAIN_PROTEIN'
WHERE src."productKey" = 'step092_chicken'
  AND NOT EXISTS (
    SELECT 1 FROM "ProductSubstitution" ps
    WHERE ps."sourceProductId" = src.id
      AND ps."replacementProductId" = dst.id
      AND ps."culinaryRoleId" IS NOT DISTINCT FROM role.id
      AND ps.status IN ('ACTIVE', 'NEEDS_REVIEW', 'SUSPENDED')
  );

-- Method-incompatible curated edge: oil → applesauce style (BAKE only) for demo filter.
-- Method-incompatible ACTIVE edge: buckwheat → potato only for BLEND (filtered out for BOIL dish).
INSERT INTO "ProductSubstitution" (
  "sourceProductId", "replacementProductId", "culinaryRoleId",
  "replacementRatio", "replacementRatioMin", "replacementRatioMax",
  "nutritionImpact", "textureImpact", "supportedMethods",
  "status", "source", "confidence", "reviewedAt"
)
SELECT
  src.id, dst.id, role.id,
  1.2, 1.0, 1.5,
  'VARIABLE', 'MAJOR', ARRAY['BLEND']::text[],
  'ACTIVE', 'FIXTURE', 0.80, now()
FROM "Product" src
JOIN "Product" dst ON dst."productKey" = 'step093_potato'
JOIN "CulinaryRole" role ON role.code = 'STARCH'
WHERE src."productKey" = 'step093_buckwheat'
  AND NOT EXISTS (
    SELECT 1 FROM "ProductSubstitution" ps
    WHERE ps."sourceProductId" = src.id
      AND ps."replacementProductId" = dst.id
      AND ps."culinaryRoleId" IS NOT DISTINCT FROM role.id
      AND ps.status IN ('ACTIVE', 'NEEDS_REVIEW', 'SUSPENDED')
  );

-- Suspended peanut as protein auto-candidate for chicken.
INSERT INTO "ProductSubstitution" (
  "sourceProductId", "replacementProductId", "culinaryRoleId",
  "replacementRatio", "replacementRatioMin", "replacementRatioMax",
  "nutritionImpact", "textureImpact", "supportedMethods",
  "status", "source", "confidence"
)
SELECT
  src.id, dst.id, role.id,
  0.6, 0.4, 0.8,
  'HIGHER', 'MAJOR', ARRAY['MIX', 'BLEND']::text[],
  'SUSPENDED', 'FIXTURE', 0.40
FROM "Product" src
JOIN "Product" dst ON dst."productKey" = 'step093_peanut'
JOIN "CulinaryRole" role ON role.code = 'MAIN_PROTEIN'
WHERE src."productKey" = 'step092_chicken'
  AND NOT EXISTS (
    SELECT 1 FROM "ProductSubstitution" ps
    WHERE ps."sourceProductId" = src.id
      AND ps."replacementProductId" = dst.id
      AND ps.status IN ('ACTIVE', 'NEEDS_REVIEW', 'SUSPENDED')
  );
