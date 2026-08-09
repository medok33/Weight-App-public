CREATE TABLE IF NOT EXISTS "HealthPlatformConsent" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "providerId" text NOT NULL,
  "dataCategory" text NOT NULL CHECK ("dataCategory" IN ('weight','body_measurements','activity','workouts','calories','nutrition','sleep','heart')),
  direction text NOT NULL CHECK (direction IN ('READ','WRITE')),
  purpose text NOT NULL,
  "consentVersion" text NOT NULL,
  status text NOT NULL CHECK (status IN ('GRANTED','REVOKED','EXPIRED')),
  "grantedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" timestamptz,
  source text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HealthPlatformConsent_active_unique"
  ON "HealthPlatformConsent" ("userId","providerId","dataCategory",direction) WHERE status='GRANTED';
CREATE INDEX IF NOT EXISTS "HealthPlatformConsent_userId_idx" ON "HealthPlatformConsent" ("userId");
CREATE INDEX IF NOT EXISTS "HealthPlatformConsent_providerId_idx" ON "HealthPlatformConsent" ("providerId");
