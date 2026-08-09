CREATE TABLE IF NOT EXISTS "AIMessageFeedback" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "messageId" UUID NOT NULL REFERENCES "AIMessage"(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("userId", "messageId")
);

CREATE INDEX IF NOT EXISTS "AIMessageFeedback_messageId_idx" ON "AIMessageFeedback" ("messageId");
CREATE INDEX IF NOT EXISTS "AIMessageFeedback_createdAt_idx" ON "AIMessageFeedback" ("createdAt");

ALTER TABLE "AIUsageLog" ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE "AIUsageLog" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
