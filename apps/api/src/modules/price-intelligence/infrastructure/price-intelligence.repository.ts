import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { classifyPriceObservationHeuristics } from '../../product-catalog/domain/price-data-class.policy';
import type { PriceImportRow, PriceSourceType } from '../domain/price-intelligence.types';
import type { PriceProvider } from '../domain/price-provider';
import type { RetailerRef } from '../domain/retailer.types';
import type { RetailerEntity } from '../domain/retailer-entity';
import { normalizeRetailerCode } from '../domain/retailer-entity';
import {
  DEFAULT_FRESHNESS_WINDOW_MS,
  deriveUnitPrice,
  freshnessStatus,
  normalizePackage,
  observationIdentity,
  type PriceCondition,
  type ReferencePriceEvidence,
} from '../domain/reference-price.core';
import type {
  CreateProductInput,
  ObservationAdminView,
  ObservationFilters,
  ProductAdminView,
  RetailerAdminView,
  UpdateProductInput,
  UpdateRetailerInput,
} from '../domain/price-admin.types';
import type { RetailerPriceProvider, RetailerSyncResult, SyncProduct } from '../domain/retailer-price-provider';

export type LatestPriceQuote = {
  productId: string;
  price: number;
  currency: string;
  sourceType: PriceSourceType;
  sourceName: string;
  collectedAt: string;
  retailerId?: string;
  retailerName?: string;
  retailerCode?: string;
  status?: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'APPROXIMATE';
  normalizedUnitPrice?: number;
  normalizedUnit?: string;
  priceCondition?: PriceCondition;
  observationId?: string;
  retailProductId?: string;
};

@Injectable()
export class PriceIntelligenceRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async session(tokenHash: string) {
    const result = await this.db.query<{ userId: string; role: string; mfaVerifiedAt: Date | null }>(
      'SELECT "userId", role, "mfaVerifiedAt" FROM "Session" WHERE "tokenHash"=$1 AND "revokedAt" IS NULL AND "expiresAt">now()',
      [tokenHash],
    );
    return result.rows[0];
  }

  /** Authoritative MFA path: active OwnerMfaCredential (legacy OwnerMfaChallenge is not trusted). */
  async mfa(userId: string) {
    const result = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "OwnerMfaCredential"
         WHERE "userId"=$1 AND status='ACTIVE' AND "disabledAt" IS NULL
       ) ok`,
      [userId],
    );
    return result.rows[0]?.ok === true;
  }

  async review() {
    const result = await this.db.query<{
      id: string;
      productId: string;
      storeId: string;
      price: string;
      observedAt: string;
      source: string;
      currency: string;
      sourceType: string;
      sourceName: string;
      collectedAt: string;
      retailerId: string | null;
    }>(
      `SELECT id, "productId", "storeId", price::text AS price, "observedAt"::text AS "observedAt", source,
              currency, "sourceType", "sourceName", COALESCE("collectedAt", "observedAt")::text AS "collectedAt", "retailerId"
       FROM "PriceObservation"
       WHERE price <= 0 OR "sourceName" = 'unknown' OR "sourceType" = 'PARSER'
       ORDER BY COALESCE("collectedAt", "observedAt") DESC
       LIMIT 100`,
    );
    return result.rows.map((row) => ({
      ...row,
      price: Number(row.price),
      sourceType: row.sourceType as PriceSourceType,
      retailerId: row.retailerId ?? undefined,
    }));
  }

  async importRows(userId: string, rows: PriceImportRow[]) {
    for (const row of rows) {
      await this.insertObservation({
        productId: row.productId,
        storeId: row.storeId,
        retailerId: row.retailerId,
        price: row.price,
        currency: row.currency ?? 'RUB',
        sourceType: row.sourceType ?? 'CSV',
        sourceName: row.sourceName ?? row.source ?? 'Legacy CSV import',
        collectedAt: row.collectedAt ?? row.observedAt,
        legacySource: row.source ?? row.sourceType ?? 'csv',
      });
    }
    await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)', [
      userId,
      'price.import.completed',
      JSON.stringify({ count: rows.length }),
    ]);
    return { imported: rows.length };
  }

  async ensureRetailer(ref: RetailerRef): Promise<{ retailerId: string; storeId: string }> {
    const code = normalizeRetailerCode(ref.key);
    return this.ensureRetailerByCode({
      code,
      name: ref.name,
      region: 'RU',
      active: true,
    });
  }

  async ensureRetailerByCode(input: {
    code: string;
    name: string;
    region?: string;
    active?: boolean;
  }): Promise<{ retailerId: string; storeId: string; retailer: RetailerEntity }> {
    const code = normalizeRetailerCode(input.code);
    const key = code.toLowerCase();
    const regionCode = input.region ?? 'RU';

    let retailerId: string | undefined;
    const existingRetailer = await this.db.query<{ id: string; name: string; region: string; active: boolean }>(
      `SELECT id, name, COALESCE(region, 'RU') AS region, COALESCE(active, true) AS active
       FROM "Retailer"
       WHERE code = $1 OR "key" = $2
       LIMIT 1`,
      [code, key],
    );
    if (existingRetailer.rows[0]) {
      retailerId = existingRetailer.rows[0].id;
      await this.db.query(
        `UPDATE "Retailer" SET name = $2, code = $3, region = $4, active = $5, "key" = COALESCE("key", $6) WHERE id = $1`,
        [retailerId, input.name, code, regionCode, input.active ?? true, key],
      );
    } else {
      const created = await this.db.query<{ id: string }>(
        `INSERT INTO "Retailer" (name, "key", type, code, region, active)
         VALUES ($1, $2, 'CHAIN', $3, $4, $5)
         ON CONFLICT ("key") DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, region = EXCLUDED.region, active = EXCLUDED.active
         RETURNING id`,
        [input.name, key, code, regionCode, input.active ?? true],
      );
      retailerId = created.rows[0]?.id;
    }
    if (!retailerId) throw new Error('RETAILER_UPSERT_FAILED');

    const region = await this.db.query<{ id: string }>(
      `INSERT INTO "Region" (code) VALUES ($1)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [regionCode],
    );
    const regionId = region.rows[0]?.id;
    if (!regionId) throw new Error('RETAILER_UPSERT_FAILED');

    const existingStore = await this.db.query<{ id: string }>(
      `SELECT id FROM "RetailStore" WHERE "retailerId" = $1 ORDER BY name LIMIT 1`,
      [retailerId],
    );
    let storeId = existingStore.rows[0]?.id;
    if (!storeId) {
      const store = await this.db.query<{ id: string }>(
        'INSERT INTO "RetailStore" ("retailerId", "regionId", name) VALUES ($1, $2, $3) RETURNING id',
        [retailerId, regionId, `${input.name} default`],
      );
      storeId = store.rows[0]?.id;
    }
    if (!storeId) throw new Error('RETAILER_UPSERT_FAILED');

    return {
      retailerId,
      storeId,
      retailer: {
        id: retailerId,
        name: input.name,
        code,
        region: regionCode,
        active: input.active ?? true,
      },
    };
  }

  async productExists(productKey: string): Promise<boolean> {
    const result = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "Product" WHERE "productKey" = $1 OR "canonicalName" = $1) ok`,
      [productKey.trim()],
    );
    return result.rows[0]?.ok === true;
  }

  async ensureNormalizedProduct(product: SyncProduct): Promise<{ id: string; created: boolean }> {
    const productKey = product.productKey.trim();
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM "Product" WHERE "productKey" = $1 OR "canonicalName" = $1 LIMIT 1`,
      [productKey],
    );
    if (existing.rows[0]?.id) {
      await this.db.query(
        `UPDATE "Product"
         SET "productKey" = $2, name = $3, category = $4, unit = $5, weight = $6, "canonicalName" = $2
         WHERE id = $1`,
        [existing.rows[0].id, productKey, product.name, product.category, product.unit, product.weight ?? null],
      );
      return { id: existing.rows[0].id, created: false };
    }
    const created = await this.db.query<{ id: string }>(
      `INSERT INTO "Product"
        ("canonicalName", "productKey", name, category, unit, weight, "caloriesPer100g", "proteinPer100g")
       VALUES ($1, $1, $2, $3, $4, $5, 0, 0)
       ON CONFLICT ("canonicalName") DO UPDATE
         SET "productKey" = EXCLUDED."productKey",
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             unit = EXCLUDED.unit,
             weight = EXCLUDED.weight
       RETURNING id`,
      [productKey, product.name, product.category, product.unit, product.weight ?? null],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('PRODUCT_UPSERT_FAILED');
    return { id, created: true };
  }

  async ensureProductByKey(productKey: string, displayName: string, unit = 'g'): Promise<string> {
    const result = await this.ensureNormalizedProduct({
      productKey: productKey.trim() || displayName.trim(),
      name: displayName,
      category: 'other',
      unit,
    });
    return result.id;
  }

  async listRetailers(): Promise<RetailerAdminView[]> {
    const result = await this.db.query<{
      id: string;
      key: string;
      code: string;
      name: string;
      type: string;
      region: string;
      active: boolean;
    }>(
      `SELECT id, "key", code, name, type, COALESCE(region, 'RU') AS region, COALESCE(active, true) AS active
       FROM "Retailer"
       ORDER BY name`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      key: row.key,
      code: row.code,
      name: row.name,
      type: row.type,
      region: row.region,
      active: row.active,
    }));
  }

  async updateRetailer(id: string, input: UpdateRetailerInput): Promise<RetailerAdminView | null> {
    const existing = await this.db.query<{ id: string }>(`SELECT id FROM "Retailer" WHERE id = $1`, [id]);
    if (!existing.rows[0]) return null;
    await this.db.query(
      `UPDATE "Retailer"
       SET name = COALESCE($2, name),
           region = COALESCE($3, region),
           active = COALESCE($4, active)
       WHERE id = $1`,
      [id, input.name ?? null, input.region ?? null, input.active ?? null],
    );
    const retailers = await this.listRetailers();
    return retailers.find((r) => r.id === id) ?? null;
  }

  async listProducts(limit = 200): Promise<ProductAdminView[]> {
    const result = await this.db.query<{
      id: string;
      productKey: string | null;
      name: string | null;
      category: string | null;
      unit: string;
      weight: string | null;
      caloriesPer100g: string;
      proteinPer100g: string;
      createdAt: string;
      canonicalName: string;
    }>(
      `SELECT id, "productKey", name, category, unit, weight,
              "caloriesPer100g"::text, "proteinPer100g"::text, "createdAt"::text, "canonicalName"
       FROM "Product"
       ORDER BY COALESCE(name, "canonicalName")
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      productKey: row.productKey ?? row.canonicalName,
      name: row.name ?? row.canonicalName,
      category: row.category ?? 'other',
      unit: row.unit,
      weight: row.weight ?? undefined,
      caloriesPer100g: Number(row.caloriesPer100g),
      proteinPer100g: Number(row.proteinPer100g),
      createdAt: row.createdAt,
    }));
  }

  async createProduct(input: CreateProductInput): Promise<ProductAdminView> {
    const productKey = input.productKey.trim();
    const created = await this.db.query<{ id: string }>(
      `INSERT INTO "Product"
        ("canonicalName", "productKey", name, category, unit, weight, "caloriesPer100g", "proteinPer100g")
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        productKey,
        input.name,
        input.category,
        input.unit,
        input.weight ?? null,
        input.caloriesPer100g ?? 0,
        input.proteinPer100g ?? 0,
      ],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('PRODUCT_CREATE_FAILED');
    const products = await this.listProducts(1000);
    const product = products.find((p) => p.id === id);
    if (!product) throw new Error('PRODUCT_CREATE_FAILED');
    return product;
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<ProductAdminView | null> {
    const existing = await this.db.query<{ id: string; productKey: string | null; canonicalName: string }>(
      `SELECT id, "productKey", "canonicalName" FROM "Product" WHERE id = $1`,
      [id],
    );
    if (!existing.rows[0]) return null;
    const currentKey = existing.rows[0].productKey ?? existing.rows[0].canonicalName;
    await this.db.query(
      `UPDATE "Product"
       SET "productKey" = COALESCE($2, "productKey"),
           "canonicalName" = COALESCE($2, "canonicalName"),
           name = COALESCE($3, name),
           category = COALESCE($4, category),
           unit = COALESCE($5, unit),
           weight = COALESCE($6, weight),
           "caloriesPer100g" = COALESCE($7, "caloriesPer100g"),
           "proteinPer100g" = COALESCE($8, "proteinPer100g")
       WHERE id = $1`,
      [
        id,
        input.productKey ?? null,
        input.name ?? null,
        input.category ?? null,
        input.unit ?? null,
        input.weight ?? null,
        input.caloriesPer100g ?? null,
        input.proteinPer100g ?? null,
      ],
    );
    if (input.productKey && input.productKey !== currentKey) {
      await this.db.query(`UPDATE "Product" SET "canonicalName" = $2 WHERE id = $1`, [id, input.productKey]);
    }
    const products = await this.listProducts(1000);
    return products.find((p) => p.id === id) ?? null;
  }

  async listObservations(filters: ObservationFilters = {}): Promise<ObservationAdminView[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.productId) {
      clauses.push(`po."productId" = $${paramIndex++}`);
      params.push(filters.productId);
    }
    if (filters.retailerId) {
      clauses.push(`po."retailerId" = $${paramIndex++}`);
      params.push(filters.retailerId);
    }
    if (filters.sourceType) {
      clauses.push(`po."sourceType" = $${paramIndex++}`);
      params.push(filters.sourceType);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filters.limit ?? 200;
    params.push(limit);

    const result = await this.db.query<{
      id: string;
      productId: string;
      productKey: string | null;
      productName: string | null;
      retailerId: string | null;
      retailerName: string | null;
      retailerCode: string | null;
      price: string;
      currency: string;
      sourceType: string;
      sourceName: string;
      collectedAt: string;
      observedAt: string;
      canonicalName: string;
    }>(
      `SELECT po.id, po."productId", p."productKey", COALESCE(p.name, p."canonicalName") AS "productName",
              po."retailerId", r.name AS "retailerName", r.code AS "retailerCode",
              po.price::text, po.currency, po."sourceType", po."sourceName",
              COALESCE(po."collectedAt", po."observedAt")::text AS "collectedAt",
              po."observedAt"::text AS "observedAt", p."canonicalName"
       FROM "PriceObservation" po
       JOIN "Product" p ON p.id = po."productId"
       LEFT JOIN "Retailer" r ON r.id = po."retailerId"
       ${where}
       ORDER BY COALESCE(po."collectedAt", po."observedAt") DESC
       LIMIT $${paramIndex}`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productKey: row.productKey ?? row.canonicalName,
      productName: row.productName ?? row.canonicalName,
      retailerId: row.retailerId ?? undefined,
      retailerName: row.retailerName ?? undefined,
      retailerCode: row.retailerCode ?? undefined,
      price: Number(row.price),
      currency: row.currency,
      sourceType: row.sourceType as PriceSourceType,
      sourceName: row.sourceName,
      collectedAt: row.collectedAt,
      observedAt: row.observedAt,
    }));
  }

  async syncFromRetailerProvider(
    provider: RetailerPriceProvider,
    auditUserId?: string,
  ): Promise<RetailerSyncResult & { sourceType: string; sourceName: string; productsCreated: number; productsUpdated: number; pricesImported: number }> {
    const displayName =
      'retailerDisplayName' in provider && typeof (provider as { retailerDisplayName?: string }).retailerDisplayName === 'string'
        ? (provider as { retailerDisplayName: string }).retailerDisplayName
        : provider.retailerCode;
    const { retailerId, storeId } = await this.ensureRetailerByCode({
      code: provider.retailerCode,
      name: displayName,
      region: 'RU',
      active: true,
    });

    const [categories, products, prices, availability] = await Promise.all([
      provider.syncCategories(),
      provider.syncProducts(),
      provider.syncPrices(),
      provider.syncAvailability(),
    ]);

    let productsCreated = 0;
    let productsUpdated = 0;
    let pricesImported = 0;
    const syncedKeys = new Set<string>();

    const trackProduct = (upsert: { created: boolean }, productKey: string) => {
      if (syncedKeys.has(productKey)) return;
      syncedKeys.add(productKey);
      if (upsert.created) productsCreated += 1;
      else productsUpdated += 1;
    };

    for (const product of products) {
      const upsert = await this.ensureNormalizedProduct(product);
      trackProduct(upsert, product.productKey);
    }

    for (const price of prices) {
      const upsert = await this.ensureNormalizedProduct(
        products.find((p) => p.productKey === price.productKey) ?? {
          productKey: price.productKey,
          name: price.productKey,
          category: 'other',
          unit: 'g',
        },
      );
      trackProduct(upsert, price.productKey);
      await this.insertObservation({
        productId: upsert.id,
        storeId,
        retailerId,
        externalSku: price.externalId ?? price.productKey,
        productTitle: products.find((p) => p.productKey === price.productKey)?.name ?? price.productKey,
        packageValue: price.weight,
        packageUnit: price.unit,
        price: price.price,
        currency: price.currency,
        sourceType: provider.sourceType,
        sourceName: provider.sourceName,
        collectedAt: price.collectedAt,
        legacySource: provider.sourceType.toLowerCase(),
      });
      pricesImported += 1;
    }

    if (auditUserId) {
      await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)', [
        auditUserId,
        'price.provider.sync',
        JSON.stringify({
          providerId: provider.providerId,
          retailerCode: provider.retailerCode,
          categories: categories.length,
          products: products.length,
          prices: prices.length,
          availability: availability.length,
        }),
      ]);
    }

    return {
      categories: categories.length,
      products: products.length,
      prices: prices.length,
      availability: availability.length,
      sourceType: provider.sourceType,
      sourceName: provider.sourceName,
      productsCreated,
      productsUpdated,
      pricesImported,
    };
  }

  async insertObservation(input: {
    productId: string;
    storeId: string;
    retailerId?: string;
    retailProductId?: string;
    externalSku?: string;
    productTitle?: string;
    packageValue?: number | string;
    packageUnit?: string;
    price: number;
    currency: string;
    sourceType: PriceSourceType;
    sourceName: string;
    collectedAt: string;
    legacySource: string;
    dataClass?: 'PRODUCTION' | 'TEST_ONLY' | 'FIXTURE' | 'HISTORICAL_TEST';
    priceCondition?: PriceCondition;
    conditionDescription?: string;
    validFrom?: string;
    validTo?: string;
    loyaltyRequired?: boolean;
    quantityRequirement?: number;
  }) {
    if (!Number.isFinite(input.price) || input.price < 0) throw new Error('PRICE_INVALID');
    const condition = input.priceCondition ?? 'REGULAR';
    const pack = normalizePackage(input.packageValue, input.packageUnit);
    const unitPrice = deriveUnitPrice(input.price, pack);
    let retailProductId = input.retailProductId ?? null;
    if (!retailProductId && input.retailerId && input.externalSku) {
      const rp = await this.db.query<{ id: string }>(
        `INSERT INTO "RetailProduct" ("retailerId", "canonicalProductId", "externalSku", title, "packageWeight", "packageUnit", "packageQuantity", status, "mappingStatus", source, "lastMatchedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 'MAPPED', 'IMPORT', now())
         ON CONFLICT ("retailerId", "externalSku") WHERE "externalSku" IS NOT NULL AND status <> 'MERGED'
         DO UPDATE SET "canonicalProductId" = EXCLUDED."canonicalProductId", "mappingStatus" = 'MAPPED', "packageWeight" = COALESCE(EXCLUDED."packageWeight", "RetailProduct"."packageWeight"), "packageUnit" = COALESCE(EXCLUDED."packageUnit", "RetailProduct"."packageUnit"), "updatedAt" = now()
         RETURNING id`,
        [input.retailerId, input.productId, input.externalSku, input.productTitle ?? input.externalSku, pack?.quantity ?? null, pack?.unit ?? input.packageUnit ?? null, pack?.sourceQuantity ?? null],
      );
      retailProductId = rp.rows[0]?.id ?? null;
    }
    const observationKey = observationIdentity({
      productId: input.productId, storeId: input.storeId, retailerId: input.retailerId, retailProductId,
      sourceType: input.sourceType, sourceName: input.sourceName, price: input.price, currency: input.currency,
      observedAt: input.collectedAt, priceCondition: condition,
    });
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO "PriceObservation"
        ("productId", "storeId", "retailerId", "retailProductId", price, currency, "sourceType", "sourceName", "collectedAt", "observedAt", source, "dataClass", "observationKey", "observedPackageWeight", "observedPackageUnit", "normalizedPackageQuantity", "normalizedPackageUnit", "unitPrice", "unitPriceUnit", "priceCondition", "regularPrice", "conditionDescription", "validFrom", "validTo", "loyaltyRequired", "quantityRequirement")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$9::timestamptz,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::timestamptz,$23::timestamptz,$24,$25)
       ON CONFLICT ("observationKey") DO NOTHING RETURNING id`,
      [input.productId, input.storeId, input.retailerId ?? null, retailProductId, input.price, input.currency, input.sourceType, input.sourceName,
        input.collectedAt, input.legacySource, input.dataClass ?? classifyPriceObservationHeuristics({ source: input.legacySource, sourceName: input.sourceName }), observationKey,
        pack?.sourceQuantity ?? null, pack?.sourceUnit ?? null, pack?.quantity ?? null, pack?.unit ?? null, unitPrice?.value ?? null, unitPrice?.unit ?? null,
        condition, input.price, input.conditionDescription ?? null, input.validFrom ?? null, input.validTo ?? null, input.loyaltyRequired ?? null, input.quantityRequirement ?? null],
    );
    // STEP_210: price changes do not create RecipeRevalidationTask, but may affect cost-constrained coverage.
    await this.markCoverageCostRefreshDirty(input.productId);
    if (inserted.rows[0]?.id) await this.materializeSnapshot(input.productId, input.storeId);
    return { inserted: Boolean(inserted.rows[0]?.id), observationId: inserted.rows[0]?.id ?? null, observationKey };
  }

  async materializeSnapshot(productId: string, storeId: string) {
    const candidate = await this.db.query<any>(
      `SELECT po.id, rs."regionId", po."retailerId", po."storeId", po.price::text, COALESCE(po.confidence, 1)::text AS confidence,
              po."observedAt"::text, po."normalizedPackageQuantity"::text, po."normalizedPackageUnit",
              po."unitPrice"::text, po."unitPriceUnit", po."priceCondition", po."sourceType", po."sourceName", po."dataClass"
       FROM "PriceObservation" po JOIN "RetailStore" rs ON rs.id = po."storeId" JOIN "Retailer" r ON r.id = po."retailerId"
       LEFT JOIN "RetailProduct" rp ON rp.id = po."retailProductId"
       WHERE po."productId" = $1 AND po."storeId" = $2 AND r.active = true
         AND rp.id IS NOT NULL AND rp.status = 'ACTIVE' AND rp."mappingStatus" = 'MAPPED' AND rp."canonicalProductId" = po."productId"
         AND po.price >= 0 AND po."priceCondition" IN ('REGULAR','PROMOTIONAL')
       ORDER BY CASE WHEN rs."locationScope" = 'STORE' THEN 3 WHEN rs."locationScope" = 'CITY' THEN 2 ELSE 1 END DESC,
                CASE WHEN po."sourceType" = 'API' THEN 4 WHEN po."sourceType" = 'CSV' THEN 3 WHEN po."sourceType" = 'MANUAL' THEN 2 ELSE 1 END DESC,
                po."observedAt" DESC, po.id ASC LIMIT 1`, [productId, storeId]);
    const row = candidate.rows[0];
    if (!row) return null;
    const freshUntil = new Date(new Date(row.observedAt).getTime() + DEFAULT_FRESHNESS_WINDOW_MS);
    await this.db.query(
      `INSERT INTO "PriceSnapshot" ("productId", "regionId", "retailerId", "storeId", "evidenceObservationId", price, confidence, "observedAt", status, "freshUntil", "normalizedPackageQuantity", "normalizedPackageUnit", "unitPrice", "unitPriceUnit", "priceCondition", "sourceType", "sourceName")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,'CURRENT',$9::timestamptz,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT ("productId", "regionId", "storeId") DO UPDATE SET "retailerId"=EXCLUDED."retailerId", "evidenceObservationId"=EXCLUDED."evidenceObservationId", price=EXCLUDED.price, confidence=EXCLUDED.confidence, "observedAt"=EXCLUDED."observedAt", status=EXCLUDED.status, "freshUntil"=EXCLUDED."freshUntil", "normalizedPackageQuantity"=EXCLUDED."normalizedPackageQuantity", "normalizedPackageUnit"=EXCLUDED."normalizedPackageUnit", "unitPrice"=EXCLUDED."unitPrice", "unitPriceUnit"=EXCLUDED."unitPriceUnit", "priceCondition"=EXCLUDED."priceCondition", "sourceType"=EXCLUDED."sourceType", "sourceName"=EXCLUDED."sourceName"`,
      [productId, row.regionId, row.retailerId, row.storeId, row.id, Number(row.price), Number(row.confidence ?? 1), row.observedAt, freshUntil.toISOString(), row.normalizedPackageQuantity ? Number(row.normalizedPackageQuantity) : null, row.normalizedPackageUnit, row.unitPrice ? Number(row.unitPrice) : null, row.unitPriceUnit, row.priceCondition, row.sourceType, row.sourceName]);
    return row.id;
  }

  async readReferencePrice(productId: string, options: { storeId?: string; regionId?: string; now?: Date } = {}): Promise<ReferencePriceEvidence> {
    const params: unknown[] = [productId];
    const clauses = ['ps."productId" = $1'];
    if (options.storeId) { params.push(options.storeId); clauses.push(`ps."storeId" = $${params.length}`); }
    if (options.regionId) { params.push(options.regionId); clauses.push(`ps."regionId" = $${params.length}`); }
    const result = await this.db.query<any>(`SELECT ps."productId", ps.price::text, 'RUB' AS currency, ps."observedAt"::text, ps."freshUntil"::text, ps.status, ps."normalizedPackageQuantity"::text, ps."normalizedPackageUnit", ps."unitPrice"::text, ps."unitPriceUnit", ps."priceCondition", ps."retailerId", ps."storeId", rs."locationScope", ps."sourceType", ps."sourceName", ps."evidenceObservationId", po."dataClass" FROM "PriceSnapshot" ps LEFT JOIN "RetailStore" rs ON rs.id = ps."storeId" LEFT JOIN "PriceObservation" po ON po.id = ps."evidenceObservationId" WHERE ${clauses.join(' AND ')} ORDER BY ps."observedAt" DESC, ps.id ASC LIMIT 1`, params);
    const row = result.rows[0];
    if (!row) {
      const conditional = await this.db.query<any>(
        `SELECT po."productId", po.price::text, 'RUB' AS currency, po."observedAt"::text, po."priceCondition", po."sourceType", po."sourceName", po.id AS "evidenceObservationId", po."dataClass", po."retailerId", po."storeId"
         FROM "PriceObservation" po JOIN "RetailStore" rs ON rs.id = po."storeId"
         WHERE po."productId" = $1 AND po."priceCondition" IN ('LOYALTY_ONLY','CONDITIONAL','UNKNOWN_CONDITION')
           AND ($2::uuid IS NULL OR po."storeId" = $2) AND ($3::uuid IS NULL OR rs."regionId" = $3)
         ORDER BY po."observedAt" DESC, po.id ASC LIMIT 1`, [productId, options.storeId ?? null, options.regionId ?? null]);
      const conditionalRow = conditional.rows[0];
      if (conditionalRow) return { status: 'APPROXIMATE', price: Number(conditionalRow.price), currency: conditionalRow.currency, normalizedUnitPrice: null, normalizedUnit: null, priceCondition: conditionalRow.priceCondition, observedAt: conditionalRow.observedAt, freshUntil: null, productId, retailerId: conditionalRow.retailerId, storeId: conditionalRow.storeId, sourceType: conditionalRow.sourceType, sourceName: conditionalRow.sourceName, observationId: conditionalRow.evidenceObservationId };
      return { status: 'UNKNOWN', price: null, currency: 'RUB', normalizedUnitPrice: null, normalizedUnit: null, priceCondition: 'UNKNOWN_CONDITION', observedAt: null, freshUntil: null, productId };
    }
    const status = freshnessStatus({ observedAt: row.observedAt, dataClass: row.dataClass, now: options.now, condition: row.priceCondition });
    return { status, price: Number(row.price), currency: row.currency, normalizedUnitPrice: row.unitPrice ? Number(row.unitPrice) : null, normalizedUnit: row.unitPriceUnit, priceCondition: row.priceCondition, observedAt: row.observedAt, freshUntil: row.freshUntil, productId: row.productId, retailerId: row.retailerId, storeId: row.storeId, locationScope: row.locationScope, sourceType: row.sourceType, sourceName: row.sourceName, observationId: row.evidenceObservationId };
  }

  /**
   * Mark coverage matrix dirty for cost refresh when cost-constrained slots exist.
   * Does not run analyzer inline; debounce/worker/scheduler apply later.
   */
  async markCoverageCostRefreshDirty(productId: string) {
    // Any new observation can affect portion cost for recipes using this product.
    // Mark all active cost-constrained slots on each matrix for controlled refresh.
    void productId;
    const costSlots = await this.db.query<{ id: string; matrixVersion: string }>(
      `SELECT id, "matrixVersion"
       FROM "RecipeCoverageSlot"
       WHERE active = true AND "maximumCost" IS NOT NULL
       ORDER BY "matrixVersion", "sortRank"`,
    );
    if (!costSlots.rows.length) return;

    const byMatrix = new Map<string, string[]>();
    for (const row of costSlots.rows) {
      const list = byMatrix.get(row.matrixVersion) ?? [];
      list.push(row.id);
      byMatrix.set(row.matrixVersion, list);
    }

    for (const [matrixVersion, slotIds] of byMatrix) {
      const uniqueSlots = [...new Set(slotIds)].sort();
      await this.db.query(
        `INSERT INTO "RecipeCoverageDirtyState" (
           "matrixVersion", "dirtySince", "nextEligibleRunAt", "reasonSetJson",
           "affectedSlotIdsJson", "affectedRecipeVersionIdsJson", "updatedAt"
         ) VALUES ($1, now(), now(), '["COST_PRICE_REFRESH"]'::jsonb, $2::jsonb, '[]'::jsonb, now())
         ON CONFLICT ("matrixVersion") DO UPDATE SET
           "reasonSetJson" = (
             SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
             FROM jsonb_array_elements_text(
               COALESCE("RecipeCoverageDirtyState"."reasonSetJson", '[]'::jsonb) || '["COST_PRICE_REFRESH"]'::jsonb
             ) AS t(x)
           ),
           "affectedSlotIdsJson" = (
             SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
             FROM jsonb_array_elements_text(
               COALESCE("RecipeCoverageDirtyState"."affectedSlotIdsJson", '[]'::jsonb) || $2::jsonb
             ) AS t(x)
           ),
           "nextEligibleRunAt" = LEAST("RecipeCoverageDirtyState"."nextEligibleRunAt", now()),
           "updatedAt" = now()`,
        [matrixVersion, JSON.stringify(uniqueSlots)],
      );
    }
  }

  async latestForProduct(productId: string): Promise<LatestPriceQuote | null> {
    const result = await this.db.query<{
      productId: string;
      price: string;
      currency: string;
      sourceType: string;
      sourceName: string;
      collectedAt: string;
      retailerId: string | null;
      retailerName: string | null;
      retailerCode: string | null;
      retailProductId: string | null;
      priceCondition: PriceCondition;
      dataClass: string | null;
    }>(
      `SELECT po."productId", po.price::text AS price, po.currency, po."sourceType", po."sourceName",
              COALESCE(po."collectedAt", po."observedAt")::text AS "collectedAt",
              po."retailerId", r.name AS "retailerName", r.code AS "retailerCode", po."retailProductId", po."priceCondition", po."dataClass"
       FROM "PriceObservation" po
       LEFT JOIN "Retailer" r ON r.id = po."retailerId"
       WHERE po."productId" = $1
       ORDER BY COALESCE(po."collectedAt", po."observedAt") DESC
       LIMIT 1`,
      [productId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      productId: row.productId,
      price: Number(row.price),
      currency: row.currency,
      sourceType: row.sourceType as PriceSourceType,
      sourceName: row.sourceName,
      collectedAt: row.collectedAt,
      retailerId: row.retailerId ?? undefined,
      retailerName: row.retailerName ?? undefined,
      retailerCode: row.retailerCode ?? undefined,
      status: freshnessStatus({ observedAt: row.collectedAt, dataClass: row.dataClass, condition: row.priceCondition }),
      priceCondition: row.priceCondition,
      observationId: undefined,
      retailProductId: row.retailProductId ?? undefined,
    };
  }

  async latestForProducts(productIds: string[]): Promise<Map<string, LatestPriceQuote>> {
    const map = new Map<string, LatestPriceQuote>();
    if (!productIds.length) return map;
    for (const productId of productIds) {
      const quote = await this.latestForProduct(productId);
      if (quote) map.set(productId, quote);
    }
    return map;
  }

  async ingestFromProvider(provider: PriceProvider, auditUserId?: string) {
    const prices = await provider.getPrices();
    let productsUpserted = 0;
    let imported = 0;
    for (const price of prices) {
      const productKey = price.productKey ?? price.externalId ?? price.name;
      const productId = await this.ensureProductByKey(productKey, price.name);
      productsUpserted += 1;
      const { retailerId, storeId } = await this.ensureRetailer(price.retailer);
      await this.insertObservation({
        productId,
        storeId,
        retailerId,
        externalSku: price.externalId ?? price.productKey ?? price.name,
        productTitle: price.name,
        packageValue: price.weight,
        packageUnit: price.unit,
        price: price.price,
        currency: price.currency,
        sourceType: provider.sourceType,
        sourceName: provider.sourceName,
        collectedAt: price.collectedAt,
        legacySource: provider.sourceType.toLowerCase(),
      });
      imported += 1;
    }
    if (auditUserId) {
      await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)', [
        auditUserId,
        'price.provider.ingest',
        JSON.stringify({ providerId: provider.id, imported, sourceType: provider.sourceType, sourceName: provider.sourceName }),
      ]);
    }
    return {
      imported,
      productsUpserted,
      sourceType: provider.sourceType,
      sourceName: provider.sourceName,
    };
  }
}
