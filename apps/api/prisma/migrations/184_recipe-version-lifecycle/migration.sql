-- RP2-02B STEP_205: RecipeVersion lifecycle state + events (snapshots stay immutable).
-- Operational lifecycle lives outside RecipeVersion content row so status can change
-- without UPDATE of published snapshot payloads.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeVersionLifecycle" (
  "recipeVersionId" uuid PRIMARY KEY REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "lifecycleStatus" text NOT NULL,
  "validationStatus" text NOT NULL DEFAULT 'VALID',
  "revision" integer NOT NULL DEFAULT 1,
  "changedAt" timestamptz NOT NULL DEFAULT now(),
  "changedBy" uuid,
  "reasonCode" text,
  "reasonText" text,
  CONSTRAINT "RecipeVersionLifecycle_lifecycleStatus_check" CHECK ("lifecycleStatus" IN (
    'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'SUSPENDED', 'ARCHIVED', 'REJECTED'
  )),
  CONSTRAINT "RecipeVersionLifecycle_validationStatus_check" CHECK ("validationStatus" IN (
    'VALID', 'NEEDS_REVALIDATION', 'BLOCKED'
  )),
  CONSTRAINT "RecipeVersionLifecycle_revision_check" CHECK ("revision" > 0)
);

CREATE INDEX IF NOT EXISTS "RecipeVersionLifecycle_lifecycleStatus_idx"
  ON "RecipeVersionLifecycle" ("lifecycleStatus");
CREATE INDEX IF NOT EXISTS "RecipeVersionLifecycle_validationStatus_idx"
  ON "RecipeVersionLifecycle" ("validationStatus");

CREATE TABLE IF NOT EXISTS "RecipeVersionLifecycleEvent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "fromStatus" text,
  "toStatus" text NOT NULL,
  "validationFrom" text,
  "validationTo" text,
  "actorId" uuid,
  "reasonCode" text,
  "reasonText" text,
  "requestId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeVersionLifecycleEvent_toStatus_check" CHECK ("toStatus" IN (
    'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'SUSPENDED', 'ARCHIVED', 'REJECTED'
  ))
);

CREATE INDEX IF NOT EXISTS "RecipeVersionLifecycleEvent_version_created_idx"
  ON "RecipeVersionLifecycleEvent" ("recipeVersionId", "createdAt");

-- At most one PUBLISHED lifecycle row per Recipe (via Recipe.currentVersionId congruence enforced in service).
-- Partial unique: one published pointer candidate is soft; hard uniqueness is Recipe.currentVersionId.
