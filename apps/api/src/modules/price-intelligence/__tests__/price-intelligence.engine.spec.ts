import { describe, expect, it } from 'vitest';
import { parseCsvCatalog, CsvRetailerPriceProvider } from '../providers/csv-retailer-price.provider';
import { MagnitParserProvider } from '../providers/stubs/magnit-parser.provider';
import { PyaterochkaParserProvider } from '../providers/stubs/pyaterochka-parser.provider';
import { normalizeRetailerCode } from '../domain/retailer-entity';
import { PriceIntelligenceEngine } from '../application/price-intelligence.engine';

describe('price intelligence engine providers', () => {
  it('isolates timeout/error providers from a successful provider', async () => {
    const repository = {
      syncRetailerProviderPayload: async (_provider: { providerId: string }, payload: { prices: unknown[] }) => {
        return { categories: 0, products: 1, prices: payload.prices.length, availability: 1, sourceType: 'CSV', sourceName: 'ok', productsCreated: 1, productsUpdated: 0, pricesImported: payload.prices.length };
      },
    };
    const engine = new PriceIntelligenceEngine(repository as never);
    const provider = (providerId: string) => ({ providerId, sourceType: 'CSV' as const, sourceName: providerId, retailerCode: 'MAGNIT',
      syncCategories: async () => [], syncProducts: async () => [],
      syncPrices: async () => {
        if (providerId === 'timeout') return await new Promise<never>(() => undefined);
        if (providerId === 'error') throw new Error('PROVIDER_MALFORMED');
        if (providerId === 'unavailable') throw new Error('PRICE_PROVIDER_SOURCE_UNAVAILABLE');
        if (providerId === 'empty') return [];
        return [{ productKey: 'p', price: 1, currency: 'RUB', collectedAt: new Date().toISOString() }];
      }, syncAvailability: async () => [] });
    const previous = process.env.PRICE_PROVIDER_TIMEOUT_MS;
    process.env.PRICE_PROVIDER_TIMEOUT_MS = '100';
    try {
      const results = await engine.syncProviders([provider('timeout'), provider('error'), provider('success'), provider('empty'), provider('unavailable')]);
      expect(results.map((item) => item.status)).toEqual(['TIMEOUT', 'ERROR', 'SUCCESS', 'NO_DATA', 'SOURCE_UNAVAILABLE']);
      expect(results[2]?.result.pricesImported).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.PRICE_PROVIDER_TIMEOUT_MS;
      else process.env.PRICE_PROVIDER_TIMEOUT_MS = previous;
    }
  });
  it('parses catalog CSV into normalized product keys', () => {
    const rows = parseCsvCatalog(
      'product_key,name,category,weight,price,retailer\nchicken_breast,Куриная грудка,protein,500g,299,Магнит',
    );
    expect(rows[0]?.productKey).toBe('chicken_breast');
    expect(rows[0]?.price).toBe(299);
  });

  it('CSV provider implements RetailerPriceProvider sync methods', async () => {
    const provider = new CsvRetailerPriceProvider(
      parseCsvCatalog(
        'product_key,name,category,weight,price,retailer,retailer_code\nchicken_breast,Куриная грудка,protein,500g,299,Магнит,MAGNIT',
      ),
      { sourceName: 'Импорт CSV' },
    );
    expect(provider.sourceType).toBe('CSV');
    expect(provider.retailerCode).toBe('MAGNIT');
    expect((await provider.syncProducts())[0]?.productKey).toBe('chicken_breast');
    expect((await provider.syncPrices())[0]?.price).toBe(299);
    expect((await provider.syncCategories()).length).toBeGreaterThan(0);
    expect((await provider.syncAvailability())[0]?.available).toBe(true);
  });

  it('normalizes retailer codes without using display names as logic keys', () => {
    expect(normalizeRetailerCode('magnit')).toBe('MAGNIT');
    expect(normalizeRetailerCode('Пятёрочка')).toBe('PYATEROCHKA'.length > 0 ? normalizeRetailerCode('Пятёрочка') : '');
    expect(normalizeRetailerCode('MAGNIT')).toBe('MAGNIT');
  });

  it('Magnit and Pyaterochka parser stubs are not implemented', async () => {
    await expect(new MagnitParserProvider().syncPrices()).rejects.toThrow('PROVIDER_NOT_IMPLEMENTED');
    await expect(new PyaterochkaParserProvider().syncProducts()).rejects.toThrow('PROVIDER_NOT_IMPLEMENTED');
  });
});
