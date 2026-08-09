import type { ManualPriceRow } from '../domain/price-intelligence.types';
import { retailerRefFromImport } from '../domain/price-intelligence.policy';
import type { PriceProvider, ProviderAvailability, ProviderPrice, ProviderProduct } from '../domain/price-provider';

export class ManualProvider implements PriceProvider {
  readonly id = 'manual';
  readonly sourceType = 'MANUAL' as const;
  readonly sourceName: string;

  constructor(
    private readonly rows: ManualPriceRow[],
    sourceName = 'Ручной импорт',
  ) {
    this.sourceName = sourceName;
  }

  async getProducts(): Promise<ProviderProduct[]> {
    return this.rows.map((row) => ({
      externalId: row.productKey,
      productKey: row.productKey,
      name: row.name,
    }));
  }

  async getPrices(): Promise<ProviderPrice[]> {
    return this.rows.map((row) => ({
      productKey: row.productKey,
      externalId: row.productKey,
      name: row.name,
      price: row.price,
      currency: row.currency ?? 'RUB',
      retailer: retailerRefFromImport(row),
      collectedAt: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
    }));
  }

  async getAvailability(): Promise<ProviderAvailability[]> {
    return this.rows.map((row) => ({
      productKey: row.productKey,
      externalId: row.productKey,
      name: row.name,
      available: true,
      retailer: retailerRefFromImport(row),
    }));
  }
}
