import type { PriceProvider, ProviderAvailability, ProviderPrice, ProviderProduct } from '../../domain/price-provider';

/**
 * Placeholder for a future official retail API provider.
 * Register by retailer.key — never `if (name === '…')` in domain code.
 */
export class OfficialApiProviderStub implements PriceProvider {
  readonly id: string;
  readonly sourceType = 'API' as const;
  readonly sourceName: string;
  readonly retailerKey: string;

  constructor(options: { providerId: string; retailerKey: string; sourceName: string }) {
    this.id = options.providerId;
    this.retailerKey = options.retailerKey;
    this.sourceName = options.sourceName;
  }

  async getProducts(): Promise<ProviderProduct[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
  async getPrices(): Promise<ProviderPrice[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
  async getAvailability(): Promise<ProviderAvailability[]> {
    throw new Error('PROVIDER_NOT_IMPLEMENTED');
  }
}
