-- STEP-322..328: persisted research-layer synthesis objects.
-- These tables never write Product, Recipe, RecipeVersion, or published content.
CREATE TABLE IF NOT EXISTS "DishConceptCluster" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clusterVersion" text NOT NULL,
  "conceptKey" text NOT NULL,
  "displayLabel" text NOT NULL,
  "candidateIds" jsonb NOT NULL,
  "sourceCount" integer NOT NULL CHECK ("sourceCount" >= 1),
  "sourceCodes" jsonb NOT NULL,
  "representativeCandidateId" text NOT NULL,
  "ingredientSignature" jsonb NOT NULL,
  "techniqueSignature" jsonb NOT NULL,
  "slotHints" jsonb NOT NULL,
  "fingerprint" text NOT NULL UNIQUE,
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE', 'CLUSTER_REVIEW_REQUIRED')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "RecipeResearchFact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clusterId" uuid NOT NULL REFERENCES "DishConceptCluster"("id") ON DELETE CASCADE,
  "factType" text NOT NULL,
  "normalizedValue" text NOT NULL,
  "unit" text,
  "supportingCandidateIds" jsonb NOT NULL,
  "supportingSourceCodes" jsonb NOT NULL,
  "supportingCandidateCount" integer NOT NULL CHECK ("supportingCandidateCount" >= 1),
  "confidence" numeric(5,4) NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
  "conflictLevel" text NOT NULL CHECK ("conflictLevel" IN ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
  "requiresReview" boolean NOT NULL,
  "provenance" jsonb NOT NULL,
  "derivedAt" timestamptz NOT NULL,
  UNIQUE ("clusterId", "factType", "normalizedValue", "unit")
);

CREATE TABLE IF NOT EXISTS "RecipeSynthesisBrief" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "briefVersion" text NOT NULL,
  "clusterId" uuid NOT NULL REFERENCES "DishConceptCluster"("id") ON DELETE CASCADE,
  "coverageSlot" text NOT NULL,
  "objective" text NOT NULL,
  "approvedProducts" jsonb NOT NULL,
  "forbiddenProducts" jsonb NOT NULL,
  "targetNutrition" jsonb,
  "targetCost" numeric(12,2),
  "targetCookTime" integer,
  "allowedEquipment" jsonb NOT NULL,
  "requiredTechniques" jsonb NOT NULL,
  "optionalTechniques" jsonb NOT NULL,
  "requiredFacts" jsonb NOT NULL,
  "conflictingFacts" jsonb NOT NULL,
  "unresolvedFacts" jsonb NOT NULL,
  "differentiationReason" text NOT NULL,
  "evidenceSummary" jsonb NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED_FOR_SYNTHESIS', 'BLOCKED_CONFLICT', 'REJECTED')),
  "approvalState" text NOT NULL CHECK ("approvalState" IN ('PENDING', 'OWNER_APPROVED', 'SYSTEM_BLOCKED')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "RecipeResearchFact_clusterId_idx" ON "RecipeResearchFact" ("clusterId");
CREATE INDEX IF NOT EXISTS "RecipeSynthesisBrief_clusterId_idx" ON "RecipeSynthesisBrief" ("clusterId");
