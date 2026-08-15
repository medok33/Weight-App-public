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
  const created: { retailerId: string; storeId: string; productId: string; externalSku: string; observationId: string; retailProductId: string }[] = [];

  beforeAll(async () => {
    expect(existsSync(fixturePath)).toBe(true);
    expect(JSON.parse(readFileSync(fixturePath, 'utf8')).fixtureAsLive).toBe(false);
    await db.onModuleInit();
  });

  afterAll(async () => {
    for (const item of created) {
      // PriceObservation references RetailProduct through retailProductId, not productId.
      // Delete only the exact observations created by this test.
      await db.query('DELETE FROM "PriceSnapshot" WHERE "productId"=$1 AND "storeId"=$2', [item.productId, item.storeId]);
      await db.query('DELETE FROM "PriceObservation" WHERE id=$1 AND "productId"=$2 AND "retailProductId"=$3', [item.observationId, item.productId, item.retailProductId]);
    }
    for (const item of [...new Map(created.map((entry) => [entry.retailProductId, entry])).values()]) {
      await db.query(`DELETE FROM "RetailProduct"
        WHERE id=$1 AND "retailerId"=$2 AND "externalSku"=$3
          AND "canonicalProductId" = ANY($4::uuid[])
          AND NOT EXISTS (SELECT 1 FROM "PriceObservation" WHERE "retailProductId"=$1)`,
      [item.retailProductId, item.retailerId, item.externalSku, [...new Set(created.map((entry) => entry.productId))]]);
    }
    for (const item of created) {
      await db.query('DELETE FROM "Product" WHERE id=$1', [item.productId]);
      await db.query('DELETE FROM "RetailStore" WHERE id=$1', [item.storeId]);
    }
    await db.onModuleDestroy();
  }, 60_000);

  async function write(input: {
    retailer: string; city: string; region: string; address: string; externalSku: string;
    title: string; price: number; currency: string; scope: 'STORE' | 'DELIVERY_ADDRESS' | 'CITY';
    externalStoreId?: string; capturedAt: string; sourceUrl: string; evidenceSha256: string;
    acquiredAt?: string | null; acquisitionTimeQuality?: 'MEASURED' | 'NORMALIZED_ONLY';
    sourceType?: 'PARSER' | 'API' | 'CSV' | 'MANUAL'; dataClass?: 'PRODUCTION' | 'FIXTURE';
    priceCondition?: 'REGULAR' | 'PROMOTIONAL'; regularPrice?: number; validFrom?: string; validTo?: string;
    productId?: string;
  }) {
    const ensured = await repo.ensureRetailerByCode({ code: input.retailer, name: input.retailer, region: 'RU' });
    const storeId = await repo.ensureStore(ensured.retailerId, input.retailer, {
      scope: input.scope, regionCode: input.region, city: input.city, address: input.address,
      externalStoreId: input.externalStoreId,
    });
    const product = input.productId
      ? { id: input.productId }
      : await repo.ensureNormalizedProduct({ productKey: `${input.retailer}:${input.externalSku}:${input.city}:${suffix}`, name: input.title, category: 'evidence', unit: 'item', externalId: input.externalSku });
    const result = await repo.insertObservation({
      productId: product.id, storeId, retailerId: ensured.retailerId, externalSku: input.externalSku,
      productTitle: input.title, price: input.price, currency: input.currency, sourceType: input.sourceType ?? 'PARSER',
      sourceName: `${input.retailer} evidence`, collectedAt: input.capturedAt, legacySource: 'fixture',
      dataClass: input.dataClass ?? 'FIXTURE', priceCondition: input.priceCondition, regularPrice: input.regularPrice,
      validFrom: input.validFrom, validTo: input.validTo, sourceUrl: input.sourceUrl, evidenceSha256: input.evidenceSha256,
      acquiredAt: input.acquiredAt ?? undefined, acquisitionTimeQuality: input.acquisitionTimeQuality ?? 'NORMALIZED_ONLY',
    });
    const retailProduct = await db.query<{ id: string }>('SELECT id FROM "RetailProduct" WHERE "retailerId"=$1 AND "externalSku"=$2', [ensured.retailerId, input.externalSku]);
    expect(result.observationId).toBeTruthy();
    expect(retailProduct.rows[0]?.id).toBeTruthy();
    created.push({ retailerId: ensured.retailerId, storeId, productId: product.id, externalSku: input.externalSku, observationId: result.observationId!, retailProductId: retailProduct.rows[0]!.id });
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
    const externalSku = `9072651501-${suffix}`;
    await expect(repo.insertObservation({ productId: product.id, storeId, retailerId: ensured.retailerId, externalSku: `9072651501-${suffix}`, productTitle: 'Бананы', price: 149, currency: 'EUR', sourceType: 'PARSER', sourceName: 'Magnit evidence', collectedAt: new Date().toISOString(), legacySource: 'fixture', dataClass: 'FIXTURE' })).rejects.toThrow('PRICE_CURRENCY_UNSUPPORTED');
    const accepted = await repo.insertObservation({ productId: product.id, storeId, retailerId: ensured.retailerId, externalSku, productTitle: 'Бананы', price: 149, currency: 'RUB', sourceType: 'API', sourceName: 'Magnit accepted test', collectedAt: new Date().toISOString(), legacySource: 'api', dataClass: 'PRODUCTION', sourceUrl: 'https://magnit.ru/product/9072651501', evidenceSha256: 'sha-prod', acquisitionTimeQuality: 'MEASURED' });
    const retailProduct = await db.query<{ id: string }>('SELECT id FROM "RetailProduct" WHERE "retailerId"=$1 AND "externalSku"=$2', [ensured.retailerId, externalSku]);
    expect(accepted.observationId).toBeTruthy();
    expect(retailProduct.rows[0]?.id).toBeTruthy();
    created.push({ retailerId: ensured.retailerId, storeId, productId: product.id, externalSku, observationId: accepted.observationId!, retailProductId: retailProduct.rows[0]!.id });
    const current = await repo.readReferencePrice(product.id, { storeId, locationScope: 'STORE', now: new Date() });
    expect(current.status).toBe('CURRENT');
    expect(current.locationScope).toBe('STORE');
    expect(current.sourceUrl).toBe('https://magnit.ru/product/9072651501');
  });

  it('covers accepted retailer locations, scope isolation, provenance, and replay idempotency', async () => {
    const capturedAt = '2026-08-15T02:05:55.000Z';
    const pyProduct = await repo.ensureNormalizedProduct({ productKey: `pyaterochka:3645971:${suffix}`, name: 'Смесь', category: 'evidence', unit: 'item', externalId: '3645971' });
    const pyMoscow = await write({ productId: pyProduct.id, retailer: 'PYATEROCHKA', city: 'Москва', region: 'MOW', address: 'Первомайская улица, 17', externalSku: '3645971', title: 'Смесь', price: 1299, currency: 'RUB', scope: 'DELIVERY_ADDRESS', capturedAt, sourceUrl: 'https://5ka.ru/product/3645971', evidenceSha256: 'sha-py-moscow', acquiredAt: capturedAt, acquisitionTimeQuality: 'NORMALIZED_ONLY', sourceType: 'API', dataClass: 'PRODUCTION' });
    const pyKovrov = await write({ productId: pyProduct.id, retailer: 'PYATEROCHKA', city: 'Ковров', region: 'VLA', address: 'улица Шмидта, 14', externalSku: '3645971', title: 'Смесь', price: 1299, currency: 'RUB', scope: 'DELIVERY_ADDRESS', capturedAt, sourceUrl: 'https://5ka.ru/product/3645971', evidenceSha256: 'sha-py-kovrov', acquiredAt: capturedAt, acquisitionTimeQuality: 'NORMALIZED_ONLY', sourceType: 'API', dataClass: 'PRODUCTION' });
    expect(pyMoscow.storeId).not.toBe(pyKovrov.storeId);
    expect((await repo.readReferencePrice(pyProduct.id, { storeId: pyMoscow.storeId, locationScope: 'DELIVERY_ADDRESS' })).storeId).toBe(pyMoscow.storeId);
    expect((await repo.readReferencePrice(pyProduct.id, { storeId: pyKovrov.storeId, locationScope: 'DELIVERY_ADDRESS' })).storeId).toBe(pyKovrov.storeId);
    expect((await repo.readReferencePrice(pyProduct.id, { storeId: pyMoscow.storeId, locationScope: 'STORE' }).then((value) => value.status))).toBe('UNKNOWN');

    const cityProduct = await repo.ensureNormalizedProduct({ productKey: `city-promo:3645971:${suffix}`, name: 'Городской каталог', category: 'evidence', unit: 'item', externalId: 'city-3645971' });
    const cityPromo = await write({ productId: cityProduct.id, retailer: 'PYATEROCHKA', city: 'Москва', region: 'MOW', address: 'Москва', externalSku: 'city-3645971', title: 'Городской каталог', price: 99, currency: 'RUB', scope: 'CITY', capturedAt, sourceUrl: 'https://proshoper.ru/moskva/actions/pyaterochka/329728/', evidenceSha256: 'sha-city-promo', acquiredAt: capturedAt, acquisitionTimeQuality: 'MEASURED', sourceType: 'CSV', dataClass: 'PRODUCTION', validFrom: '2026-08-11', validTo: '2026-08-17' });
    expect((await repo.readReferencePrice(cityProduct.id, { storeId: cityPromo.storeId, locationScope: 'CITY' })).price).toBe(99);
    expect((await repo.readReferencePrice(cityProduct.id, { storeId: cityPromo.storeId, locationScope: 'STORE' })).status).toBe('UNKNOWN');

    const magnitProduct = await repo.ensureNormalizedProduct({ productKey: `magnit:9072651501:${suffix}`, name: 'Бананы', category: 'evidence', unit: 'item', externalId: '9072651501' });
    const magnitMoscow = await write({ productId: magnitProduct.id, retailer: 'MAGNIT', city: 'Москва', region: 'MOW', address: 'проезд Ясный, д 26 к 1', externalSku: '9072651501', title: 'Бананы', price: 149, currency: 'RUB', scope: 'STORE', externalStoreId: '389698', capturedAt, sourceUrl: 'https://magnit.ru/product/9072651501?shopCode=389698', evidenceSha256: 'sha-mag-moscow', acquiredAt: capturedAt, acquisitionTimeQuality: 'MEASURED', sourceType: 'API', dataClass: 'PRODUCTION' });
    const magnitKovrov = await write({ productId: magnitProduct.id, retailer: 'MAGNIT', city: 'Ковров', region: 'VLA', address: 'пр-кт Ленина, д 29', externalSku: '9072651501', title: 'Бананы', price: 149.99, currency: 'RUB', scope: 'STORE', externalStoreId: '812923', capturedAt, sourceUrl: 'https://magnit.ru/product/9072651501?shopCode=812923', evidenceSha256: 'sha-mag-kovrov', acquiredAt: capturedAt, acquisitionTimeQuality: 'MEASURED', sourceType: 'API', dataClass: 'PRODUCTION' });
    expect(magnitMoscow.storeId).not.toBe(magnitKovrov.storeId);
    expect((await repo.readReferencePrice(magnitProduct.id, { storeId: magnitMoscow.storeId, locationScope: 'STORE' })).price).toBe(149);
    expect((await repo.readReferencePrice(magnitProduct.id, { storeId: magnitKovrov.storeId, locationScope: 'STORE' })).price).toBe(149.99);
    expect((await repo.readReferencePrice(magnitProduct.id, { storeId: magnitMoscow.storeId, locationScope: 'STORE' })).sourceUrl).toContain('389698');
    expect((await repo.readReferencePrice(magnitProduct.id, { storeId: magnitKovrov.storeId, locationScope: 'STORE' })).sourceUrl).toContain('812923');

    const yarcheProduct = await repo.ensureNormalizedProduct({ productKey: `yarche:17383:${suffix}`, name: 'Нектарин плоский', category: 'evidence', unit: 'item', externalId: '17383' });
    const yarcheMoscow = await write({ productId: yarcheProduct.id, retailer: 'YARCHE', city: 'Москва', region: 'MOW', address: 'ул. Первомайская, 17', externalSku: '17383', title: 'Нектарин плоский', price: 279.99, currency: 'RUB', scope: 'DELIVERY_ADDRESS', capturedAt, sourceUrl: 'https://yarcheplus.ru/product/nektarin-17383', evidenceSha256: 'sha-yarche-moscow', acquiredAt: capturedAt, acquisitionTimeQuality: 'MEASURED', sourceType: 'API', dataClass: 'PRODUCTION' });
    const yarcheKovrov = await write({ productId: yarcheProduct.id, retailer: 'YARCHE', city: 'Ковров', region: 'VLA', address: 'ул. Шмидта, 14с1', externalSku: '17383', title: 'Нектарин плоский', price: 279.99, currency: 'RUB', scope: 'DELIVERY_ADDRESS', capturedAt, sourceUrl: 'https://yarcheplus.ru/product/nektarin-17383', evidenceSha256: 'sha-yarche-kovrov', acquiredAt: capturedAt, acquisitionTimeQuality: 'MEASURED', sourceType: 'API', dataClass: 'PRODUCTION' });
    expect(yarcheMoscow.storeId).not.toBe(yarcheKovrov.storeId);
    const yarcheAddress = await db.query<{ address: string }>('SELECT address FROM "RetailStore" WHERE id=$1', [yarcheKovrov.storeId]);
    expect(yarcheAddress.rows[0]?.address).toBe('ул. Шмидта, 14с1');
    expect((await repo.readReferencePrice(yarcheProduct.id, { storeId: yarcheMoscow.storeId, locationScope: 'DELIVERY_ADDRESS' })).storeId).toBe(yarcheMoscow.storeId);
    expect((await repo.readReferencePrice(yarcheProduct.id, { storeId: yarcheKovrov.storeId, locationScope: 'DELIVERY_ADDRESS' })).storeId).toBe(yarcheKovrov.storeId);

    const replay = await write({ productId: magnitProduct.id, retailer: 'MAGNIT', city: 'Москва', region: 'MOW', address: 'проезд Ясный, д 26 к 1', externalSku: '9072651501', title: 'Бананы', price: 149, currency: 'RUB', scope: 'STORE', externalStoreId: '389698', capturedAt, sourceUrl: 'https://magnit.ru/product/9072651501?shopCode=389698', evidenceSha256: 'sha-mag-moscow', acquiredAt: capturedAt, acquisitionTimeQuality: 'MEASURED', sourceType: 'API', dataClass: 'PRODUCTION' });
    expect(replay.inserted).toBe(false);
  });
});
