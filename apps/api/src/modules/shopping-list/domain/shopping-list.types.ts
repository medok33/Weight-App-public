export type ShoppingCategory =
  | 'dairy'
  | 'produce'
  | 'vegetables'
  | 'fruit'
  | 'protein'
  | 'grains'
  | 'pantry'
  | 'other';

export type CatalogIngredient = {
  productKey: string;
  name: string;
  category: ShoppingCategory;
  quantity: number;
  unit: string;
  packageSize: number;
  fallbackUnitPrice: number;
};

export type ShoppingItemInput = {
  productId?: string;
  productKey?: string;
  name?: string;
  category?: ShoppingCategory;
  quantity: number;
  unit: string;
  packageSize?: number;
  packagePrice?: number;
};

export type ShoppingItemRecord = {
  id: string;
  productId?: string;
  name: string;
  category: ShoppingCategory;
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
  /** From latest PriceObservation when joined on read. */
  priceDataClass?: string;
};

export type ShoppingListGenerationStatus = 'CURRENT' | 'STALE' | 'REBUILDING' | 'FAILED';

export type ShoppingListSyncStatus = 'current' | 'stale' | 'rebuilding' | 'failed' | 'unknown';

export type ShoppingListRecord = {
  id: string;
  userId: string;
  createdAt: string;
  sourcePlanId: string | null;
  sourcePlanVersion: number | null;
  generationStatus: ShoppingListGenerationStatus;
  generatedAt: string;
  syncStatus: ShoppingListSyncStatus;
  estimatedTotal: number;
  purchasedTotal: number;
  remainingTotal: number;
  items: ShoppingItemRecord[];
};

export type ShoppingBudget = {
  todayCost: number;
  weekCost: number;
  currency: 'RUB';
};
