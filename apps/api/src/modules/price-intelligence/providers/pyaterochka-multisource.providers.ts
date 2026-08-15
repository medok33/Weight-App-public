import type {
  RetailerPriceProvider,
  SyncAvailability,
  SyncCategory,
  SyncPrice,
  SyncProduct,
} from '../domain/retailer-price-provider';

export type PyaterochkaPilotRow = {
  retailer: 'PYATEROCHKA';
  city: string;
  region: string;
  storeId?: string;
  address?: string;
  plu?: string;
  gtin?: string;
  title: string;
  currentPrice: number;
  regularPrice?: number;
  promoPrice?: number;
  currency: 'RUB';
  unitPriceBasis?: boolean;
  availability?: boolean;
  capturedAt: string;
  validFrom?: string;
  validTo?: string;
  sourceUrl: string;
  hash: string;
  scope: 'STORE' | 'CITY_PROMO' | 'RECEIPT_HISTORY';
};

export const PRICE_PROVIDER_PRIORITY = Object.freeze({
  STORE: 4,
  DELIVERY_ADDRESS: 3,
  CITY_PROMO: 2,
  RECEIPT_HISTORY: 1,
  OPEN_CROWD: 0,
});

export function assertFresh(row: PyaterochkaPilotRow, now = new Date(), maxAgeHours = 168): void {
  const captured = new Date(row.capturedAt);
  if (!Number.isFinite(captured.getTime())) throw new Error('PRICE_CAPTURED_AT_INVALID');
  if (captured.getTime() > now.getTime()) throw new Error('PRICE_CAPTURED_AT_FUTURE');
  if (now.getTime() - captured.getTime() > maxAgeHours * 3600_000) throw new Error('PRICE_DATA_STALE');
  if (row.validTo && new Date(row.validTo).getTime() < now.getTime()) throw new Error('PRICE_PROMO_EXPIRED');
}

export function assertRegionalIsolation(rows: PyaterochkaPilotRow[]): void {
  const cities = new Set(rows.map((row) => row.city));
  if (cities.size > 1 && rows.some((row) => !row.city || !row.region)) throw new Error('PRICE_REGION_CONTEXT_MISSING');
  const duplicate = new Set<string>();
  for (const row of rows) {
    const key = `${row.city}:${row.plu ?? row.gtin ?? row.title}`;
    if (duplicate.has(key) && row.scope === 'STORE') throw new Error('PRICE_STORE_DUPLICATE_PLU');
    duplicate.add(key);
  }
}

abstract class PyaterochkaRowsProvider implements RetailerPriceProvider {
  abstract readonly providerId: string;
  abstract readonly sourceType: 'API' | 'PARSER' | 'MANUAL';
  abstract readonly sourceName: string;
  readonly retailerCode = 'PYATEROCHKA';
  protected constructor(protected readonly rows: PyaterochkaPilotRow[]) {
    if (!rows.length) throw new Error('PYATEROCHKA_PROVIDER_EMPTY');
    for (const row of rows) {
      if (row.retailer !== 'PYATEROCHKA' || row.currency !== 'RUB') throw new Error('PYATEROCHKA_PROVIDER_INVALID_ROW');
      assertFresh(row);
    }
    assertRegionalIsolation(rows);
  }

  async syncCategories(): Promise<SyncCategory[]> {
    return [...new Set(this.rows.map((row) => row.scope))].map((scope) => ({ externalId: scope, name: scope }));
  }

  async syncProducts(): Promise<SyncProduct[]> {
    return this.rows.map((row) => ({ productKey: row.plu ?? row.gtin ?? row.title, externalId: row.plu ?? row.gtin, name: row.title, category: row.scope, unit: row.unitPriceBasis ? '100g' : 'item' }));
  }

  async syncPrices(): Promise<SyncPrice[]> {
    return this.rows.map((row) => ({ productKey: row.plu ?? row.gtin ?? row.title, externalId: row.plu ?? row.gtin, price: row.currentPrice, regularPrice: row.regularPrice, promoPrice: row.promoPrice, currency: row.currency, collectedAt: row.capturedAt, validFrom: row.validFrom, validTo: row.validTo, unitPriceBasis: row.unitPriceBasis, location: { scope: row.scope === 'STORE' ? 'STORE' : 'CITY', city: row.city, regionCode: row.region, address: row.address, externalStoreId: row.storeId }, sourceUrl: row.sourceUrl }));
  }

  async syncAvailability(): Promise<SyncAvailability[]> {
    return this.rows.map((row) => ({ productKey: row.plu ?? row.gtin ?? row.title, externalId: row.plu ?? row.gtin, available: row.availability ?? true }));
  }
}

export class PyaterochkaLicensedFeedProvider extends PyaterochkaRowsProvider {
  readonly providerId = 'pyaterochka-licensed-feed';
  readonly sourceType = 'API' as const;
  readonly sourceName = 'Пятёрочка licensed XML/DataFeed pilot';
}

export class PyaterochkaCityPromoProvider extends PyaterochkaRowsProvider {
  readonly providerId = 'pyaterochka-city-promo';
  readonly sourceType = 'PARSER' as const;
  readonly sourceName = 'Пятёрочка city promo (Proshoper/SkidkaOnline)';
}

export class PyaterochkaReceiptObservationProvider extends PyaterochkaRowsProvider {
  readonly providerId = 'pyaterochka-receipt-observation';
  readonly sourceType = 'MANUAL' as const;
  readonly sourceName = 'Пятёрочка receipt observation';
}

export function providerPriority(scope: keyof typeof PRICE_PROVIDER_PRIORITY): number { return PRICE_PROVIDER_PRIORITY[scope]; }
