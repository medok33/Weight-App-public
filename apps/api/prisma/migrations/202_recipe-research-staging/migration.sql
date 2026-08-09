-- RP2-04B STEP_216/217/218: Recipe research staging foundation.
-- Staging is transport/review only: no Recipe/RecipeVersion/Product creation here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeResearchRequest" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "searchDecisionId" uuid NULL REFERENCES "RecipeSearchDecision"(id) ON DELETE RESTRICT,
  "coverageSlotId" uuid NULL REFERENCES "RecipeCoverageSlot"(id) ON DELETE SET NULL,
  "requestType" text NOT NULL DEFAULT 'SEARCH_DECISION_RESEARCH',
  status text NOT NULL DEFAULT 'READY',
  priority integer NOT NULL DEFAULT 50,
  reason text NOT NULL,
  "idempotencyKey" text NOT NULL,
  "requestedBy" uuid NULL,
  "cancelledBy" uuid NULL,
  "cancelReason" text NULL,
  "inputSnapshotJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "cancelledAt" timestamptz NULL,
  CONSTRAINT "RecipeResearchRequest_type_check" CHECK ("requestType" IN (
    'SEARCH_DECISION_RESEARCH',
    'MANUAL_EDITORIAL_RESEARCH'
  )),
  CONSTRAINT "RecipeResearchRequest_status_check" CHECK (status IN (
    'READY',
    'RUNNING',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'BLOCKED'
  )),
  CONSTRAINT "RecipeResearchRequest_reason_check" CHECK (length(trim(reason)) > 0),
  CONSTRAINT "RecipeResearchRequest_idempotency_key" UNIQUE ("idempotencyKey")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecipeResearchRequest_searchDecision_once_idx"
  ON "RecipeResearchRequest" ("searchDecisionId")
  WHERE "searchDecisionId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "RecipeResearchRequest_status_idx"
  ON "RecipeResearchRequest" (status, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "RecipeResearchRun" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requestId" uuid NOT NULL REFERENCES "RecipeResearchRequest"(id) ON DELETE CASCADE,
  "sourceId" uuid NULL REFERENCES "RecipeExternalSource"(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  "startedAt" timestamptz NULL,
  "completedAt" timestamptz NULL,
  "durationMs" integer NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "correlationId" text NOT NULL,
  "idempotencyKey" text NOT NULL,
  "adapterType" text NULL,
  "parserVersion" text NULL,
  "eligibilitySnapshotJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "inputJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "resultJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "errorCode" text NULL,
  "errorSummary" text NULL,
  "createdBy" uuid NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeResearchRun_operation_check" CHECK (operation IN (
    'TEST_SEARCH_AND_FETCH',
    'FETCH_CANDIDATE',
    'MANUAL_ENTRY',
    'RETENTION'
  )),
  CONSTRAINT "RecipeResearchRun_status_check" CHECK (status IN (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'BLOCKED',
    'CANCELLED'
  )),
  CONSTRAINT "RecipeResearchRun_idempotency_key" UNIQUE ("idempotencyKey")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecipeResearchRun_active_once_idx"
  ON "RecipeResearchRun" ("requestId", COALESCE("sourceId", '00000000-0000-0000-0000-000000000000'::uuid), operation)
  WHERE status IN ('QUEUED', 'RUNNING');

CREATE INDEX IF NOT EXISTS "RecipeResearchRun_request_idx"
  ON "RecipeResearchRun" ("requestId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "RecipeResearchRun_status_idx"
  ON "RecipeResearchRun" (status, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "RecipeSourceRawSnapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "runId" uuid NOT NULL REFERENCES "RecipeResearchRun"(id) ON DELETE RESTRICT,
  "sourceId" uuid NULL REFERENCES "RecipeExternalSource"(id) ON DELETE RESTRICT,
  "externalId" text NULL,
  "sourceUrl" text NULL,
  "parserVersion" text NOT NULL,
  "payloadKind" text NOT NULL DEFAULT 'CANDIDATE_JSON',
  "payloadChecksum" text NOT NULL,
  "payloadBytes" integer NOT NULL DEFAULT 0,
  "inlinePayloadJson" jsonb NULL,
  "objectReference" text NULL,
  "retentionClass" text NOT NULL DEFAULT 'TEST_FIXTURE',
  "deletionStatus" text NOT NULL DEFAULT 'ACTIVE',
  "redactionStatus" text NOT NULL DEFAULT 'NONE',
  "fetchedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NULL,
  "deletedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeSourceRawSnapshot_payload_kind_check" CHECK ("payloadKind" IN (
    'CANDIDATE_JSON',
    'SEARCH_RESULT_JSON',
    'MANUAL_ENTRY_JSON'
  )),
  CONSTRAINT "RecipeSourceRawSnapshot_retention_class_check" CHECK ("retentionClass" IN (
    'TEST_FIXTURE',
    'LIMITED_RESEARCH',
    'METADATA_ONLY'
  )),
  CONSTRAINT "RecipeSourceRawSnapshot_deletion_status_check" CHECK ("deletionStatus" IN (
    'ACTIVE',
    'DELETED',
    'RETAINED_METADATA'
  )),
  CONSTRAINT "RecipeSourceRawSnapshot_redaction_status_check" CHECK ("redactionStatus" IN (
    'NONE',
    'REDACTED',
    'DELETED'
  )),
  CONSTRAINT "RecipeSourceRawSnapshot_storage_check" CHECK (
    "inlinePayloadJson" IS NOT NULL OR "objectReference" IS NOT NULL OR "deletionStatus" <> 'ACTIVE'
  )
);

CREATE INDEX IF NOT EXISTS "RecipeSourceRawSnapshot_checksum_idx"
  ON "RecipeSourceRawSnapshot" ("payloadChecksum");

CREATE INDEX IF NOT EXISTS "RecipeSourceRawSnapshot_retention_idx"
  ON "RecipeSourceRawSnapshot" ("expiresAt", "deletionStatus")
  WHERE "expiresAt" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "RecipeSourceCandidate" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requestId" uuid NOT NULL REFERENCES "RecipeResearchRequest"(id) ON DELETE CASCADE,
  "runId" uuid NOT NULL REFERENCES "RecipeResearchRun"(id) ON DELETE RESTRICT,
  "sourceId" uuid NULL REFERENCES "RecipeExternalSource"(id) ON DELETE RESTRICT,
  "rawSnapshotId" uuid NOT NULL REFERENCES "RecipeSourceRawSnapshot"(id) ON DELETE RESTRICT,
  "externalId" text NOT NULL,
  "sourceUrl" text NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'RAW_CAPTURED',
  "parserVersion" text NOT NULL,
  "sourcePayloadChecksum" text NOT NULL,
  "normalizedCandidateId" uuid NULL,
  "reviewStatus" text NOT NULL DEFAULT 'NOT_NORMALIZED',
  "duplicateHintJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeSourceCandidate_status_check" CHECK (status IN (
    'RAW_CAPTURED',
    'NORMALIZED',
    'NEEDS_REVIEW',
    'REJECTED',
    'ARCHIVED'
  )),
  CONSTRAINT "RecipeSourceCandidate_review_status_check" CHECK ("reviewStatus" IN (
    'NOT_NORMALIZED',
    'READY_FOR_REVIEW',
    'NEEDS_MANUAL_REVIEW',
    'REVIEW_RESOLVED',
    'REJECTED',
    'ARCHIVED'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecipeSourceCandidate_source_external_parser_idx"
  ON "RecipeSourceCandidate" (COALESCE("sourceId", '00000000-0000-0000-0000-000000000000'::uuid), "externalId", "parserVersion");

CREATE INDEX IF NOT EXISTS "RecipeSourceCandidate_request_idx"
  ON "RecipeSourceCandidate" ("requestId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "RecipeNormalizedCandidate" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidateId" uuid NOT NULL REFERENCES "RecipeSourceCandidate"(id) ON DELETE CASCADE,
  version integer NOT NULL,
  "normalizationVersion" text NOT NULL DEFAULT 'recipe-normalization/v1',
  status text NOT NULL DEFAULT 'NORMALIZED',
  "normalizedJson" jsonb NOT NULL,
  "ingredientMappingsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reviewFlagsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "completenessScore" numeric(5,4) NOT NULL DEFAULT 0,
  "nutritionTrustLevel" text NOT NULL DEFAULT 'UNTRUSTED_SOURCE',
  "sourcePayloadChecksum" text NOT NULL,
  "createdBy" uuid NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeNormalizedCandidate_status_check" CHECK (status IN (
    'NORMALIZED',
    'NEEDS_REVIEW',
    'REVIEW_RESOLVED'
  )),
  CONSTRAINT "RecipeNormalizedCandidate_nutrition_trust_check" CHECK ("nutritionTrustLevel" IN (
    'UNTRUSTED_SOURCE',
    'DERIVED_FROM_CATALOG',
    'REVIEWED'
  )),
  CONSTRAINT "RecipeNormalizedCandidate_version_key" UNIQUE ("candidateId", version)
);

CREATE INDEX IF NOT EXISTS "RecipeNormalizedCandidate_candidate_idx"
  ON "RecipeNormalizedCandidate" ("candidateId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "RecipeCandidateReviewItem" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidateId" uuid NOT NULL REFERENCES "RecipeSourceCandidate"(id) ON DELETE CASCADE,
  "normalizedCandidateId" uuid NULL REFERENCES "RecipeNormalizedCandidate"(id) ON DELETE SET NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  severity text NOT NULL DEFAULT 'WARNING',
  "ingredientIndex" integer NULL,
  "sourceValue" text NULL,
  "suggestionJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NULL,
  "resolvedBy" uuid NULL,
  "resolvedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeCandidateReviewItem_type_check" CHECK (type IN (
    'UNKNOWN_PRODUCT',
    'AMBIGUOUS_PRODUCT',
    'UNKNOWN_UNIT',
    'INVALID_QUANTITY',
    'LOW_COMPLETENESS',
    'SOURCE_NUTRITION_UNTRUSTED'
  )),
  CONSTRAINT "RecipeCandidateReviewItem_status_check" CHECK (status IN (
    'OPEN',
    'RESOLVED',
    'DISMISSED'
  )),
  CONSTRAINT "RecipeCandidateReviewItem_severity_check" CHECK (severity IN (
    'INFO',
    'WARNING',
    'BLOCKER'
  ))
);

CREATE INDEX IF NOT EXISTS "RecipeCandidateReviewItem_candidate_status_idx"
  ON "RecipeCandidateReviewItem" ("candidateId", status, "createdAt" DESC);

CREATE OR REPLACE FUNCTION recipe_raw_snapshot_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD."payloadChecksum" IS DISTINCT FROM NEW."payloadChecksum"
    OR OLD."objectReference" IS DISTINCT FROM NEW."objectReference"
    OR (OLD."inlinePayloadJson" IS DISTINCT FROM NEW."inlinePayloadJson" AND NEW."deletionStatus" = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'RECIPE_RAW_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "RecipeSourceRawSnapshot_immutable_payload" ON "RecipeSourceRawSnapshot";
CREATE TRIGGER "RecipeSourceRawSnapshot_immutable_payload"
BEFORE UPDATE ON "RecipeSourceRawSnapshot"
FOR EACH ROW EXECUTE FUNCTION recipe_raw_snapshot_guard();

ALTER TABLE "RecipeSourceCandidate"
  DROP CONSTRAINT IF EXISTS "RecipeSourceCandidate_normalized_fk";
ALTER TABLE "RecipeSourceCandidate"
  ADD CONSTRAINT "RecipeSourceCandidate_normalized_fk"
  FOREIGN KEY ("normalizedCandidateId") REFERENCES "RecipeNormalizedCandidate"(id) ON DELETE SET NULL;
