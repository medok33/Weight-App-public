CREATE TABLE "FeatureFlag" ("key" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT FALSE, "updatedBy" UUID NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT "FeatureFlag_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id"));
CREATE INDEX "FeatureFlag_enabled_idx" ON "FeatureFlag"("enabled");
