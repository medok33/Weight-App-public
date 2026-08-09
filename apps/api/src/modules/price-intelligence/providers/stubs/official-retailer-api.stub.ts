import type {
  RetailerPriceProvider,
  SyncAvailability,
  SyncCategory,
  SyncPrice,
  SyncProduct,
} from '../../domain/retailer-price-provider';

/** Stub — future VkusVill / X5 / Azbuka official API adapter. */
export class OfficialRetailerApiProviderStub implements RetailerPriceProvider {
  readonly providerId: string;
  readonly sourceType = 'API' as const;
  readonly sourceName: string;
  readonly retailerCode: string;

  constructor(options: { retailerCode: string; sourceName: string; providerId?: string }) {
    this.retailerCode = options.retailerCode;
    this.sourceName = options.sourceName;
    this.providerId = options.providerId ?? `${options.retailerCode.toLowerCase()}-api`;
  }

  async syncCategories(): Promise<SyncCategory[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
  async syncProducts(): Promise<SyncProduct[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
  async syncPrices(): Promise<SyncPrice[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
  async syncAvailability(): Promise<SyncAvailability[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
}
