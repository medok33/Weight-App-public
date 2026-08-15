import type { PriceSourceType } from './price-intelligence.types';
import type { RetailerEntity } from './retailer-entity';

export type SyncCategory = {
  externalId: string;
  name: string;
  parentExternalId?: string;
};

export type SyncProduct = {
  productKey: string;
  name: string;
  category: string;
  unit: string;
  weight?: string;
  externalId?: string;
};

export type SyncPrice = {
  productKey: string;
  externalId?: string;
  price: number;
  currency: string;
  collectedAt: string;
  weight?: string;
  unit?: string;
  location?: PriceLocation;
  regularPrice?: number;
  promoPrice?: number;
  unitPriceBasis?: boolean;
  validFrom?: string;
  validTo?: string;
  sourceUrl?: string;
};

export type PriceLocation = {
  scope: 'STORE' | 'CITY' | 'REGION' | 'UNKNOWN';
  regionCode?: string;
  externalStoreId?: string;
  storeName?: string;
  city?: string;
  address?: string;
};

export type SyncAvailability = {
  productKey: string;
  available: boolean;
  externalId?: string;
};

export type RetailerSyncResult = {
  categories: number;
  products: number;
  prices: number;
  availability: number;
};

/**
 * Unified retailer data-source contract for the Price Intelligence Engine.
 *
 * Official API | Web Parser | CSV/XLSX Import | Manual Admin
 * all implement this interface. Downstream modules never call a specific store SDK.
 */
export interface RetailerPriceProvider {
  /** Stable provider id, e.g. `csv-import`, `magnit-parser`. */
  readonly providerId: string;
  readonly sourceType: PriceSourceType;
  /** Human label for UI, e.g. `Импорт CSV`, `Магнит каталог`. */
  readonly sourceName: string;
  /** Retailer catalog code this provider feeds (MAGNIT, PYATEROCHKA, …). */
  readonly retailerCode: string;

  syncCategories(signal?: AbortSignal): Promise<SyncCategory[]>;
  syncProducts(signal?: AbortSignal): Promise<SyncProduct[]>;
  syncPrices(signal?: AbortSignal): Promise<SyncPrice[]>;
  syncAvailability(signal?: AbortSignal): Promise<SyncAvailability[]>;
}

export type RetailerProviderPayload = {
  categories: SyncCategory[];
  products: SyncProduct[];
  prices: SyncPrice[];
  availability: SyncAvailability[];
};

export type ProviderSyncContext = {
  retailer: RetailerEntity;
  provider: RetailerPriceProvider;
};
