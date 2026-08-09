-- RP2-04A STEP_213/214: Recipe External Source Registry + policy evidence
-- No real adapters; no network egress. Seed sources stay PENDING_REVIEW / disabled.

CREATE TABLE IF NOT EXISTS "RecipeExternalSource" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  "baseUrl" text NOT NULL,
  "adapterType" text NOT NULL DEFAULT 'NOT_CONFIGURED',
  "rightsStatus" text NOT NULL DEFAULT 'PENDING_REVIEW',
  "collectionMode" text NOT NULL DEFAULT 'DISABLED',
  "parserVersion" text NOT NULL DEFAULT 'none',
  "rateLimitPerMinute" integer NOT NULL DEFAULT 0,
  "concurrencyLimit" integer NOT NULL DEFAULT 1,
  "requestTimeoutMs" integer NOT NULL DEFAULT 5000,
  enabled boolean NOT NULL DEFAULT false,
  "healthStatus" text NOT NULL DEFAULT 'UNKNOWN',
  "lastSuccessfulCheckAt" timestamptz NULL,
  "lastFailureAt" timestamptz NULL,
  "failureCount" integer NOT NULL DEFAULT 0,
  "lastErrorCode" text NULL,
  "lastErrorMessage" text NULL,
  "reviewedBy" uuid NULL,
  "reviewedAt" timestamptz NULL,
  "reviewExpiresAt" timestamptz NULL,
  "policyReason" text NULL,
  "dataClass" text NOT NULL DEFAULT 'PRODUCTION',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeExternalSource_code_key" UNIQUE (code),
  CONSTRAINT "RecipeExternalSource_rightsStatus_check" CHECK ("rightsStatus" IN (
    'ACTIVE_LICENSED',
    'PUBLIC_RESEARCH_ALLOWED',
    'MANUAL_RESEARCH_ONLY',
    'SUSPENDED',
    'DISABLED_BY_TERMS',
    'DISABLED_BY_REFUSAL',
    'PENDING_REVIEW'
  )),
  CONSTRAINT "RecipeExternalSource_collectionMode_check" CHECK ("collectionMode" IN (
    'API',
    'LICENSED_FEED',
    'PUBLIC_FEED',
    'CONTROLLED_HTML_RESEARCH',
    'MANUAL_ENTRY',
    'MANUAL_REFERENCE_ONLY',
    'DISABLED'
  )),
  CONSTRAINT "RecipeExternalSource_healthStatus_check" CHECK ("healthStatus" IN (
    'UNKNOWN',
    'HEALTHY',
    'DEGRADED',
    'UNHEALTHY',
    'CONFIGURATION_ERROR',
    'CIRCUIT_OPEN'
  )),
  CONSTRAINT "RecipeExternalSource_dataClass_check" CHECK ("dataClass" IN (
    'PRODUCTION',
    'TEST_ONLY',
    'FIXTURE'
  )),
  CONSTRAINT "RecipeExternalSource_rate_check" CHECK ("rateLimitPerMinute" >= 0 AND "rateLimitPerMinute" <= 600),
  CONSTRAINT "RecipeExternalSource_concurrency_check" CHECK ("concurrencyLimit" >= 0 AND "concurrencyLimit" <= 32),
  CONSTRAINT "RecipeExternalSource_timeout_check" CHECK ("requestTimeoutMs" >= 100 AND "requestTimeoutMs" <= 120000),
  CONSTRAINT "RecipeExternalSource_enabled_rights_check" CHECK (
    enabled = false
    OR "rightsStatus" IN ('ACTIVE_LICENSED', 'PUBLIC_RESEARCH_ALLOWED')
  )
);

CREATE INDEX IF NOT EXISTS "RecipeExternalSource_rights_enabled_idx"
  ON "RecipeExternalSource" ("rightsStatus", enabled);

CREATE INDEX IF NOT EXISTS "RecipeExternalSource_adapter_idx"
  ON "RecipeExternalSource" ("adapterType");

CREATE TABLE IF NOT EXISTS "RecipeSourcePolicyEvidence" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sourceId" uuid NOT NULL REFERENCES "RecipeExternalSource"(id) ON DELETE CASCADE,
  "evidenceType" text NOT NULL,
  "referenceUrl" text NULL,
  "documentReference" text NULL,
  "reviewedBy" uuid NULL,
  "reviewedAt" timestamptz NULL,
  "validFrom" timestamptz NULL,
  "validUntil" timestamptz NULL,
  decision text NOT NULL,
  notes text NULL,
  checksum text NULL,
  "attachmentRef" text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeSourcePolicyEvidence_type_check" CHECK ("evidenceType" IN (
    'CONTRACT',
    'LICENSE',
    'TERMS_REVIEW',
    'EMAIL_PERMISSION',
    'PUBLICATION_POLICY',
    'OWNER_DECISION',
    'REFUSAL',
    'LEGAL_REVIEW'
  )),
  CONSTRAINT "RecipeSourcePolicyEvidence_decision_check" CHECK (decision IN (
    'ALLOW',
    'DENY',
    'CONDITIONAL',
    'REVIEW_REQUIRED'
  ))
);

CREATE INDEX IF NOT EXISTS "RecipeSourcePolicyEvidence_source_idx"
  ON "RecipeSourcePolicyEvidence" ("sourceId", "createdAt" DESC);

-- Seed candidate sources as PENDING_REVIEW / disabled / NOT_CONFIGURED (idempotent).
INSERT INTO "RecipeExternalSource" (
  code, name, "baseUrl", "adapterType", "rightsStatus", "collectionMode",
  "parserVersion", "rateLimitPerMinute", "concurrencyLimit", "requestTimeoutMs",
  enabled, "healthStatus", "dataClass", "policyReason"
) VALUES
  (
    'food_ru',
    'Food.ru (candidate)',
    'https://www.food.ru',
    'NOT_CONFIGURED',
    'PENDING_REVIEW',
    'DISABLED',
    'none',
    0,
    0,
    5000,
    false,
    'UNKNOWN',
    'PRODUCTION',
    'Seeded pending OWNER rights review — no adapter, no network'
  ),
  (
    'iamcook',
    'Аймкук (candidate)',
    'https://www.iamcook.ru',
    'NOT_CONFIGURED',
    'PENDING_REVIEW',
    'DISABLED',
    'none',
    0,
    0,
    5000,
    false,
    'UNKNOWN',
    'PRODUCTION',
    'Seeded pending OWNER rights review — no adapter, no network'
  ),
  (
    'russianfood',
    'RussianFood (candidate)',
    'https://www.russianfood.com',
    'NOT_CONFIGURED',
    'PENDING_REVIEW',
    'DISABLED',
    'none',
    0,
    0,
    5000,
    false,
    'UNKNOWN',
    'PRODUCTION',
    'Seeded pending OWNER rights review — no adapter, no network'
  )
ON CONFLICT (code) DO NOTHING;
