-- Preserve the exact domain identity independently from the opaque UUID FK.
-- Legacy rows are intentionally left NULL: deriving dcluster_* from UUID is unsafe.
ALTER TABLE "RecipeSynthesisBrief"
  ADD COLUMN IF NOT EXISTS "domainClusterId" text;
