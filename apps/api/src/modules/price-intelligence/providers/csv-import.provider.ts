import type { OpenDataPriceRow } from '../domain/price-intelligence.types';
import { retailerRefFromImport } from '../domain/price-intelligence.policy';
import type { PriceProvider, ProviderAvailability, ProviderPrice, ProviderProduct } from '../domain/price-provider';

export class CsvImportProvider implements PriceProvider {
  readonly id = 'csv-import';
  readonly sourceType = 'CSV' as const;
  readonly sourceName: string;

  constructor(
    private readonly rows: OpenDataPriceRow[],
    sourceName = 'Импорт CSV',
  ) {
    this.sourceName = sourceName;
  }

  async getProducts(): Promise<ProviderProduct[]> {
    return this.rows.map((row, index) => ({
      externalId: row.productKey ?? `csv-${index}`,
      productKey: row.productKey,
      name: row.productName,
      category: row.category,
      brand: row.brand,
      weight: row.weight,
    }));
  }

  async getPrices(): Promise<ProviderPrice[]> {
    return this.rows.map((row, index) => ({
      productKey: row.productKey,
      externalId: row.productKey ?? `csv-${index}`,
      name: row.productName,
      price: row.price,
      currency: row.currency ?? 'RUB',
      retailer: retailerRefFromImport(row),
      collectedAt: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
    }));
  }

  async getAvailability(): Promise<ProviderAvailability[]> {
    return this.rows.map((row, index) => ({
      productKey: row.productKey,
      externalId: row.productKey ?? `csv-${index}`,
      name: row.productName,
      available: true,
      retailer: retailerRefFromImport(row),
    }));
  }
}
