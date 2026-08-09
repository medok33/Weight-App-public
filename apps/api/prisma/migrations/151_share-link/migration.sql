-- STEP_145: ShareLink with TTL and revoke (migration sequence 151)
CREATE TABLE IF NOT EXISTS "ShareLink" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "token" TEXT NOT NULL,
  "exportJobId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShareLink_exportJobId_fkey" FOREIGN KEY ("exportJobId") REFERENCES "ExportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShareLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX IF NOT EXISTS "ShareLink_userId_createdAt_idx" ON "ShareLink"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ShareLink_exportJobId_idx" ON "ShareLink"("exportJobId");
CREATE INDEX IF NOT EXISTS "ShareLink_expiresAt_idx" ON "ShareLink"("expiresAt");
