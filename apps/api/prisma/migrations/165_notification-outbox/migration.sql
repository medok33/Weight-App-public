CREATE TABLE IF NOT EXISTS "NotificationOutbox" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL UNIQUE REFERENCES "Notification"(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email','push')),
  status text NOT NULL CHECK (status IN ('PENDING','PROCESSING','DONE','DEAD')) DEFAULT 'PENDING',
  "availableAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts integer NOT NULL DEFAULT 0,
  "lastError" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_availableAt_idx" ON "NotificationOutbox" (status, "availableAt");
