-- STEP_093 consistency: ShoppingList ↔ Meal Plan version linkage
ALTER TABLE "ShoppingList"
  ADD COLUMN IF NOT EXISTS "sourcePlanId" uuid,
  ADD COLUMN IF NOT EXISTS "sourcePlanVersion" integer,
  ADD COLUMN IF NOT EXISTS "generationStatus" text NOT NULL DEFAULT 'CURRENT',
  ADD COLUMN IF NOT EXISTS "generatedAt" timestamptz NOT NULL DEFAULT now();

ALTER TABLE "ShoppingList"
  DROP CONSTRAINT IF EXISTS "ShoppingList_generationStatus_check";

ALTER TABLE "ShoppingList"
  ADD CONSTRAINT "ShoppingList_generationStatus_check"
  CHECK ("generationStatus" IN ('CURRENT', 'STALE', 'REBUILDING', 'FAILED'));

-- One shopping list row per user + meal-plan version (idempotent rebuild / confirm replay).
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingList_userId_sourcePlanVersion_uidx"
  ON "ShoppingList" ("userId", "sourcePlanVersion")
  WHERE "sourcePlanVersion" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ShoppingList_userId_generationStatus_idx"
  ON "ShoppingList" ("userId", "generationStatus");
