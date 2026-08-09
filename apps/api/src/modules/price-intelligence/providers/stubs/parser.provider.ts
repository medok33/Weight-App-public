import type { PriceProvider, ProviderAvailability, ProviderPrice, ProviderProduct } from '../../domain/price-provider';

/**
 * Future web-parser provider layer.
 * Implement getProducts / getPrices / getAvailability when a parser is approved —
 * Shopping List and Dashboard must not call this class directly.
 */
export class RetailerParserProvider implements PriceProvider {
  readonly id = 'retailer-parser';
  readonly sourceType = 'PARSER' as const;
  readonly sourceName: string;

  constructor(sourceName = 'Web parser') {
    this.sourceName = sourceName;
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
