import type {
  RetailerPriceProvider,
  SyncAvailability,
  SyncCategory,
  SyncPrice,
  SyncProduct,
} from '../domain/retailer-price-provider';

/** Manual admin rows as a RetailerPriceProvider (sourceType=MANUAL). */
export class ManualRetailerPriceProvider implements RetailerPriceProvider {
  readonly providerId = 'manual-admin';
  readonly sourceType = 'MANUAL' as const;
  readonly sourceName: string;
  readonly retailerCode: string;

  constructor(
    private readonly products: SyncProduct[],
    private readonly prices: SyncPrice[],
    options: { retailerCode: string; sourceName?: string },
  ) {
    this.retailerCode = options.retailerCode;
    this.sourceName = options.sourceName ?? 'Ручной импорт';
  }

  async syncCategories(): Promise<SyncCategory[]> {
    return [...new Set(this.products.map((p) => p.category))].map((name) => ({ externalId: name, name }));
  }

  async syncProducts(): Promise<SyncProduct[]> {
    return this.products;
  }

  async syncPrices(): Promise<SyncPrice[]> {
    return this.prices;
  }

  async syncAvailability(): Promise<SyncAvailability[]> {
    return this.products.map((p) => ({ productKey: p.productKey, available: true }));
  }
}
