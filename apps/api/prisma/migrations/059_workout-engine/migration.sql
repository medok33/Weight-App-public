CREATE TABLE "Exercise" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL, "riskLevel" text NOT NULL DEFAULT 'low');
CREATE TABLE "WorkoutTemplate" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
