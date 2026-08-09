CREATE TABLE "Recipe" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL, "servings" integer NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "RecipeIngredient" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "recipeId" uuid NOT NULL, "productId" uuid NOT NULL, "quantity" numeric(10,2) NOT NULL, "unit" text NOT NULL, CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE, CONSTRAINT "RecipeIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id"));
CREATE INDEX "RecipeIngredient_recipeId_idx" ON "RecipeIngredient"("recipeId");
CREATE INDEX "RecipeIngredient_productId_idx" ON "RecipeIngredient"("productId");
