-- RP2-01C1 STEP_200: Product admin lifecycle, merge lineage, review decisions, optimistic concurrency.
-- Does not modify migrations 001–177.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "canonicalProductId" uuid,
  ADD COLUMN IF NOT EXISTS "mergedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "mergedBy" uuid,
  ADD COLUMN IF NOT EXISTS "reviewStatus" text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "reviewNote" text,
  ADD COLUMN IF NOT EXISTS "rowVersion" integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_canonicalProductId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_canonicalProductId_fkey"
      FOREIGN KEY ("canonicalProductId") REFERENCES "Product"("id") ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_mergedBy_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_mergedBy_fkey"
      FOREIGN KEY ("mergedBy") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_status_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_status_check"
  CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'MERGED', 'ARCHIVED'));

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_reviewStatus_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_reviewStatus_check"
  CHECK ("reviewStatus" IN ('NONE', 'NEEDS_REVIEW', 'IN_REVIEW', 'RESOLVED'));

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_rowVersion_check";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_rowVersion_check"
  CHECK ("rowVersion" >= 1);

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_no_self_canonical";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_no_self_canonical"
  CHECK ("canonicalProductId" IS DISTINCT FROM "id");

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_merged_requires_canonical";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_merged_requires_canonical"
  CHECK (
    ("status" <> 'MERGED')
    OR ("canonicalProductId" IS NOT NULL AND "mergedAt" IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS "Product_status_updatedAt_idx"
  ON "Product" ("status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "Product_canonicalProductId_idx"
  ON "Product" ("canonicalProductId")
  WHERE "canonicalProductId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Product_reviewStatus_idx"
  ON "Product" ("reviewStatus")
  WHERE "reviewStatus" <> 'NONE';

CREATE TABLE IF NOT EXISTS "ProductReviewDecision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "queueCode" text NOT NULL,
  "decision" text NOT NULL DEFAULT 'RESOLVED',
  "note" text,
  "actorUserId" uuid REFERENCES "User"("id") ON DELETE SET NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProductReviewDecision_queueCode_check" CHECK ("queueCode" IN (
    'UNCLASSIFIED',
    'MISSING_NUTRITION',
    'UNVERSIONED_LEGACY',
    'AMBIGUOUS_ALIAS',
    'HEURISTIC_ALLERGEN',
    'HEURISTIC_DIETARY_TAG',
    'MISSING_CULINARY_ROLE',
    'SUBSTITUTION_NEEDS_REVIEW',
    'RETAIL_NEEDS_PRODUCT_MAPPING',
    'LEGACY_PRICE_ONLY',
    'INVALID_COEFFICIENT',
    'POSSIBLE_DUPLICATE',
    'MANUAL'
  )),
  CONSTRAINT "ProductReviewDecision_decision_check" CHECK ("decision" IN (
    'RESOLVED', 'DISMISSED', 'ESCALATED', 'MERGED', 'NEEDS_MORE_INFO'
  ))
);

CREATE INDEX IF NOT EXISTS "ProductReviewDecision_productId_createdAt_idx"
  ON "ProductReviewDecision" ("productId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ProductReviewDecision_queueCode_createdAt_idx"
  ON "ProductReviewDecision" ("queueCode", "createdAt" DESC);

-- Allow OWNER review / heuristic provenance on allergen and dietary links.
ALTER TABLE "ProductAllergen" DROP CONSTRAINT IF EXISTS "ProductAllergen_source_check";
ALTER TABLE "ProductAllergen"
  ADD CONSTRAINT "ProductAllergen_source_check" CHECK ("source" IN (
    'LEGACY_BACKFILL', 'MANUAL', 'IMPORT', 'FIXTURE', 'RECIPE_JSON', 'SYSTEM',
    'HEURISTIC', 'OWNER_REVIEWED'
  ));

ALTER TABLE "ProductDietaryTag" DROP CONSTRAINT IF EXISTS "ProductDietaryTag_source_check";
ALTER TABLE "ProductDietaryTag"
  ADD CONSTRAINT "ProductDietaryTag_source_check" CHECK ("source" IN (
    'LEGACY_BACKFILL', 'MANUAL', 'IMPORT', 'FIXTURE', 'RECIPE_JSON', 'SYSTEM',
    'HEURISTIC', 'OWNER_REVIEWED'
  ));

ALTER TABLE "ProductAlias" DROP CONSTRAINT IF EXISTS "ProductAlias_status_check";
ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_status_check"
  CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'REJECTED', 'NEEDS_REVIEW', 'ARCHIVED'));

ALTER TABLE "ProductCulinaryRole" DROP CONSTRAINT IF EXISTS "ProductCulinaryRole_source_check";
ALTER TABLE "ProductCulinaryRole"
  ADD CONSTRAINT "ProductCulinaryRole_source_check" CHECK ("source" IN (
    'HEURISTIC', 'MANUAL', 'OWNER_REVIEWED', 'IMPORT', 'FIXTURE', 'SYSTEM', 'LEGACY_BACKFILL'
  ));
