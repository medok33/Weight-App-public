import { describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { PriceIntelligenceRepository } from '../../src/modules/price-intelligence/infrastructure/price-intelligence.repository';

describe('PRICE-01A dependable reference price persistence', () => {
  it('proves current/stale/conditional/unknown and store isolation', async () => {
    const db = new PrismaService();
    await db.onModuleInit();
    const repo = new PriceIntelligenceRepository(db);
    const suffix = `price_ref_${Date.now()}`;
    const region = await db.query<{ id: string }>(`INSERT INTO "Region" (code) VALUES ($1) RETURNING id`, [`RU_${suffix}`]);
    const retailer = await db.query<{ id: string }>(`INSERT INTO "Retailer" ("key", code, name, type, region, active) VALUES ($1,$2,$3,'CHAIN','RU',true) RETURNING id`, [`retailer_${suffix}`, `R_${suffix}`, 'Test Retailer']);
    const stores = await Promise.all(['A', 'B'].map((name) => db.query<{ id: string }>(`INSERT INTO "RetailStore" ("retailerId", "regionId", name, "locationScope") VALUES ($1,$2,$3,'STORE') RETURNING id`, [retailer.rows[0]!.id, region.rows[0]!.id, `Store ${name} ${suffix}`])));
    const product = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_${suffix}`, 'Reference product']);
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await repo.insertObservation({ productId: product.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `sku_a_${suffix}`, productTitle: 'A', packageValue: 500, packageUnit: 'g', price: 100, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv' });
    const current = await repo.readReferencePrice(product.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now });
    expect(current.status).toBe('CURRENT');
    expect(current.price).toBe(100);
    expect(current.observationId).toBeTruthy();

    const productB = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_b_${suffix}`, 'B']);
    await repo.insertObservation({ productId: productB.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `sku_b_${suffix}`, productTitle: 'B', packageValue: 1, packageUnit: 'piece', price: 50, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: old, legacySource: 'csv' });
    expect((await repo.readReferencePrice(productB.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now })).status).toBe('STALE');

    const productC = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_c_${suffix}`, 'C']);
    await repo.insertObservation({ productId: productC.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `sku_c_${suffix}`, productTitle: 'C', packageValue: 500, packageUnit: 'g', price: 80, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv', priceCondition: 'LOYALTY_ONLY' });
    const conditional = await repo.readReferencePrice(productC.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now });
    expect(conditional.status).toBe('APPROXIMATE');
    expect(conditional.priceCondition).toBe('LOYALTY_ONLY');

    const productUnknown = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_unknown_${suffix}`, 'Unknown']);
    const unknown = await repo.readReferencePrice(productUnknown.rows[0]!.id, { now });
    expect(unknown.status).toBe('UNKNOWN');

    const productD = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_d_${suffix}`, 'D']);
    await repo.insertObservation({ productId: productD.rows[0]!.id, storeId: stores[1]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `sku_d_${suffix}`, productTitle: 'D', packageValue: 500, packageUnit: 'g', price: 200, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv' });
    const storeA = await repo.readReferencePrice(productD.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now });
    const storeB = await repo.readReferencePrice(productD.rows[0]!.id, { storeId: stores[1]!.rows[0]!.id, now });
    expect(storeA.status).toBe('UNKNOWN');
    expect(storeB.price).toBe(200);
    expect(storeB.storeId).toBe(stores[1]!.rows[0]!.id);

    const productMapped = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_mapping_${suffix}`, 'Mapping']);
    const unmapped = await db.query<{ id: string }>(`INSERT INTO "RetailProduct" ("retailerId", "externalSku", title, "mappingStatus", source) VALUES ($1,$2,'Unmapped','UNMAPPED','IMPORT') RETURNING id`, [retailer.rows[0]!.id, `unmapped_${suffix}`]);
    await repo.insertObservation({ productId: productMapped.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, retailProductId: unmapped.rows[0]!.id, price: 70, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv' });
    expect((await repo.readReferencePrice(productMapped.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now })).status).toBe('UNKNOWN');
    const unmappedCount = await db.query<{ count: string }>(`SELECT count(*)::text FROM "PriceObservation" WHERE "retailProductId" = $1`, [unmapped.rows[0]!.id]);
    expect(Number(unmappedCount.rows[0]!.count)).toBe(1);
    await db.query(`UPDATE "RetailProduct" SET "canonicalProductId" = $2, "mappingStatus" = 'MAPPED', "lastMatchedAt" = now() WHERE id = $1`, [unmapped.rows[0]!.id, productMapped.rows[0]!.id]);
    await repo.materializeSnapshot(productMapped.rows[0]!.id, stores[0]!.rows[0]!.id);
    expect((await repo.readReferencePrice(productMapped.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now })).status).toBe('CURRENT');

    const productAmbiguous = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_ambiguous_${suffix}`, 'Ambiguous']);
    const ambiguous = await db.query<{ id: string }>(`INSERT INTO "RetailProduct" ("retailerId", "externalSku", title, "mappingStatus", source) VALUES ($1,$2,'Ambiguous','AMBIGUOUS','IMPORT') RETURNING id`, [retailer.rows[0]!.id, `ambiguous_${suffix}`]);
    await repo.insertObservation({ productId: productAmbiguous.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, retailProductId: ambiguous.rows[0]!.id, price: 60, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv' });
    expect((await repo.readReferencePrice(productAmbiguous.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now })).status).toBe('UNKNOWN');

    const productPromo = await db.query<{ id: string }>(`INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g") VALUES ($1,$1,$2,'g',0,0) RETURNING id`, [`product_promo_${suffix}`, 'Promo']);
    await repo.insertObservation({ productId: productPromo.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `promo_a_${suffix}`, productTitle: 'Promo', packageValue: 500, packageUnit: 'g', price: 40, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv', priceCondition: 'LOYALTY_ONLY' });
    await repo.insertObservation({ productId: productPromo.rows[0]!.id, storeId: stores[1]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `promo_b_${suffix}`, productTitle: 'Promo', packageValue: 500, packageUnit: 'g', price: 90, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv', priceCondition: 'REGULAR' });
    expect((await repo.readReferencePrice(productPromo.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now })).priceCondition).toBe('LOYALTY_ONLY');
    expect((await repo.readReferencePrice(productPromo.rows[0]!.id, { storeId: stores[0]!.rows[0]!.id, now })).status).toBe('APPROXIMATE');
    expect((await repo.readReferencePrice(productPromo.rows[0]!.id, { storeId: stores[1]!.rows[0]!.id, now })).price).toBe(90);

    const duplicate = await repo.insertObservation({ productId: product.rows[0]!.id, storeId: stores[0]!.rows[0]!.id, retailerId: retailer.rows[0]!.id, externalSku: `sku_a_${suffix}`, productTitle: 'A', packageValue: 500, packageUnit: 'g', price: 100, currency: 'RUB', sourceType: 'CSV', sourceName: 'CSV Import', collectedAt: now.toISOString(), legacySource: 'csv' });
    expect(duplicate.inserted).toBe(false);
    const count = await db.query<{ count: string }>(`SELECT count(*)::text FROM "PriceObservation" WHERE "productId" = $1`, [product.rows[0]!.id]);
    expect(Number(count.rows[0]!.count)).toBe(1);
    await db.onModuleDestroy();
  }, 60_000);
});
