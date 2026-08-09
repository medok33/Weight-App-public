CREATE TABLE "Product" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "canonicalName" text NOT NULL, "unit" text NOT NULL, "caloriesPer100g" numeric(8,2) NOT NULL, "proteinPer100g" numeric(8,2) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "ProductAlias" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "productId" uuid NOT NULL, "alias" text NOT NULL UNIQUE, CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE);
CREATE INDEX "ProductAlias_productId_idx" ON "ProductAlias"("productId");
