export type ShoppingItem = {
  id: string;
  productId?: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  estimatedUnitPrice: number;
  estimatedCost: number;
  priceSourceType?: string;
  priceSourceName?: string;
  priceCollectedAt?: string;
  retailerName?: string;
  retailerCode?: string;
};

export type ShoppingListSyncStatus = 'current' | 'stale' | 'rebuilding' | 'failed' | 'unknown';

export type ShoppingList = {
  id: string;
  userId: string;
  createdAt: string;
  sourcePlanId?: string | null;
  sourcePlanVersion?: number | null;
  generationStatus?: string;
  generatedAt?: string;
  syncStatus?: ShoppingListSyncStatus;
  estimatedTotal: number;
  purchasedTotal: number;
  remainingTotal: number;
  items: ShoppingItem[];
};
