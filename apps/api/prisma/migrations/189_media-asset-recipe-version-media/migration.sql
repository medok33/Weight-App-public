-- RP2-02C STEP_208: MediaAsset + RecipeVersionMedia (provenance/rights separate from snapshot).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "MediaAsset" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "storageProvider" text NOT NULL DEFAULT 'LOCAL_TEST',
  "storageKey" text,
  "originalFilename" text,
  "mimeType" text,
  "sizeBytes" integer,
  "width" integer,
  "height" integer,
  "checksumSha256" text,
  "sourceType" text NOT NULL,
  "sourceUrl" text,
  "sourceReference" text,
  "rightsHolder" text,
  "licenseType" text NOT NULL DEFAULT 'UNKNOWN',
  "licenseUrl" text,
  "attributionText" text,
  "acquiredAt" timestamptz,
  "rightsValidFrom" timestamptz,
  "rightsValidUntil" timestamptz,
  "regionRestrictionsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "moderationStatus" text NOT NULL DEFAULT 'PENDING',
  "rightsStatus" text NOT NULL DEFAULT 'PENDING_REVIEW',
  "aiProvider" text,
  "aiModel" text,
  "aiGeneratedAt" timestamptz,
  "aiPromptHash" text,
  "aiGenerationPolicyVersion" text,
  "aiReviewer" uuid,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MediaAsset_sourceType_check" CHECK ("sourceType" IN (
    'OWNED_UPLOAD', 'LICENSED_SOURCE', 'PUBLIC_DOMAIN', 'CREATIVE_COMMONS', 'AI_GENERATED', 'LEGACY_UNKNOWN'
  )),
  CONSTRAINT "MediaAsset_licenseType_check" CHECK ("licenseType" IN (
    'ALL_RIGHTS_OWNED', 'COMMERCIAL_LICENSE', 'PUBLIC_DOMAIN', 'CC0', 'CC_BY', 'CC_BY_SA', 'EDITORIAL_ONLY', 'UNKNOWN'
  )),
  CONSTRAINT "MediaAsset_rightsStatus_check" CHECK ("rightsStatus" IN (
    'PENDING_REVIEW', 'APPROVED', 'EXPIRED', 'RESTRICTED', 'REJECTED', 'TAKEDOWN'
  )),
  CONSTRAINT "MediaAsset_moderationStatus_check" CHECK ("moderationStatus" IN (
    'PENDING', 'APPROVED', 'REJECTED', 'BLOCKED'
  )),
  CONSTRAINT "MediaAsset_size_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0)
);

CREATE INDEX IF NOT EXISTS "MediaAsset_rights_moderation_idx"
  ON "MediaAsset" ("rightsStatus", "moderationStatus");
CREATE INDEX IF NOT EXISTS "MediaAsset_sourceType_idx"
  ON "MediaAsset" ("sourceType");
CREATE INDEX IF NOT EXISTS "MediaAsset_checksum_idx"
  ON "MediaAsset" ("checksumSha256");

CREATE TABLE IF NOT EXISTS "RecipeVersionMedia" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "mediaAssetId" uuid NOT NULL REFERENCES "MediaAsset"("id") ON DELETE RESTRICT,
  "role" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "altText" text NOT NULL,
  "caption" text,
  "stepIndex" integer,
  "cropMetadataJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeVersionMedia_role_check" CHECK ("role" IN (
    'HERO', 'GALLERY', 'STEP', 'THUMBNAIL', 'SOCIAL_PREVIEW'
  )),
  CONSTRAINT "RecipeVersionMedia_position_check" CHECK ("position" >= 0),
  CONSTRAINT "RecipeVersionMedia_alt_check" CHECK (length(trim("altText")) > 0),
  CONSTRAINT "RecipeVersionMedia_version_role_position_key" UNIQUE ("recipeVersionId", "role", "position")
);

-- At most one HERO per RecipeVersion.
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeVersionMedia_one_hero_uidx"
  ON "RecipeVersionMedia" ("recipeVersionId")
  WHERE "role" = 'HERO';

CREATE INDEX IF NOT EXISTS "RecipeVersionMedia_mediaAssetId_idx"
  ON "RecipeVersionMedia" ("mediaAssetId");
CREATE INDEX IF NOT EXISTS "RecipeVersionMedia_recipeVersionId_idx"
  ON "RecipeVersionMedia" ("recipeVersionId");
