import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { SqlQuery } from '../../../infrastructure/database/prisma.service';
import { classifyPriceObservationHeuristics } from '../../product-catalog/domain/price-data-class.policy';
import type { PriceImportRow, PriceSourceType } from '../domain/price-intelligence.types';
import type { PriceProvider } from '../domain/price-provider';
import type { RetailerRef } from '../domain/retailer.types';
import type { RetailerEntity } from '../domain/retailer-entity';
import { normalizeRetailerCode } from '../domain/retailer-entity';
import {
  DEFAULT_FRESHNESS_WINDOW_MS,
  deriveUnitPrice,
  normalizePackage,
  observationIdentity,
  normalizeCurrency,
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
import type { PriceLocation, RetailerPriceProvider, RetailerProviderPayload, RetailerSyncResult, SyncProduct } from '../domain/retailer-price-provider';
import { readReferencePriceWithQuery } from './reference-price.reader';

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

type SnapshotCandidateRow = {
  id: string;
  regionId: string;
  retailerId: string | null;
  storeId: string;
  price: string;
  confidence: string | null;
  observedAt: string;
  normalizedPackageQuantity: string | null;
  normalizedPackageUnit: string | null;
  unitPrice: string | null;
  unitPriceUnit: string | null;
  priceCondition: PriceCondition;
  sourceType: string;
  sourceName: string;
  dataClass: string | null;
};

@Injectable()
export class PriceIntelligenceRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    return query ?? (this.db.query.bind(this.db) as SqlQuery);
  }

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
  }, query?: SqlQuery): Promise<{ retailerId: string; storeId: string; retailer: RetailerEntity }> {
    const run = this.q(query);
    const code = normalizeRetailerCode(input.code);
    const key = code.toLowerCase();
    const regionCode = input.region ?? 'RU';

    let retailerId: string | undefined;
    const existingRetailer = await run<{ id: string; name: string; region: string; active: boolean }>(
      `SELECT id, name, COALESCE(region, 'RU') AS region, COALESCE(active, true) AS active
       FROM "Retailer"
       WHERE code = $1 OR "key" = $2
       LIMIT 1`,
      [code, key],
    );
    if (existingRetailer.rows[0]) {
      retailerId = existingRetailer.rows[0].id;
      await run(
        `UPDATE "Retailer" SET name = $2, code = $3, region = $4, active = $5, "key" = COALESCE("key", $6) WHERE id = $1`,
        [retailerId, input.name, code, regionCode, input.active ?? true, key],
      );
    } else {
      const created = await run<{ id: string }>(
        `INSERT INTO "Retailer" (name, "key", type, code, region, active)
         VALUES ($1, $2, 'CHAIN', $3, $4, $5)
         ON CONFLICT ("key") DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, region = EXCLUDED.region, active = EXCLUDED.active
         RETURNING id`,
        [input.name, key, code, regionCode, input.active ?? true],
      );
      retailerId = created.rows[0]?.id;
    }
    if (!retailerId) throw new Error('RETAILER_UPSERT_FAILED');

    const region = await run<{ id: string }>(
      `INSERT INTO "Region" (code) VALUES ($1)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [regionCode],
    );
    const regionId = region.rows[0]?.id;
    if (!regionId) throw new Error('RETAILER_UPSERT_FAILED');

    const storeId = await this.ensureStore(retailerId, input.name, {
      scope: 'REGION', regionCode,
    }, run, regionId);
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

  async ensureStore(
    retailerId: string,
    retailerName: string,
    requested: PriceLocation | undefined,
    query?: SqlQuery,
    knownRegionId?: string,
  ): Promise<string> {
    const run = this.q(query);
    const regionCode = String(requested?.regionCode ?? 'RU').trim().toUpperCase() || 'RU';
    const regionId = knownRegionId ?? (await run<{ id: string }>(
      `INSERT INTO "Region" (code) VALUES ($1) ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,
      [regionCode],
    )).rows[0]?.id;
    if (!regionId) throw new Error('RETAILER_STORE_UPSERT_FAILED');

    const requestedScope = requested?.scope ?? 'REGION';
    const exactStore = requestedScope === 'STORE' && Boolean(requested?.externalStoreId?.trim());
    const scope = exactStore ? 'STORE' : requestedScope === 'CITY' && requested?.city?.trim() ? 'CITY' : requestedScope === 'UNKNOWN' ? 'UNKNOWN' : 'REGION';
    const externalStoreId = exactStore
      ? requested!.externalStoreId!.trim()
      : scope === 'CITY'
        ? `SCOPE:CITY:${regionCode}:${requested!.city!.trim().toUpperCase()}`
        : scope === 'UNKNOWN'
          ? `SCOPE:UNKNOWN:${regionCode}`
          : `SCOPE:REGION:${regionCode}`;
    const name = requested?.storeName?.trim() || (scope === 'STORE' ? externalStoreId : `${retailerName} ${scope.toLowerCase()} ${regionCode}`);
    const store = await run<{ id: string }>(
      `INSERT INTO "RetailStore" ("retailerId", "regionId", name, city, address, "externalStoreId", "locationScope")
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT ("retailerId", "externalStoreId") WHERE "externalStoreId" IS NOT NULL
       DO UPDATE SET "regionId"=EXCLUDED."regionId", name=EXCLUDED.name, city=EXCLUDED.city,
                     address=EXCLUDED.address, "locationScope"=EXCLUDED."locationScope"
       RETURNING id`,
      [retailerId, regionId, name, requested?.city?.trim() || null, requested?.address?.trim() || null, externalStoreId, scope],
    );
    const storeId = store.rows[0]?.id;
    if (!storeId) throw new Error('RETAILER_STORE_UPSERT_FAILED');
    return storeId;
  }

  async productExists(productKey: string): Promise<boolean> {
    const result = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "Product" WHERE "productKey" = $1 OR "canonicalName" = $1) ok`,
      [productKey.trim()],
    );
    return result.rows[0]?.ok === true;
  }

  async ensureNormalizedProduct(product: SyncProduct, query?: SqlQuery): Promise<{ id: string; created: boolean }> {
    const run = this.q(query);
    const productKey = product.productKey.trim();
    const existing = await run<{ id: string }>(
      `SELECT id FROM "Product" WHERE "productKey" = $1 OR "canonicalName" = $1 LIMIT 1`,
      [productKey],
    );
    if (existing.rows[0]?.id) {
      await run(
        `UPDATE "Product"
         SET "productKey" = $2, name = $3, category = $4, unit = $5, weight = $6, "canonicalName" = $2
         WHERE id = $1`,
        [existing.rows[0].id, productKey, product.name, product.category, product.unit, product.weight ?? null],
      );
      return { id: existing.rows[0].id, created: false };
    }
    const created = await run<{ id: string }>(
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
    signal?: AbortSignal,
  ): Promise<RetailerSyncResult & { sourceType: string; sourceName: string; productsCreated: number; productsUpdated: number; pricesImported: number }> {
    const [categories, products, prices, availability] = await Promise.all([
      provider.syncCategories(signal), provider.syncProducts(signal),
      provider.syncPrices(signal), provider.syncAvailability(signal),
    ]);
    if (signal?.aborted) throw new Error('PRICE_PROVIDER_TIMEOUT');
    return this.syncRetailerProviderPayload(provider, { categories, products, prices, availability }, auditUserId);
  }

  async syncRetailerProviderPayload(
    provider: RetailerPriceProvider,
    payload: RetailerProviderPayload,
    auditUserId?: string,
  ): Promise<RetailerSyncResult & { sourceType: string; sourceName: string; productsCreated: number; productsUpdated: number; pricesImported: number }> {
    const displayName =
      'retailerDisplayName' in provider && typeof (provider as { retailerDisplayName?: string }).retailerDisplayName === 'string'
        ? (provider as { retailerDisplayName: string }).retailerDisplayName
        : provider.retailerCode;
    const { categories, products, prices, availability } = payload;
    return this.db.withTransaction(async (query) => {
      const { retailerId } = await this.ensureRetailerByCode({ code: provider.retailerCode, name: displayName, region: 'RU', active: true }, query);
      let productsCreated = 0;
      let productsUpdated = 0;
      let pricesImported = 0;
      const syncedKeys = new Set<string>();
      const trackProduct = (upsert: { created: boolean }, productKey: string) => {
        if (syncedKeys.has(productKey)) return;
        syncedKeys.add(productKey);
        if (upsert.created) productsCreated += 1; else productsUpdated += 1;
      };
      for (const product of products) {
        const upsert = await this.ensureNormalizedProduct(product, query);
        trackProduct(upsert, product.productKey);
      }
      for (const price of prices) {
        const product = products.find((item) => item.productKey === price.productKey) ?? {
          productKey: price.productKey, name: price.productKey, category: 'other', unit: 'g',
        };
        const upsert = await this.ensureNormalizedProduct(product, query);
        trackProduct(upsert, price.productKey);
        const storeId = await this.ensureStore(retailerId, displayName, price.location, query);
        const inserted = await this.insertObservation({
          productId: upsert.id, storeId, retailerId, externalSku: price.externalId ?? price.productKey,
          productTitle: product.name, packageValue: price.weight, packageUnit: price.unit,
          price: price.price, currency: price.currency, sourceType: provider.sourceType,
          sourceName: provider.sourceName, providerId: provider.providerId,
          collectedAt: price.collectedAt, legacySource: provider.sourceType.toLowerCase(),
        }, query);
        if (inserted.inserted) pricesImported += 1;
      }
      if (auditUserId) await query(
        'INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)',
        [auditUserId, 'price.provider.sync', JSON.stringify({ providerId: provider.providerId, retailerCode: provider.retailerCode, categories: categories.length, products: products.length, prices: prices.length, availability: availability.length })],
      );
      return { categories: categories.length, products: products.length, prices: prices.length, availability: availability.length,
        sourceType: provider.sourceType, sourceName: provider.sourceName, productsCreated, productsUpdated, pricesImported };
    });
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
    regularPrice?: number;
    conditionDescription?: string;
    validFrom?: string;
    validTo?: string;
    loyaltyRequired?: boolean;
    quantityRequirement?: number;
    providerId?: string;
  }, query?: SqlQuery) {
    if (!query) return this.db.withTransaction((transaction) => this.insertObservation(input, transaction));
    const run = this.q(query);
    if (!Number.isFinite(input.price) || input.price < 0) throw new Error('PRICE_INVALID');
    const currency = normalizeCurrency(input.currency);
    const observedAt = new Date(input.collectedAt);
    if (!Number.isFinite(observedAt.getTime())) throw new Error('PRICE_OBSERVED_AT_INVALID');
    const condition = input.priceCondition ?? 'REGULAR';
    const pack = normalizePackage(input.packageValue, input.packageUnit);
    const unitPrice = deriveUnitPrice(input.price, pack, currency);
    let retailProductId = input.retailProductId ?? null;
    if (!retailProductId && input.retailerId && input.externalSku) {
      const rp = await run<{ id: string }>(
        `INSERT INTO "RetailProduct" ("retailerId", "canonicalProductId", "externalSku", title, "packageWeight", "packageUnit", "packageQuantity", status, "mappingStatus", source, "lastMatchedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 'MAPPED', 'IMPORT', now())
         ON CONFLICT ("retailerId", "externalSku") WHERE "externalSku" IS NOT NULL AND status <> 'MERGED'
         DO UPDATE SET "canonicalProductId" = EXCLUDED."canonicalProductId", "mappingStatus" = 'MAPPED', "packageWeight" = COALESCE(EXCLUDED."packageWeight", "RetailProduct"."packageWeight"), "packageUnit" = COALESCE(EXCLUDED."packageUnit", "RetailProduct"."packageUnit"), "updatedAt" = now()
         RETURNING id`,
        [input.retailerId, input.productId, input.externalSku, input.productTitle ?? input.externalSku, pack?.quantity ?? null, pack?.unit ?? input.packageUnit ?? null, pack?.sourceQuantity ?? null],
      );
      retailProductId = rp.rows[0]?.id ?? null;
    }
    const location = await run<{ regionId: string; locationScope: string }>(
      `SELECT "regionId", "locationScope" FROM "RetailStore" WHERE id=$1`, [input.storeId],
    );
    if (!location.rows[0]) throw new Error('PRICE_STORE_NOT_FOUND');
    const observationKey = observationIdentity({
      productId: input.productId, storeId: input.storeId, retailerId: input.retailerId, retailProductId,
      sourceType: input.sourceType, sourceName: input.sourceName, providerId: input.providerId,
      externalSku: input.externalSku, price: input.price, currency,
      observedAt: input.collectedAt, priceCondition: condition, regionId: location.rows[0].regionId,
      locationScope: location.rows[0].locationScope, packageQuantity: input.packageValue,
      packageUnit: input.packageUnit, regularPrice: input.regularPrice,
      conditionDescription: input.conditionDescription, validFrom: input.validFrom,
      validTo: input.validTo, loyaltyRequired: input.loyaltyRequired,
      quantityRequirement: input.quantityRequirement,
    });
    // Cross-version compatibility: migration 223 rows may carry the former v1 hash.
    // Match the full logical evidence tuple before relying on the v2 unique key.
    const logicalDuplicate = await run<{ id: string }>(
      `SELECT id FROM "PriceObservation"
        WHERE "productId"=$1 AND "storeId"=$2
          AND "retailerId" IS NOT DISTINCT FROM $3::uuid
          AND "retailProductId" IS NOT DISTINCT FROM $4::uuid
          AND price=$5 AND upper(trim(currency))=$6
          AND upper(trim("sourceType"))=upper(trim($7)) AND trim("sourceName")=trim($8)
          AND "observedAt"=$9::timestamptz AND "priceCondition"=$10
          AND "normalizedPackageQuantity" IS NOT DISTINCT FROM $11::numeric
          AND "normalizedPackageUnit" IS NOT DISTINCT FROM $12
          AND "regularPrice" IS NOT DISTINCT FROM $13::numeric
          AND "conditionDescription" IS NOT DISTINCT FROM $14
          AND "validFrom" IS NOT DISTINCT FROM $15::timestamptz
          AND "validTo" IS NOT DISTINCT FROM $16::timestamptz
          AND "loyaltyRequired" IS NOT DISTINCT FROM $17::boolean
          AND "quantityRequirement" IS NOT DISTINCT FROM $18::numeric
        ORDER BY id LIMIT 1`,
      [input.productId, input.storeId, input.retailerId ?? null, retailProductId,
        input.price, currency, input.sourceType, input.sourceName, input.collectedAt, condition,
        pack?.quantity ?? null, pack?.unit ?? null, input.regularPrice ?? input.price,
        input.conditionDescription ?? null, input.validFrom ?? null, input.validTo ?? null,
        input.loyaltyRequired ?? null, input.quantityRequirement ?? null],
    );
    if (logicalDuplicate.rows[0]) {
      return { inserted: false, observationId: logicalDuplicate.rows[0].id, observationKey };
    }
    const inserted = await run<{ id: string }>(
      `INSERT INTO "PriceObservation"
        ("productId", "storeId", "retailerId", "retailProductId", price, currency, "sourceType", "sourceName", "collectedAt", "observedAt", source, "dataClass", "observationKey", "observedPackageWeight", "observedPackageUnit", "normalizedPackageQuantity", "normalizedPackageUnit", "unitPrice", "unitPriceUnit", "priceCondition", "regularPrice", "conditionDescription", "validFrom", "validTo", "loyaltyRequired", "quantityRequirement")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$9::timestamptz,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::timestamptz,$23::timestamptz,$24,$25)
       ON CONFLICT ("observationKey") DO NOTHING RETURNING id`,
      [input.productId, input.storeId, input.retailerId ?? null, retailProductId, input.price, currency, input.sourceType, input.sourceName,
        input.collectedAt, input.legacySource, input.dataClass ?? classifyPriceObservationHeuristics({ source: input.legacySource, sourceName: input.sourceName }), observationKey,
        pack?.sourceQuantity ?? null, pack?.sourceUnit ?? null, pack?.quantity ?? null, pack?.unit ?? null, unitPrice?.value ?? null, unitPrice?.unit ?? null,
        condition, input.regularPrice ?? input.price, input.conditionDescription ?? null, input.validFrom ?? null, input.validTo ?? null, input.loyaltyRequired ?? null, input.quantityRequirement ?? null],
    );
    // STEP_210: price changes do not create RecipeRevalidationTask, but may affect cost-constrained coverage.
    await this.markCoverageCostRefreshDirty(input.productId, run);
    if (inserted.rows[0]?.id) await this.materializeSnapshot(input.productId, input.storeId, run);
    return { inserted: Boolean(inserted.rows[0]?.id), observationId: inserted.rows[0]?.id ?? null, observationKey };
  }

  async materializeSnapshot(productId: string, storeId: string, query?: SqlQuery) {
    const run = this.q(query);
    const candidate = await run<SnapshotCandidateRow>(
      `SELECT po.id, rs."regionId", po."retailerId", po."storeId", po.price::text, COALESCE(po.confidence, 1)::text AS confidence,
              to_char(po."observedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
              po."normalizedPackageQuantity"::text, po."normalizedPackageUnit",
              po."unitPrice"::text, po."unitPriceUnit", po."priceCondition", po."sourceType", po."sourceName", po."dataClass"
       FROM "PriceObservation" po JOIN "RetailStore" rs ON rs.id = po."storeId" JOIN "Retailer" r ON r.id = po."retailerId"
       LEFT JOIN "RetailProduct" rp ON rp.id = po."retailProductId"
       WHERE po."productId" = $1 AND po."storeId" = $2 AND r.active = true
         AND rp.id IS NOT NULL AND rp.status = 'ACTIVE' AND rp."mappingStatus" = 'MAPPED' AND rp."canonicalProductId" = po."productId"
         AND po.price >= 0 AND upper(trim(po.currency)) = 'RUB'
         AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION'
         AND po."priceCondition" IN ('REGULAR','PROMOTIONAL')
         AND (po."validFrom" IS NULL OR po."validFrom" <= now())
         AND (po."validTo" IS NULL OR po."validTo" >= now())
       ORDER BY CASE WHEN rs."locationScope" = 'STORE' THEN 3 WHEN rs."locationScope" = 'CITY' THEN 2 ELSE 1 END DESC,
                CASE WHEN po."sourceType" = 'API' THEN 4 WHEN po."sourceType" = 'CSV' THEN 3 WHEN po."sourceType" = 'MANUAL' THEN 2 ELSE 1 END DESC,
                po."observedAt" DESC, po.id ASC LIMIT 1`, [productId, storeId]);
    const row = candidate.rows[0];
    if (!row) return null;
    const freshUntil = new Date(new Date(row.observedAt).getTime() + DEFAULT_FRESHNESS_WINDOW_MS);
    await run(
      `INSERT INTO "PriceSnapshot" ("productId", "regionId", "retailerId", "storeId", "evidenceObservationId", price, confidence, "observedAt", status, "freshUntil", "normalizedPackageQuantity", "normalizedPackageUnit", "unitPrice", "unitPriceUnit", "priceCondition", "sourceType", "sourceName")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,'CURRENT',$9::timestamptz,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT ("productId", "regionId", "storeId") DO UPDATE SET "retailerId"=EXCLUDED."retailerId", "evidenceObservationId"=EXCLUDED."evidenceObservationId", price=EXCLUDED.price, confidence=EXCLUDED.confidence, "observedAt"=EXCLUDED."observedAt", status=EXCLUDED.status, "freshUntil"=EXCLUDED."freshUntil", "normalizedPackageQuantity"=EXCLUDED."normalizedPackageQuantity", "normalizedPackageUnit"=EXCLUDED."normalizedPackageUnit", "unitPrice"=EXCLUDED."unitPrice", "unitPriceUnit"=EXCLUDED."unitPriceUnit", "priceCondition"=EXCLUDED."priceCondition", "sourceType"=EXCLUDED."sourceType", "sourceName"=EXCLUDED."sourceName"
       WHERE "PriceSnapshot"."observedAt" < EXCLUDED."observedAt"
          OR ("PriceSnapshot"."observedAt" = EXCLUDED."observedAt"
              AND COALESCE(EXCLUDED."evidenceObservationId"::text, '') < COALESCE("PriceSnapshot"."evidenceObservationId"::text, ''))`,
      [productId, row.regionId, row.retailerId, row.storeId, row.id, Number(row.price), Number(row.confidence ?? 1), row.observedAt, freshUntil.toISOString(), row.normalizedPackageQuantity ? Number(row.normalizedPackageQuantity) : null, row.normalizedPackageUnit, row.unitPrice ? Number(row.unitPrice) : null, row.unitPriceUnit, row.priceCondition, row.sourceType, row.sourceName]);
    return row.id;
  }

  async readReferencePrice(productId: string, options: { storeId?: string; regionId?: string; now?: Date } = {}): Promise<ReferencePriceEvidence> {
    return readReferencePriceWithQuery(this.q(), productId, options);
  }

  /**
   * Mark coverage matrix dirty for cost refresh when cost-constrained slots exist.
   * Does not run analyzer inline; debounce/worker/scheduler apply later.
   */
  async markCoverageCostRefreshDirty(productId: string, query?: SqlQuery) {
    const run = this.q(query);
    // Any new observation can affect portion cost for recipes using this product.
    // Mark all active cost-constrained slots on each matrix for controlled refresh.
    void productId;
    const costSlots = await run<{ id: string; matrixVersion: string }>(
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
      await run(
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
    const row = await this.readReferencePrice(productId);
    if (row.price == null) return null;
    return {
      productId: row.productId,
      price: row.price,
      currency: row.currency,
      sourceType: (row.sourceType ?? 'MANUAL') as PriceSourceType,
      sourceName: row.sourceName ?? 'unknown',
      collectedAt: row.observedAt ?? new Date(0).toISOString(),
      retailerId: row.retailerId ?? undefined,
      retailerName: row.retailerName ?? undefined,
      retailerCode: row.retailerCode ?? undefined,
      status: row.status,
      normalizedUnitPrice: row.normalizedUnitPrice ?? undefined,
      normalizedUnit: row.normalizedUnit ?? undefined,
      priceCondition: row.priceCondition,
      observationId: row.observationId ?? undefined,
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
