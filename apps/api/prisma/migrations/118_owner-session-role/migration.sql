ALTER TABLE "Session" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';
CREATE INDEX "Session_role_idx" ON "Session"("role");
