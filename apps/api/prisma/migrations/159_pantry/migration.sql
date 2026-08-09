-- STEP_175: Pantry + PantryItem (sequence 159; maps to blueprint STEP_175).
CREATE TABLE IF NOT EXISTS "Pantry" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Home',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Pantry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Pantry_userId_key" ON "Pantry"("userId");
CREATE INDEX IF NOT EXISTS "Pantry_userId_idx" ON "Pantry"("userId");

CREATE TABLE IF NOT EXISTS "PantryItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pantryId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  "unit" TEXT NOT NULL DEFAULT 'pcs',
  "expiresOn" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PantryItem_pantryId_fkey" FOREIGN KEY ("pantryId") REFERENCES "Pantry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PantryItem_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "PantryItem_pantryId_idx" ON "PantryItem"("pantryId");
CREATE INDEX IF NOT EXISTS "PantryItem_expiresOn_idx" ON "PantryItem"("expiresOn");
CREATE UNIQUE INDEX IF NOT EXISTS "PantryItem_pantryId_name_unit_key" ON "PantryItem"("pantryId", "name", "unit");
