-- 148: extend profile/goal for AI Goal Core personalization
ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "trainingLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "workoutsPerWeek" INT,
  ADD COLUMN IF NOT EXISTS "dietaryPreferences" TEXT,
  ADD COLUMN IF NOT EXISTS "foodRestrictions" TEXT,
  ADD COLUMN IF NOT EXISTS "availableEquipment" TEXT;

ALTER TABLE "UserGoal"
  ADD COLUMN IF NOT EXISTS "targetDate" DATE;
