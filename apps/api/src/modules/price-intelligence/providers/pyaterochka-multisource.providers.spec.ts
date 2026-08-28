import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { CITY_PROMO_DISCLAIMER, PRICE_PROVIDER_PRIORITY, PyaterochkaCityPromoProvider, PyaterochkaLicensedFeedProvider, PyaterochkaReceiptObservationProvider, assertFresh, assertRegionalIsolation, buildCityPromoIdentity, providerPriority, selectCityPromoRows } from './pyaterochka-multisource.providers';

const row = (overrides: Record<string, unknown> = {}) => ({ retailer: 'PYATEROCHKA' as const, city: 'Москва', region: 'MOW', title: 'Товар', plu: '1', currentPrice: 99, currency: 'RUB' as const, capturedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), sourceUrl: 'https://proshoper.ru/catalog/1', hash: 'hash', scope: 'CITY_PROMO' as const, ...overrides });

describe('Pyaterochka multisource providers', () => {
  it('maps city promo rows without promoting scope to STORE', async () => {
    const provider = new PyaterochkaCityPromoProvider([row()]);
    const prices = await provider.syncPrices();
    expect(prices[0]?.location?.scope).toBe('CITY');
    expect(providerPriority('CITY_PROMO')).toBeLessThan(providerPriority('STORE'));
    expect([PRICE_PROVIDER_PRIORITY.STORE, PRICE_PROVIDER_PRIORITY.DELIVERY_ADDRESS, PRICE_PROVIDER_PRIORITY.CITY_PROMO, PRICE_PROVIDER_PRIORITY.RECEIPT_HISTORY, PRICE_PROVIDER_PRIORITY.OPEN_CROWD]).toEqual([4, 3, 2, 1, 0]);
  });
  it('rejects stale and expired rows', () => {
    expect(() => assertFresh(row({ capturedAt: '2025-01-01T00:00:00.000Z' }), new Date('2026-08-15T00:00:00.000Z'))).toThrow('PRICE_DATA_STALE');
    expect(() => assertFresh(row({ capturedAt: '2026-08-14T12:00:00.000Z', validTo: '2026-08-14T00:00:00.000Z' }), new Date('2026-08-15T00:00:00.000Z'))).toThrow('PRICE_PROMO_EXPIRED');
  });
  it('rejects store duplicate PLU within one city', () => expect(() => assertRegionalIsolation([row({ scope: 'STORE' }), row({ scope: 'STORE' })])).toThrow('PRICE_STORE_DUPLICATE_PLU'));
  it('uses city/catalog/validity identity when PLU and GTIN are absent', () => {
    const moscow = row({ plu: undefined, gtin: undefined, title: 'Молоко 3,2%', catalogId: '329728', validFrom: '2026-08-11', validTo: '2026-08-17' });
    const kovrov = row({ plu: undefined, gtin: undefined, city: 'Ковров', region: 'VLA', title: 'Молоко 3,2%', catalogId: '329738', validFrom: '2026-08-11', validTo: '2026-08-17' });
    expect(buildCityPromoIdentity(moscow)).not.toBe(buildCityPromoIdentity(kovrov));
    expect(() => assertRegionalIsolation([moscow, { ...moscow, currentPrice: 100 }])).toThrow('PRICE_CITY_PROMO_IDENTITY_COLLISION');
  });
  it('keeps CITY_PROMO isolated from STORE and excludes expired rows', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-16T12:00:00.000Z') });
    const city = row({ plu: undefined, gtin: undefined, validTo: '2026-08-17T23:59:59.999Z', regularPrice: 120, promoPrice: 99, unitPriceBasis: true });
    const expiredCity = { ...city, validTo: '2026-08-17T00:00:00.000Z' };
    try {
      expect(selectCityPromoRows([city, { ...city, scope: 'STORE' }], 'Москва', new Date('2026-08-16T12:00:00.000Z'))).toHaveLength(1);
      expect(selectCityPromoRows([expiredCity], 'Москва', new Date('2026-08-18T00:00:00.000Z'))).toHaveLength(0);
      const prices = await new PyaterochkaCityPromoProvider([city]).syncPrices();
      expect(prices[0]).toMatchObject({ regularPrice: 120, promoPrice: 99, unitPriceBasis: true, sourceUrl: 'https://proshoper.ru/catalog/1' });
      expect(CITY_PROMO_DISCLAIMER).toContain('может отличаться');
    } finally {
      vi.useRealTimers();
    }
  });
  it('fails closed for title-only precise-scope identity', () => {
    expect(() => new PyaterochkaLicensedFeedProvider([row({ plu: undefined, gtin: undefined, scope: 'STORE', storeId: '389698' })])).toThrow('PRICE_PRECISE_SCOPE_IDENTIFIER_REQUIRED');
    expect(() => new PyaterochkaLicensedFeedProvider([row({ plu: undefined, gtin: undefined, scope: 'DELIVERY_ADDRESS', address: 'Первомайская, 17' })])).toThrow('PRICE_PRECISE_SCOPE_IDENTIFIER_REQUIRED');
  });
  it('fails closed for title-only non-precise identity too', () => {
    expect(() => new PyaterochkaReceiptObservationProvider([row({ plu: undefined, gtin: undefined, catalogId: undefined, scope: 'RECEIPT_HISTORY' })])).toThrow('PRICE_RETAILER_PRODUCT_IDENTIFIER_REQUIRED');
  });
});
