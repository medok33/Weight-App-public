import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type {
  ShoppingItemRecord,
  ShoppingListGenerationStatus,
  ShoppingListRecord,
} from '../domain/shopping-list.types';
import type { AggregatedShoppingItem } from '../domain/shopping-list.policy';
import { readReferencePriceWithQuery } from '../../price-intelligence/infrastructure/reference-price.reader';
import { PriceIntelligenceRepository } from '../../price-intelligence/infrastructure/price-intelligence.repository';

type ItemRow = {
  id: string;
  productId: string | null;
  name: string;
  category: string;
  quantity: string;
  unit: string;
  purchased: boolean;
  estimatedUnitPrice: string | null;
  estimatedCost: string | null;
};

type ListRow = {
  id: string;
  userId: string;
  createdAt: string;
  sourcePlanId: string | null;
  sourcePlanVersion: string | null;
  generationStatus: string;
  generatedAt: string;
};

type PricedItem = AggregatedShoppingItem & {
  productId: string;
  unitPrice: number;
  estimatedCost: number;
  priceSourceType?: string;
  priceSourceName?: string;
  priceCollectedAt?: string;
  retailerName?: string;
  retailerCode?: string;
};

@Injectable()
export class ShoppingListRepository {
  private readonly prices: PriceIntelligenceRepository;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(PriceIntelligenceRepository) prices?: PriceIntelligenceRepository,
  ) {
    this.prices = prices ?? new PriceIntelligenceRepository(db);
  }

  private q(query?: SqlQuery): SqlQuery {
    return query ?? ((text, values = []) => this.db.query(text, values));
  }

  async ensureProduct(productKey: string, unit: string, query?: SqlQuery): Promise<string> {
    const run = this.q(query);
    const key = productKey.trim();
    const existing = await run<{ id: string }>(
      `SELECT id FROM "Product" WHERE "productKey" = $1 OR "canonicalName" = $1 LIMIT 1`,
      [key],
    );
    if (existing.rows[0]?.id) {
      await run(`UPDATE "Product" SET "productKey" = COALESCE("productKey", $2), unit = $3 WHERE id = $1`, [
        existing.rows[0].id,
        key,
        unit,
      ]);
      return existing.rows[0].id;
    }
    const created = await run<{ id: string }>(
      `INSERT INTO "Product" ("canonicalName", "productKey", name, unit, "caloriesPer100g", "proteinPer100g")
       VALUES ($1, $1, $1, $2, 0, 0)
       ON CONFLICT ("canonicalName") DO UPDATE SET unit = EXCLUDED.unit, "productKey" = EXCLUDED."productKey"
       RETURNING id`,
      [key, unit],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('PRODUCT_UPSERT_FAILED');
    return id;
  }

  async ensurePriceCatalogStore(query?: SqlQuery): Promise<string> {
    const run = this.q(query);
    const existing = await run<{ id: string }>(
      `SELECT s.id FROM "RetailStore" s
       JOIN "Retailer" r ON r.id = s."retailerId"
       WHERE r."key" = 'catalog_fallback'
       LIMIT 1`,
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;

    const region = await run<{ id: string }>(
      `INSERT INTO "Region" (code) VALUES ('local-mvp') ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
    );
    const regionId = region.rows[0]?.id;
    const retailer = await run<{ id: string }>(
      `INSERT INTO "Retailer" (name, "key", type, code, region, active)
       VALUES ('Каталог (fallback)', 'catalog_fallback', 'LOCAL', 'CATALOG_FALLBACK', 'RU', true)
       ON CONFLICT ("key") DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code
       RETURNING id`,
    );
    const retailerId = retailer.rows[0]?.id;
    if (!regionId || !retailerId) throw new Error('PRICE_CATALOG_STORE_FAILED');
    const store = await run<{ id: string }>(
      `INSERT INTO "RetailStore" ("retailerId", "regionId", name, "externalStoreId", "locationScope")
       VALUES ($1, $2, $3, 'SCOPE:UNKNOWN:CATALOG_FALLBACK', 'UNKNOWN')
       ON CONFLICT ("retailerId", "externalStoreId") WHERE "externalStoreId" IS NOT NULL
       DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [retailerId, regionId, 'Catalog fallback store'],
    );
    const storeId = store.rows[0]?.id;
    if (!storeId) throw new Error('PRICE_CATALOG_STORE_FAILED');
    return storeId;
  }

  async ensureObservation(
    productId: string,
    storeId: string,
    price: number,
    query?: SqlQuery,
  ): Promise<{
    price: number;
    sourceType: string;
    sourceName: string;
    collectedAt: string;
    retailerName?: string;
    retailerCode?: string;
    dataClass?: string;
    status: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'APPROXIMATE';
  }> {
    const run = this.q(query);
    const latest = await readReferencePriceWithQuery(run, productId);
    if (latest.status === 'CURRENT' && latest.price != null && latest.currency === 'RUB') {
      return {
        price: latest.price, sourceType: latest.sourceType ?? 'MANUAL',
        sourceName: latest.sourceName ?? 'unknown', collectedAt: latest.observedAt!,
        retailerName: latest.retailerName ?? undefined, retailerCode: latest.retailerCode ?? undefined,
        dataClass: latest.dataClass ?? 'PRODUCTION', status: 'CURRENT',
      };
    }
    const sourceName = 'Каталог (fallback)';
    const collectedAt = new Date().toISOString();
    await this.prices.insertObservation({
      productId, storeId, price, currency: 'RUB', sourceType: 'MANUAL', sourceName,
      collectedAt, legacySource: 'catalog', dataClass: 'TEST_ONLY', priceCondition: 'UNKNOWN_CONDITION',
    }, query);
    return {
      price,
      sourceType: 'MANUAL',
      sourceName,
      collectedAt,
      dataClass: 'TEST_ONLY',
      status: 'APPROXIMATE',
    };
  }

  /** @deprecated prefer createListForPlan — kept for callers without plan linkage */
  async createList(userId: string, items: PricedItem[]): Promise<ShoppingListRecord> {
    return this.createListForPlan(userId, items, { sourcePlanId: null, sourcePlanVersion: null });
  }

  async createListForPlan(
    userId: string,
    items: PricedItem[],
    meta: { sourcePlanId: string | null; sourcePlanVersion: number | null },
    query?: SqlQuery,
  ): Promise<ShoppingListRecord> {
    const run = this.q(query);

    if (meta.sourcePlanVersion != null) {
      const existing = await run<{ id: string }>(
        `SELECT id FROM "ShoppingList"
         WHERE "userId" = $1 AND "sourcePlanVersion" = $2
         LIMIT 1`,
        [userId, meta.sourcePlanVersion],
      );
      if (existing.rows[0]?.id) {
        const saved = await this.findById(existing.rows[0].id, query);
        if (!saved) throw new Error('SHOPPING_LIST_SAVE_FAILED');
        return saved;
      }
    }

    await run(
      `UPDATE "ShoppingList"
       SET "generationStatus" = 'STALE'
       WHERE "userId" = $1 AND "generationStatus" = 'CURRENT'`,
      [userId],
    );

    const list = await run<{ id: string }>(
      `INSERT INTO "ShoppingList"
        ("userId", "sourcePlanId", "sourcePlanVersion", "generationStatus", "generatedAt")
       VALUES ($1, $2, $3, 'CURRENT', now())
       ON CONFLICT ("userId", "sourcePlanVersion") WHERE "sourcePlanVersion" IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [userId, meta.sourcePlanId, meta.sourcePlanVersion],
    );
    let listId = list.rows[0]?.id;
    if (!listId && meta.sourcePlanVersion != null) {
      const again = await run<{ id: string }>(
        `SELECT id FROM "ShoppingList" WHERE "userId" = $1 AND "sourcePlanVersion" = $2 LIMIT 1`,
        [userId, meta.sourcePlanVersion],
      );
      listId = again.rows[0]?.id;
      if (listId) {
        const saved = await this.findById(listId, query);
        if (!saved) throw new Error('SHOPPING_LIST_SAVE_FAILED');
        return saved;
      }
    }
    if (!listId) throw new Error('SHOPPING_LIST_SAVE_FAILED');

    for (const item of items) {
      await run(
        `INSERT INTO "ShoppingItem"
          ("shoppingListId", "productId", name, category, quantity, unit, purchased, "estimatedUnitPrice", "estimatedCost")
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8)`,
        [listId, item.productId, item.name, item.category, item.quantity, item.unit, item.unitPrice, item.estimatedCost],
      );
    }

    const saved = await this.findById(listId, query);
    if (!saved) throw new Error('SHOPPING_LIST_SAVE_FAILED');
    return saved;
  }

  async findLatestByUserId(userId: string): Promise<ShoppingListRecord | null> {
    const list = await this.db.query<{ id: string }>(
      `SELECT id FROM "ShoppingList"
       WHERE "userId" = $1
       ORDER BY
         CASE WHEN "generationStatus" = 'CURRENT' THEN 0 ELSE 1 END,
         "generatedAt" DESC NULLS LAST,
         "createdAt" DESC
       LIMIT 1`,
      [userId],
    );
    const listId = list.rows[0]?.id;
    if (!listId) return null;
    return this.findById(listId);
  }

  async findByPlanVersion(userId: string, sourcePlanVersion: number, query?: SqlQuery): Promise<ShoppingListRecord | null> {
    const run = this.q(query);
    const list = await run<{ id: string }>(
      `SELECT id FROM "ShoppingList"
       WHERE "userId" = $1 AND "sourcePlanVersion" = $2
       LIMIT 1`,
      [userId, sourcePlanVersion],
    );
    const listId = list.rows[0]?.id;
    if (!listId) return null;
    return this.findById(listId, query);
  }

  async findById(listId: string, query?: SqlQuery): Promise<ShoppingListRecord | null> {
    const run = this.q(query);
    const list = await run<ListRow>(
      `SELECT id, "userId", "createdAt"::text AS "createdAt",
              "sourcePlanId"::text AS "sourcePlanId",
              "sourcePlanVersion"::text AS "sourcePlanVersion",
              COALESCE("generationStatus", 'CURRENT') AS "generationStatus",
              COALESCE("generatedAt", "createdAt")::text AS "generatedAt"
       FROM "ShoppingList" WHERE id = $1`,
      [listId],
    );
    const row = list.rows[0];
    if (!row) return null;
    const items = await run<ItemRow>(
      `SELECT si.id, si."productId", si.name, si.category, si.quantity::text AS quantity, si.unit, si.purchased,
              si."estimatedUnitPrice"::text AS "estimatedUnitPrice", si."estimatedCost"::text AS "estimatedCost"
       FROM "ShoppingItem" si
       WHERE si."shoppingListId" = $1
       ORDER BY si.category, si.name`,
      [listId],
    );
    const enriched = await Promise.all(items.rows.map(async (item) => {
      if (!item.productId) return item;
      const evidence = await readReferencePriceWithQuery(run, item.productId);
      return {
        ...item,
        priceSourceType: evidence.sourceType,
        priceSourceName: evidence.sourceName,
        priceCollectedAt: evidence.observedAt,
        retailerName: evidence.retailerName,
        retailerCode: evidence.retailerCode,
        // Preserve the canonical reader's absence as non-production metadata so
        // a USER read cannot resurrect the persisted generation-time estimate.
        dataClass: evidence.status === 'UNKNOWN' ? 'UNKNOWN' : evidence.dataClass,
      };
    }));
    const mapped = enriched.map((item) => this.mapItem(item));
    const estimatedTotal = mapped.reduce((sum, item) => sum + item.estimatedCost, 0);
    const purchasedTotal = mapped.filter((item) => item.purchased).reduce((sum, item) => sum + item.estimatedCost, 0);
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      sourcePlanId: row.sourcePlanId,
      sourcePlanVersion: row.sourcePlanVersion != null ? Number(row.sourcePlanVersion) : null,
      generationStatus: (row.generationStatus as ShoppingListGenerationStatus) || 'CURRENT',
      generatedAt: row.generatedAt,
      syncStatus: 'unknown',
      estimatedTotal: Number(estimatedTotal.toFixed(2)),
      purchasedTotal: Number(purchasedTotal.toFixed(2)),
      remainingTotal: Number((estimatedTotal - purchasedTotal).toFixed(2)),
      items: mapped,
    };
  }

  async setPurchased(userId: string, itemId: string, purchased: boolean): Promise<ShoppingListRecord> {
    const ownership = await this.db.query<{ listId: string }>(
      `SELECT sl.id AS "listId"
       FROM "ShoppingItem" si
       JOIN "ShoppingList" sl ON sl.id = si."shoppingListId"
       WHERE si.id = $1 AND sl."userId" = $2`,
      [itemId, userId],
    );
    const listId = ownership.rows[0]?.listId;
    if (!listId) throw new Error('SHOPPING_ITEM_NOT_FOUND');
    await this.db.query('UPDATE "ShoppingItem" SET purchased = $2, "updatedAt" = now() WHERE id = $1', [
      itemId,
      purchased,
    ]);
    const list = await this.findById(listId);
    if (!list) throw new Error('SHOPPING_LIST_NOT_FOUND');
    return list;
  }

  private mapItem(
    row: ItemRow & {
      priceSourceType?: string | null;
      priceSourceName?: string | null;
      priceCollectedAt?: string | null;
      retailerName?: string | null;
      retailerCode?: string | null;
      dataClass?: string | null;
    },
  ): ShoppingItemRecord {
    return {
      id: row.id,
      productId: row.productId ?? undefined,
      name: row.name,
      category: row.category as ShoppingItemRecord['category'],
      quantity: Number(row.quantity),
      unit: row.unit,
      purchased: row.purchased,
      estimatedUnitPrice: Number(row.estimatedUnitPrice ?? 0),
      estimatedCost: Number(row.estimatedCost ?? 0),
      priceSourceType: row.priceSourceType ?? undefined,
      priceSourceName: row.priceSourceName ?? undefined,
      priceCollectedAt: row.priceCollectedAt ?? undefined,
      retailerName: row.retailerName ?? undefined,
      retailerCode: row.retailerCode ?? undefined,
      priceDataClass: row.dataClass ?? undefined,
    };
  }
}
