import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { PriceIntelligenceRepository } from '../../src/modules/price-intelligence/infrastructure/price-intelligence.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const fixturePath = resolve(process.cwd(), 'test/fixtures/price-02j-evidence.json');

describeDb('PRICE-02J canonical evidence persistence', () => {
  const db = new PrismaService();
  const repo = new PriceIntelligenceRepository(db);
  const suffix = `price02j_${Date.now()}`;
  const created: { retailerId: string; storeId: string; productId: string }[] = [];

  beforeAll(async () => {
    expect(existsSync(fixturePath)).toBe(true);
    expect(JSON.parse(readFileSync(fixturePath, 'utf8')).fixtureAsLive).toBe(false);
    await db.onModuleInit();
  });

  afterAll(async () => {
    for (const item of created.reverse()) {
      await db.query('DELETE FROM "PriceObservation" WHERE "productId"=$1', [item.productId]);
      await db.query('DELETE FROM "RetailProduct" WHERE "canonicalProductId"=$1', [item.productId]);
      await db.query('DELETE FROM "Product" WHERE id=$1', [item.productId]);
      await db.query('DELETE FROM "RetailStore" WHERE id=$1', [item.storeId]);
    }
    await db.onModuleDestroy();
  }, 60_000);

  async function write(input: {
    retailer: string; city: string; region: string; address: string; externalSku: string;
    title: string; price: number; currency: string; scope: 'STORE' | 'DELIVERY_ADDRESS';
    externalStoreId?: string; capturedAt: string; sourceUrl: string; evidenceSha256: string;
    acquiredAt?: string | null; acquisitionTimeQuality?: 'MEASURED' | 'NORMALIZED_ONLY';
  }) {
    const ensured = await repo.ensureRetailerByCode({ code: input.retailer, name: input.retailer, region: 'RU' });
    const storeId = await repo.ensureStore(ensured.retailerId, input.retailer, {
      scope: input.scope, regionCode: input.region, city: input.city, address: input.address,
      externalStoreId: input.externalStoreId,
    });
    const product = await repo.ensureNormalizedProduct({ productKey: `${input.retailer}:${input.externalSku}:${input.city}:${suffix}`, name: input.title, category: 'evidence', unit: 'item', externalId: input.externalSku });
    const result = await repo.insertObservation({
      productId: product.id, storeId, retailerId: ensured.retailerId, externalSku: input.externalSku,
      productTitle: input.title, price: input.price, currency: input.currency, sourceType: 'PARSER',
      sourceName: `${input.retailer} evidence`, collectedAt: input.capturedAt, legacySource: 'fixture',
      dataClass: 'FIXTURE', sourceUrl: input.sourceUrl, evidenceSha256: input.evidenceSha256,
      acquiredAt: input.acquiredAt ?? undefined, acquisitionTimeQuality: input.acquisitionTimeQuality ?? 'NORMALIZED_ONLY',
    });
    created.push({ retailerId: ensured.retailerId, storeId, productId: product.id });
    return { ...result, productId: product.id, storeId, retailerId: ensured.retailerId };
  }

  it('persists address and store scopes without promotion and keeps provenance', async () => {
    const moscow = await write({ retailer: 'PYATEROCHKA', city: 'Москва', region: 'MOW', address: 'Первомайская улица, 17', externalSku: '3645971', title: 'Смесь', price: 1299, currency: 'RUB', scope: 'DELIVERY_ADDRESS', capturedAt: '2026-08-15T03:29:31.693Z', sourceUrl: 'https://5ka.ru/product/3645971', evidenceSha256: 'sha-moscow' });
    const kovrov = await write({ retailer: 'PYATEROCHKA', city: 'Ковров', region: 'VLA', address: 'улица Шмидта, 14', externalSku: '3645971', title: 'Смесь', price: 1299, currency: 'RUB', scope: 'DELIVERY_ADDRESS', capturedAt: '2026-08-15T03:29:31.693Z', sourceUrl: 'https://5ka.ru/product/3645971', evidenceSha256: 'sha-kovrov' });
    const moscowRead = await repo.readReferencePrice(moscow.productId, { storeId: moscow.storeId, locationScope: 'DELIVERY_ADDRESS' });
    const kovrovRead = await repo.readReferencePrice(kovrov.productId, { storeId: kovrov.storeId, locationScope: 'DELIVERY_ADDRESS' });
    expect(moscowRead.status).toBe('UNKNOWN');
    expect(kovrovRead.status).toBe('UNKNOWN');
    const scope = await db.query<{ locationScope: string }>('SELECT "locationScope" FROM "RetailStore" WHERE id=$1', [moscow.storeId]);
    expect(scope.rows[0]?.locationScope).toBe('DELIVERY_ADDRESS');
  });

  it('rejects invalid currency and preserves current production reader semantics', async () => {
    const ensured = await repo.ensureRetailerByCode({ code: 'MAGNIT', name: 'Magnit', region: 'RU' });
    const storeId = await repo.ensureStore(ensured.retailerId, 'Magnit', { scope: 'STORE', regionCode: 'MOW', city: 'Москва', address: 'Ясный', externalStoreId: `389698-${suffix}` });
    const product = await repo.ensureNormalizedProduct({ productKey: `magnit:9072651501:${suffix}`, name: 'Бананы', category: 'evidence', unit: 'item' });
    created.push({ retailerId: ensured.retailerId, storeId, productId: product.id });
    await expect(repo.insertObservation({ productId: product.id, storeId, retailerId: ensured.retailerId, externalSku: `9072651501-${suffix}`, productTitle: 'Бананы', price: 149, currency: 'EUR', sourceType: 'PARSER', sourceName: 'Magnit evidence', collectedAt: new Date().toISOString(), legacySource: 'fixture', dataClass: 'FIXTURE' })).rejects.toThrow('PRICE_CURRENCY_UNSUPPORTED');
    await repo.insertObservation({ productId: product.id, storeId, retailerId: ensured.retailerId, externalSku: `9072651501-${suffix}`, productTitle: 'Бананы', price: 149, currency: 'RUB', sourceType: 'API', sourceName: 'Magnit accepted test', collectedAt: new Date().toISOString(), legacySource: 'api', dataClass: 'PRODUCTION', sourceUrl: 'https://magnit.ru/product/9072651501', evidenceSha256: 'sha-prod', acquisitionTimeQuality: 'MEASURED' });
    const current = await repo.readReferencePrice(product.id, { storeId, locationScope: 'STORE', now: new Date() });
    expect(current.status).toBe('CURRENT');
    expect(current.locationScope).toBe('STORE');
    expect(current.sourceUrl).toBe('https://magnit.ru/product/9072651501');
  });
});
