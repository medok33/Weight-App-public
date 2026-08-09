ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "displayName" text;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "ageYears" integer;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "weightKg" numeric(8,2);
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "activityLevel" text;
