CREATE TABLE "EligibilityAssessment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL,
  "answers" jsonb NOT NULL,
  "outcome" text NOT NULL,
  "policyVersion" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "EligibilityAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "EligibilityAssessment_userId_createdAt_idx" ON "EligibilityAssessment"("userId", "createdAt");
