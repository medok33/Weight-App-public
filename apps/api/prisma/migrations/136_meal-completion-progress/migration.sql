CREATE TABLE "MealCompletion" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "mealId" UUID NOT NULL REFERENCES "Meal"("id") ON DELETE CASCADE,
  "planId" UUID NOT NULL REFERENCES "Plan"("id") ON DELETE CASCADE,
  "dayIndex" INT NOT NULL,
  "calories" DECIMAL(8,2) NOT NULL,
  "proteinG" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "localDate" DATE NOT NULL,
  "completedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "MealCompletion_userId_mealId_localDate_key" UNIQUE ("userId", "mealId", "localDate")
);
CREATE INDEX "MealCompletion_userId_localDate_idx" ON "MealCompletion"("userId", "localDate");
CREATE INDEX "MealCompletion_mealId_idx" ON "MealCompletion"("mealId");

CREATE TABLE "ProgressEntry" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "weightKg" DECIMAL(8,2) NOT NULL,
  "measuredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ProgressEntry_userId_measuredAt_idx" ON "ProgressEntry"("userId", "measuredAt");
