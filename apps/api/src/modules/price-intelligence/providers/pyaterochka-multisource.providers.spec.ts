import { describe, expect, it } from 'vitest';
import { PRICE_PROVIDER_PRIORITY, PyaterochkaCityPromoProvider, assertFresh, assertRegionalIsolation, providerPriority } from './pyaterochka-multisource.providers';

const row = (overrides: Record<string, unknown> = {}) => ({ retailer: 'PYATEROCHKA' as const, city: 'Москва', region: 'MOW', title: 'Товар', plu: '1', currentPrice: 99, currency: 'RUB' as const, capturedAt: '2026-08-15T06:00:00.000Z', sourceUrl: 'https://proshoper.ru/catalog/1', hash: 'hash', scope: 'CITY_PROMO' as const, ...overrides });

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
});
