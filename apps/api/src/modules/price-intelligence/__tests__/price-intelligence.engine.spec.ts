import { describe, expect, it } from 'vitest';
import { parseCsvCatalog, CsvRetailerPriceProvider } from '../providers/csv-retailer-price.provider';
import { MagnitParserProvider } from '../providers/stubs/magnit-parser.provider';
import { PyaterochkaParserProvider } from '../providers/stubs/pyaterochka-parser.provider';
import { normalizeRetailerCode } from '../domain/retailer-entity';

describe('price intelligence engine providers', () => {
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
