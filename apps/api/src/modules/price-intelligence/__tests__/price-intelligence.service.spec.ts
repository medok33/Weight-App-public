import { describe, expect, it } from 'vitest';
import {
  parseManualCsv,
  parseOpenDataCsv,
  parseOpenDataJson,
  parseOpenDataXml,
  rankSources,
  retailerRefFromImport,
} from '../domain/price-intelligence.policy';
import { normalizeRetailerRef } from '../domain/retailer.types';
import { MockOfficialApiProvider } from '../providers/mock-official-api.provider';
import { ManualProvider } from '../providers/manual.provider';
import { CsvImportProvider } from '../providers/csv-import.provider';
import { OfficialApiProviderStub } from '../providers/stubs/official-api-provider.stub';

describe('price intelligence sources', () => {
  it('ranks API over CSV/MANUAL for the same product age', () => {
    const now = new Date().toISOString();
    const result = rankSources([
      {
        productId: 'p',
        storeId: 's',
        price: 200,
        currency: 'RUB',
        sourceType: 'MANUAL',
        sourceName: 'Ручной',
        observedAt: now,
        collectedAt: now,
        acquiredAt: now,
        acquisitionTimeQuality: 'MEASURED',
        dataClass: 'PRODUCTION',
      },
      {
        productId: 'p',
        storeId: 's',
        price: 299,
        currency: 'RUB',
        sourceType: 'API',
        sourceName: 'Mock Official API',
        observedAt: now,
        collectedAt: now,
        acquiredAt: now,
        acquisitionTimeQuality: 'MEASURED',
        dataClass: 'PRODUCTION',
      },
    ]);
    expect(result?.price).toBe(299);
    expect(result?.sourceType).toBe('API');
  });

  it('never ranks normalized-only evidence as a current snapshot', () => {
    const now = new Date().toISOString();
    expect(rankSources([{
      productId: 'p', storeId: 's', price: 200, currency: 'RUB', sourceType: 'API', sourceName: 'normalized',
      observedAt: now, collectedAt: now, acquiredAt: now, acquisitionTimeQuality: 'NORMALIZED_ONLY', dataClass: 'PRODUCTION',
    }])).toBeUndefined();
  });

  it('normalizes retailer by key/type — not display name', () => {
    const ref = normalizeRetailerRef({ key: 'chain_alpha', name: 'Ритейлер A', type: 'CHAIN' });
    expect(ref.key).toBe('chain_alpha');
    expect(ref.type).toBe('CHAIN');
    const fromImport = retailerRefFromImport({
      retailer: 'Любое отображаемое имя',
      retailerKey: 'chain_beta',
      retailerType: 'DISCOUNTER',
    });
    expect(fromImport.key).toBe('chain_beta');
    expect(fromImport.type).toBe('DISCOUNTER');
  });

  it('parses open-data CSV with retailer_key and retailer_type', () => {
    const rows = parseOpenDataCsv(
      'product_name,category,brand,weight,price,retailer_key,retailer_type,retailer,date\nОвсянка,grains,Brand,500g,95,chain_b,CHAIN,Ритейлер B,2026-07-21',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.retailerKey).toBe('chain_b');
    expect(rows[0]?.retailerType).toBe('CHAIN');
  });

  it('parses open-data JSON and XML', () => {
    expect(
      parseOpenDataJson(
        JSON.stringify([{ product_name: 'Овсянка', price: 98, retailer_key: 'chain_c', retailer_type: 'CHAIN', retailer: 'Ритейлер C' }]),
      )[0]?.retailerKey,
    ).toBe('chain_c');
    expect(
      parseOpenDataXml(
        '<items><item><product_name>Молоко</product_name><price>85</price><retailer_key>chain_d</retailer_key><retailer_type>LOCAL</retailer_type><retailer>Ритейлер D</retailer></item></items>',
      )[0]?.retailerKey,
    ).toBe('chain_d');
  });

  it('parses manual admin CSV with retailer_key', () => {
    const rows = parseManualCsv(
      'product_key,name,price,retailer_key,retailer_type,retailer\nchicken_breast,Куриная грудка,299,chain_e,DISCOUNTER,Ритейлер E',
    );
    expect(rows[0]?.retailerKey).toBe('chain_e');
    expect(rows[0]?.retailerType).toBe('DISCOUNTER');
  });

  it('mock official API provider returns prices with retailer key', async () => {
    const provider = new MockOfficialApiProvider();
    const prices = await provider.getPrices();
    expect(provider.sourceType).toBe('API');
    expect(prices[0]?.retailer.key).toBe('mock_chain_alpha');
    expect(prices[0]?.retailer.type).toBe('CHAIN');
  });

  it('csv and manual providers expose retailer refs', async () => {
    const csv = new CsvImportProvider(
      [{ productName: 'Рис', price: 110, retailer: 'Ритейлер F', retailerKey: 'chain_f', retailerType: 'CHAIN' }],
      'Импорт Excel 2026-07-21',
    );
    const manual = new ManualProvider([
      { productKey: 'rice', name: 'Рис', price: 110, retailer: 'Ритейлер G', retailerKey: 'chain_g', retailerType: 'HYPERMARKET' },
    ]);
    expect((await csv.getPrices())[0]?.retailer.key).toBe('chain_f');
    expect((await manual.getPrices())[0]?.retailer.type).toBe('HYPERMARKET');
  });

  it('official API stub is not implemented yet', async () => {
    const stub = new OfficialApiProviderStub({
      providerId: 'partner-api-stub',
      retailerKey: 'partner_chain_stub',
      sourceName: 'Partner API',
    });
    await expect(stub.getPrices()).rejects.toThrow('PROVIDER_NOT_IMPLEMENTED');
  });
});
