import type {
  RetailerPriceProvider,
  SyncAvailability,
  SyncCategory,
  SyncPrice,
  SyncProduct,
} from '../../domain/retailer-price-provider';

/** Stub — no real Magnit site parsing. Wire when legal/approved. */
export class MagnitParserProvider implements RetailerPriceProvider {
  readonly providerId = 'magnit-parser';
  readonly sourceType = 'PARSER' as const;
  readonly sourceName = 'Магнит каталог';
  readonly retailerCode = 'MAGNIT';

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
