import type { PriceProvider, ProviderAvailability, ProviderPrice, ProviderProduct } from '../domain/price-provider';

const MOCK_RETAILER = {
  key: 'mock_chain_alpha',
  name: 'Ритейлер A',
  type: 'CHAIN' as const,
};

/** Mock stand-in for any official retail API — no brand-specific business logic. */
export class MockOfficialApiProvider implements PriceProvider {
  readonly id = 'mock-official-api';
  readonly sourceType = 'API' as const;
  readonly sourceName: string;

  constructor(sourceName = 'Mock Official API') {
    this.sourceName = sourceName;
  }

  async getProducts(): Promise<ProviderProduct[]> {
    return [
      { externalId: 'sku-chicken', productKey: 'chicken_breast', name: 'Куриная грудка', category: 'protein', brand: 'Store brand', weight: '500g' },
      { externalId: 'sku-yogurt', productKey: 'greek_yogurt', name: 'Греческий йогурт', category: 'dairy', brand: 'Store brand', weight: '400g' },
      { externalId: 'sku-oats', productKey: 'oats', name: 'Овсянка', category: 'grains', brand: 'Store brand', weight: '500g' },
    ];
  }

  async getPrices(): Promise<ProviderPrice[]> {
    const collectedAt = new Date().toISOString();
    return [
      { externalId: 'sku-chicken', productKey: 'chicken_breast', name: 'Куриная грудка', price: 349, currency: 'RUB', retailer: MOCK_RETAILER, collectedAt },
      { externalId: 'sku-yogurt', productKey: 'greek_yogurt', name: 'Греческий йогурт', price: 129, currency: 'RUB', retailer: MOCK_RETAILER, collectedAt },
      { externalId: 'sku-oats', productKey: 'oats', name: 'Овсянка', price: 98, currency: 'RUB', retailer: MOCK_RETAILER, collectedAt },
    ];
  }

  async getAvailability(): Promise<ProviderAvailability[]> {
    return (await this.getProducts()).map((product) => ({
      externalId: product.externalId,
      productKey: product.productKey,
      name: product.name,
      available: true,
      retailer: MOCK_RETAILER,
    }));
  }
}
