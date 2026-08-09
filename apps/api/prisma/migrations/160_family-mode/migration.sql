-- STEP_180 family mode (sequence 160 follows existing Prisma migration order).
CREATE TABLE IF NOT EXISTS "Family" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  name text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "FamilyMember" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "familyId" uuid NOT NULL REFERENCES "Family"(id) ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER','MEMBER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','REMOVED')),
  "healthShareConsent" boolean NOT NULL DEFAULT false,
  "joinedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" timestamptz
);
CREATE TABLE IF NOT EXISTS "FamilyInvitation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "familyId" uuid NOT NULL REFERENCES "Family"(id) ON DELETE CASCADE,
  "invitedByUserId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "emailOrUsername" text,
  "tokenHash" text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  "expiresAt" timestamptz NOT NULL,
  "acceptedByUserId" uuid REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "FamilyMember_familyId_userId_key" ON "FamilyMember" ("familyId","userId");
CREATE UNIQUE INDEX IF NOT EXISTS "FamilyInvitation_tokenHash_key" ON "FamilyInvitation" ("tokenHash");
CREATE INDEX IF NOT EXISTS "Family_ownerUserId_idx" ON "Family" ("ownerUserId");
CREATE INDEX IF NOT EXISTS "FamilyMember_userId_status_idx" ON "FamilyMember" ("userId",status);
CREATE INDEX IF NOT EXISTS "FamilyInvitation_familyId_status_idx" ON "FamilyInvitation" ("familyId",status);
