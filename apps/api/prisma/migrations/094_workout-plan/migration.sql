CREATE TABLE "WorkoutPlan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL,
  "version" integer NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("userId", "version")
);

CREATE TABLE "WorkoutPlanDay" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workoutPlanId" uuid NOT NULL REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE,
  "dayIndex" integer NOT NULL,
  "exerciseName" text NOT NULL,
  "riskLevel" text NOT NULL DEFAULT 'low',
  UNIQUE("workoutPlanId", "dayIndex")
);

CREATE INDEX "WorkoutPlan_userId_version_idx" ON "WorkoutPlan" ("userId", "version");
