import type {
  RetailerPriceProvider,
  SyncAvailability,
  SyncCategory,
  SyncPrice,
  SyncProduct,
} from '../domain/retailer-price-provider';
import { normalizeRetailerCode } from '../domain/retailer-entity';

export type CsvCatalogRow = {
  productKey: string;
  name: string;
  category: string;
  weight?: string;
  unit?: string;
  price: number;
  retailer: string;
  retailerCode?: string;
  currency?: string;
  collectedAt?: string;
};

/**
 * First production-shaped provider: validates the engine without any store API/parser.
 * Accepts CSV/XLSX-exported rows (product_key, name, category, weight, price, retailer).
 */
export class CsvRetailerPriceProvider implements RetailerPriceProvider {
  readonly providerId = 'csv-import';
  readonly sourceType = 'CSV' as const;
  readonly sourceName: string;
  readonly retailerCode: string;
  readonly retailerDisplayName: string;
  private readonly rows: CsvCatalogRow[];

  constructor(rows: CsvCatalogRow[], options?: { sourceName?: string; retailerCode?: string }) {
    if (!rows.length) throw new Error('CSV_PROVIDER_EMPTY');
    this.rows = rows;
    this.retailerCode = normalizeRetailerCode(options?.retailerCode ?? rows[0]!.retailerCode ?? rows[0]!.retailer);
    this.retailerDisplayName = rows[0]!.retailer;
    this.sourceName = options?.sourceName ?? 'Импорт CSV';
  }

  async syncCategories(): Promise<SyncCategory[]> {
    const unique = [...new Set(this.rows.map((row) => row.category).filter(Boolean))];
    return unique.map((name) => ({ externalId: name, name }));
  }

  async syncProducts(): Promise<SyncProduct[]> {
    const byKey = new Map<string, SyncProduct>();
    for (const row of this.rows) {
      byKey.set(row.productKey, {
        productKey: row.productKey,
        name: row.name,
        category: row.category || 'other',
        unit: row.unit || 'g',
        weight: row.weight,
      });
    }
    return [...byKey.values()];
  }

  async syncPrices(): Promise<SyncPrice[]> {
    return this.rows.map((row) => ({
      productKey: row.productKey,
      externalId: row.productKey,
      price: row.price,
      currency: row.currency ?? 'RUB',
      collectedAt: row.collectedAt ? new Date(row.collectedAt).toISOString() : new Date().toISOString(),
      weight: row.weight,
      unit: row.unit,
    }));
  }

  async syncAvailability(): Promise<SyncAvailability[]> {
    return this.rows.map((row) => ({ productKey: row.productKey, available: true }));
  }
}

import { validateCsvCatalog } from '../domain/csv-catalog.validator';

export function parseCsvCatalog(csv: string): CsvCatalogRow[] {
  const result = validateCsvCatalog(csv);
  if (!result.valid) throw new Error('PRICE_IMPORT_INVALID');
  return result.rows;
}
