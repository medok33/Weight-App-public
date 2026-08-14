import { describe, expect, it } from 'vitest';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { PriceIntelligenceEngine } from '../../src/modules/price-intelligence/application/price-intelligence.engine';
import type { RetailerPriceProvider } from '../../src/modules/price-intelligence/domain/retailer-price-provider';
import { PriceIntelligenceRepository } from '../../src/modules/price-intelligence/infrastructure/price-intelligence.repository';
import { ProductPriceResolver } from '../../src/modules/product-catalog/application/product-roles-retail.resolvers';

async function product(db: PrismaService, key: string) {
  const row = await db.query<{ id: string }>(
    `INSERT INTO "Product" ("canonicalName","productKey",name,unit,"caloriesPer100g","proteinPer100g")
     VALUES ($1,$1,$1,'g',0,0) RETURNING id`, [key],
  );
  return row.rows[0]!.id;
}

describe('PRICE-01A review-30 remediation persistence', () => {
  it('fails closed for identity, currency, future time, condition, fixture, and exact-store scope', async () => {
    const db = new PrismaService();
    await db.onModuleInit();
    try {
      const repo = new PriceIntelligenceRepository(db);
      const suffix = `p30a_${Date.now()}`;
      const retailer = await repo.ensureRetailerByCode({ code: `R${suffix}`, name: suffix, region: `RG${suffix}` });
      const storeA = await repo.ensureStore(retailer.retailerId, suffix, { scope: 'STORE', regionCode: `RG${suffix}`, externalStoreId: `A${suffix}` });
      const storeB = await repo.ensureStore(retailer.retailerId, suffix, { scope: 'STORE', regionCode: `RG${suffix}`, externalStoreId: `B${suffix}` });
      expect(storeA).not.toBe(storeB);

      const identityProduct = await product(db, `identity_${suffix}`);
      const at = new Date().toISOString();
      const base = { productId: identityProduct, storeId: storeA, retailerId: retailer.retailerId,
        externalSku: `sku_${suffix}`, productTitle: 'Identity', price: 100, currency: 'RUB',
        sourceType: 'CSV' as const, sourceName: 'provider', providerId: 'provider-a', collectedAt: at, legacySource: 'csv' };
      expect((await repo.insertObservation({ ...base, packageValue: 500, packageUnit: 'g' })).inserted).toBe(true);
      expect((await repo.insertObservation({ ...base, packageValue: 1, packageUnit: 'kg' })).inserted).toBe(true);
      expect((await repo.insertObservation({ ...base, packageValue: 0.5, packageUnit: 'kg' })).inserted).toBe(false);
      const count = await db.query<{ c: string }>(`SELECT count(*)::text c FROM "PriceObservation" WHERE "productId"=$1`, [identityProduct]);
      expect(Number(count.rows[0]!.c)).toBe(2);

      await expect(repo.insertObservation({ ...base, currency: 'USD', collectedAt: new Date(Date.now() + 1).toISOString() }))
        .rejects.toThrow('PRICE_CURRENCY_UNSUPPORTED');
      await expect(repo.insertObservation({ ...base, currency: '', collectedAt: new Date(Date.now() + 2).toISOString() }))
        .rejects.toThrow('PRICE_CURRENCY_UNSUPPORTED');

      const futureProduct = await product(db, `future_${suffix}`);
      await repo.insertObservation({ ...base, productId: futureProduct, externalSku: `future_${suffix}`,
        collectedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
      expect((await repo.readReferencePrice(futureProduct, { storeId: storeA })).status).toBe('UNKNOWN');

      const conditionalProduct = await product(db, `conditional_${suffix}`);
      await repo.insertObservation({ ...base, productId: conditionalProduct, externalSku: `conditional_${suffix}`,
        collectedAt: new Date().toISOString(), priceCondition: 'LOYALTY_ONLY' });
      const conditional = await repo.readReferencePrice(conditionalProduct, { storeId: storeA });
      expect(conditional.status).toBe('APPROXIMATE');
      const budgetQuote = await new ProductPriceResolver(db).resolveForProduct(conditionalProduct, { storeId: storeA });
      expect(budgetQuote.status).toBe('APPROXIMATE');
      expect(budgetQuote.packagePriceRub).toBeNull();

      const fixtureProduct = await product(db, `fixture_${suffix}`);
      await repo.insertObservation({ ...base, productId: fixtureProduct, externalSku: `fixture_${suffix}`,
        collectedAt: new Date().toISOString(), dataClass: 'FIXTURE' });
      expect((await repo.readReferencePrice(fixtureProduct, { storeId: storeA })).status).toBe('UNKNOWN');
      expect((await repo.readReferencePrice(identityProduct, { storeId: storeB })).status).toBe('UNKNOWN');
    } finally {
      await db.onModuleDestroy();
    }
  }, 60_000);

  it('atomically rejects an older snapshot update that completes after a newer update', async () => {
    const db = new PrismaService();
    await db.onModuleInit();
    try {
      const repo = new PriceIntelligenceRepository(db);
      const suffix = `race_${Date.now()}`;
      const retailer = await repo.ensureRetailerByCode({ code: `R${suffix}`, name: suffix, region: `RG${suffix}` });
      const productId = await product(db, `product_${suffix}`);
      const oldAt = new Date(Date.now() - 60_000).toISOString();
      await repo.insertObservation({ productId, storeId: retailer.storeId, retailerId: retailer.retailerId,
        externalSku: `sku_${suffix}`, productTitle: 'Race', price: 10, currency: 'RUB', sourceType: 'CSV',
        sourceName: 'provider', collectedAt: oldAt, legacySource: 'csv' });

      let selected!: () => void;
      let release!: () => void;
      const selectedPromise = new Promise<void>((resolve) => { selected = resolve; });
      const releasePromise = new Promise<void>((resolve) => { release = resolve; });
      let intercepted = false;
      const query: SqlQuery = async <T extends import('pg').QueryResultRow>(text: string, values: unknown[] = []) => {
        const result = await db.query<T>(text, values);
        if (!intercepted && text.includes('FROM "PriceObservation" po JOIN "RetailStore"')) {
          intercepted = true; selected(); await releasePromise;
        }
        return result;
      };
      const olderFinishesLast = repo.materializeSnapshot(productId, retailer.storeId, query);
      await selectedPromise;
      const newAt = new Date().toISOString();
      await repo.insertObservation({ productId, storeId: retailer.storeId, retailerId: retailer.retailerId,
        externalSku: `sku_${suffix}`, productTitle: 'Race', price: 20, currency: 'RUB', sourceType: 'CSV',
        sourceName: 'provider', collectedAt: newAt, legacySource: 'csv' });
      release();
      await olderFinishesLast;
      const reference = await repo.readReferencePrice(productId, { storeId: retailer.storeId });
      expect(reference.price).toBe(20);
      expect(reference.observedAt).toBe(newAt);
    } finally {
      await db.onModuleDestroy();
    }
  }, 60_000);

  it('fences a late timed-out provider while a concurrent provider publishes successfully', async () => {
    const db = new PrismaService();
    await db.onModuleInit();
    const previous = process.env.PRICE_PROVIDER_TIMEOUT_MS;
    process.env.PRICE_PROVIDER_TIMEOUT_MS = '100';
    try {
      const repo = new PriceIntelligenceRepository(db);
      const engine = new PriceIntelligenceEngine(repo);
      const suffix = `provider_${Date.now()}`;
      let resolveLate!: (value: Awaited<ReturnType<RetailerPriceProvider['syncPrices']>>) => void;
      const latePrices = new Promise<Awaited<ReturnType<RetailerPriceProvider['syncPrices']>>>((resolve) => { resolveLate = resolve; });
      const provider = (id: string, delayed: boolean): RetailerPriceProvider => ({
        providerId: id, sourceType: 'CSV', sourceName: id, retailerCode: id.toUpperCase(),
        syncCategories: async () => [],
        syncProducts: async () => [{ productKey: `${id}_${suffix}`, name: id, category: 'other', unit: 'g' }],
        syncPrices: async () => delayed ? latePrices : [{ productKey: `${id}_${suffix}`, externalId: `${id}_${suffix}`,
          price: 42, currency: 'RUB', collectedAt: new Date().toISOString(), weight: '500', unit: 'g' }],
        syncAvailability: async () => [],
      });
      const results = await engine.syncProviders([provider(`late${suffix}`, true), provider(`good${suffix}`, false)]);
      expect(results.map((item) => item.status)).toEqual(['TIMEOUT', 'SUCCESS']);
      resolveLate([{ productKey: `late${suffix}_${suffix}`, price: 1, currency: 'RUB', collectedAt: new Date().toISOString() }]);
      await latePrices;
      await Promise.resolve();
      const retailers = await db.query<{ code: string }>(`SELECT code FROM "Retailer" WHERE code = ANY($1::text[])`,
        [[`LATE${suffix}`.toUpperCase(), `GOOD${suffix}`.toUpperCase()]]);
      expect(retailers.rows.map((row) => row.code)).toEqual([`GOOD${suffix}`.toUpperCase()]);
      const goodProduct = await db.query<{ id: string }>(`SELECT id FROM "Product" WHERE "productKey"=$1`, [`good${suffix}_${suffix}`]);
      expect((await repo.readReferencePrice(goodProduct.rows[0]!.id)).status).toBe('CURRENT');
    } finally {
      if (previous === undefined) delete process.env.PRICE_PROVIDER_TIMEOUT_MS; else process.env.PRICE_PROVIDER_TIMEOUT_MS = previous;
      await db.onModuleDestroy();
    }
  }, 60_000);
});
