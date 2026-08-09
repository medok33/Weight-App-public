import type {
  RetailerPriceProvider,
  SyncAvailability,
  SyncCategory,
  SyncPrice,
  SyncProduct,
} from '../../domain/retailer-price-provider';

/** Stub — no real Pyaterochka site parsing. Wire when legal/approved. */
export class PyaterochkaParserProvider implements RetailerPriceProvider {
  readonly providerId = 'pyaterochka-parser';
  readonly sourceType = 'PARSER' as const;
  readonly sourceName = 'Пятёрочка каталог';
  readonly retailerCode = 'PYATEROCHKA';

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
