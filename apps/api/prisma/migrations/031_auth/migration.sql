CREATE TABLE "User" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "AuthIdentity" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "provider" text NOT NULL, "providerSubject" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("provider","providerSubject"));
CREATE TABLE "Session" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "tokenHash" text UNIQUE NOT NULL, "expiresAt" timestamptz NOT NULL, "revokedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId","expiresAt");
