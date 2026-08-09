CREATE TABLE "ShoppingList" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ShoppingList_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ShoppingItem" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "shoppingListId" UUID NOT NULL, "productId" UUID, "quantity" DECIMAL(10,2) NOT NULL, "unit" TEXT NOT NULL, CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ShoppingList_userId_createdAt_idx" ON "ShoppingList"("userId", "createdAt");
CREATE INDEX "ShoppingItem_shoppingListId_idx" ON "ShoppingItem"("shoppingListId");
CREATE INDEX "ShoppingItem_productId_idx" ON "ShoppingItem"("productId");
ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
