CREATE TABLE IF NOT EXISTS "RecipeSynthesisBriefApproval" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "briefId" uuid NOT NULL REFERENCES "RecipeSynthesisBrief"("id") ON DELETE CASCADE,
  "briefContentHash" text NOT NULL,
  "decision" text NOT NULL CHECK ("decision" IN ('APPROVE', 'REJECT')),
  "actorId" text NOT NULL,
  "approvedAt" timestamptz NOT NULL,
  UNIQUE ("briefId", "briefContentHash", "decision")
);
CREATE INDEX IF NOT EXISTS "RecipeSynthesisBriefApproval_briefId_idx" ON "RecipeSynthesisBriefApproval" ("briefId");
