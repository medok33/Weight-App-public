-- STEP_160: threat / abuse-case review records (sequence 157).
CREATE TABLE IF NOT EXISTS "ThreatReview" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "abuseCase" TEXT NOT NULL,
  "mitigation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThreatReview_title_key" ON "ThreatReview"("title");
CREATE INDEX IF NOT EXISTS "ThreatReview_severity_status_idx" ON "ThreatReview"("severity", "status");
