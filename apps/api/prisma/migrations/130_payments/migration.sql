CREATE TABLE "Payment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "offerKey" TEXT REFERENCES "ProductOffer"("key") ON DELETE SET NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "status" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" >= 0),
  "currency" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "Payment_provider_providerPaymentId_key" UNIQUE ("provider", "providerPaymentId")
);
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

CREATE TABLE "PaymentEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "paymentId" UUID NOT NULL REFERENCES "Payment"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "providerEventId" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "PaymentEvent_provider_providerEventId_key" UNIQUE ("provider", "providerEventId")
);
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");

CREATE TABLE "Refund" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "paymentId" UUID NOT NULL REFERENCES "Payment"("id") ON DELETE CASCADE,
  "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" > 0),
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "providerRefundId" TEXT UNIQUE,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Refund_paymentId_createdAt_idx" ON "Refund"("paymentId", "createdAt");
