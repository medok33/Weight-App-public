import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import {
  allergenCodeToLegacy,
  normalizeProductAlias,
  validateNutritionValues,
} from '../domain/product-foundation.policy';
import type {
  AliasResolveResult,
  ProductNutritionSnapshot,
  ProductRestrictionSnapshot,
} from '../domain/product-foundation.types';

@Injectable()
export class ProductFoundationRepository {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async findCategoryIdByCode(code: string, query?: SqlQuery): Promise<string | null> {
    const result = await this.q(query)<{ id: string }>(
      `SELECT id FROM "ProductCategory" WHERE code = $1 AND status = 'ACTIVE' LIMIT 1`,
      [code],
    );
    return result.rows[0]?.id ?? null;
  }

  async listCategories(query?: SqlQuery): Promise<Array<{ id: string; code: string; parentId: string | null; position: number }>> {
    const result = await this.q(query)<{ id: string; code: string; parentId: string | null; position: number }>(
      `SELECT id, code, "parentId", position FROM "ProductCategory" WHERE status = 'ACTIVE' ORDER BY position, code`,
    );
    return result.rows;
  }
}

@Injectable()
export class ProductAliasResolver {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async resolve(alias: string, query?: SqlQuery): Promise<AliasResolveResult> {
    const normalizedAlias = normalizeProductAlias(alias);
    const exact = await this.q(query)<{ productId: string }>(
      `SELECT "productId" FROM "ProductAlias"
       WHERE status = 'ACTIVE' AND lower(trim(alias)) = lower(trim($1))`,
      [alias],
    );
    const exactIds = [...new Set(exact.rows.map((r) => r.productId))];
    if (exactIds.length === 1) {
      return { kind: 'EXACT', productIds: exactIds, normalizedAlias };
    }
    if (exactIds.length > 1) {
      return { kind: 'AMBIGUOUS', productIds: exactIds, normalizedAlias };
    }

    const normalized = await this.q(query)<{ productId: string }>(
      `SELECT "productId" FROM "ProductAlias"
       WHERE status = 'ACTIVE' AND "normalizedAlias" = $1`,
      [normalizedAlias],
    );
    const ids = [...new Set(normalized.rows.map((r) => r.productId))];
    if (ids.length === 1) return { kind: 'UNIQUE_NORMALIZED_MATCH', productIds: ids, normalizedAlias };
    if (ids.length > 1) return { kind: 'AMBIGUOUS', productIds: ids, normalizedAlias };
    return { kind: 'NOT_FOUND', productIds: [], normalizedAlias };
  }
}

@Injectable()
export class ProductNutritionResolver {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async resolveForProduct(productId: string, query?: SqlQuery): Promise<ProductNutritionSnapshot> {
    const map = await this.resolveForProducts([productId], query);
    return (
      map.get(productId) ?? {
        calories: 0,
        protein: 0,
        fat: 0,
        carbohydrate: 0,
        fiber: null,
        sodium: null,
        version: null,
        source: null,
        status: 'MISSING',
      }
    );
  }

  async resolveForProducts(
    productIds: string[],
    query?: SqlQuery,
  ): Promise<Map<string, ProductNutritionSnapshot>> {
    const out = new Map<string, ProductNutritionSnapshot>();
    const ids = [...new Set(productIds.filter(Boolean))];
    if (!ids.length) return out;
    const run = this.q(query);

    const current = await run<{
      productId: string;
      calories: string;
      protein: string;
      fat: string;
      carbohydrate: string;
      fiber: string | null;
      sodium: string | null;
      version: number;
      source: string;
    }>(
      `SELECT p.id AS "productId", v.calories::text, v.protein::text, v.fat::text, v.carbohydrate::text,
              v.fiber::text AS fiber, v.sodium::text AS sodium, v.version, v.source
       FROM "Product" p
       JOIN "ProductNutritionVersion" v ON v.id = p."currentNutritionVersionId"
       WHERE p.id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of current.rows) {
      out.set(row.productId, {
        calories: Number(row.calories),
        protein: Number(row.protein),
        fat: Number(row.fat),
        carbohydrate: Number(row.carbohydrate),
        fiber: row.fiber != null ? Number(row.fiber) : null,
        sodium: row.sodium != null ? Number(row.sodium) : null,
        version: row.version,
        source: row.source,
        status: 'CURRENT_VERSION',
      });
    }

    const missing = ids.filter((id) => !out.has(id));
    if (missing.length) {
      const latest = await run<{
        productId: string;
        calories: string;
        protein: string;
        fat: string;
        carbohydrate: string;
        fiber: string | null;
        sodium: string | null;
        version: number;
        source: string;
      }>(
        `SELECT DISTINCT ON (v."productId")
           v."productId", v.calories::text, v.protein::text, v.fat::text, v.carbohydrate::text,
           v.fiber::text AS fiber, v.sodium::text AS sodium, v.version, v.source
         FROM "ProductNutritionVersion" v
         WHERE v."productId" = ANY($1::uuid[])
         ORDER BY v."productId", v.version DESC`,
        [missing],
      );
      for (const row of latest.rows) {
        out.set(row.productId, {
          calories: Number(row.calories),
          protein: Number(row.protein),
          fat: Number(row.fat),
          carbohydrate: Number(row.carbohydrate),
          fiber: row.fiber != null ? Number(row.fiber) : null,
          sodium: row.sodium != null ? Number(row.sodium) : null,
          version: row.version,
          source: row.source,
          status: 'CURRENT_VERSION',
        });
      }
    }

    const stillMissing = ids.filter((id) => !out.has(id));
    if (stillMissing.length) {
      const legacy = await run<{
        id: string;
        caloriesPer100g: string | null;
        proteinPer100g: string | null;
        fatPer100g: string | null;
        carbsPer100g: string | null;
      }>(
        `SELECT id, "caloriesPer100g"::text, "proteinPer100g"::text,
                "fatPer100g"::text, "carbsPer100g"::text
         FROM "Product" WHERE id = ANY($1::uuid[])`,
        [stillMissing],
      );
      for (const row of legacy.rows) {
        if (row.caloriesPer100g == null) {
          out.set(row.id, {
            calories: 0,
            protein: 0,
            fat: 0,
            carbohydrate: 0,
            fiber: null,
            sodium: null,
            version: null,
            source: null,
            status: 'MISSING',
          });
          continue;
        }
        out.set(row.id, {
          calories: Number(row.caloriesPer100g),
          protein: Number(row.proteinPer100g ?? 0),
          fat: Number(row.fatPer100g ?? 0),
          carbohydrate: Number(row.carbsPer100g ?? 0),
          fiber: null,
          sodium: null,
          version: null,
          source: 'LEGACY_COLUMNS',
          status: 'UNVERSIONED_LEGACY',
        });
      }
    }

    for (const id of ids) {
      if (!out.has(id)) {
        out.set(id, {
          calories: 0,
          protein: 0,
          fat: 0,
          carbohydrate: 0,
          fiber: null,
          sodium: null,
          version: null,
          source: null,
          status: 'MISSING',
        });
      }
    }
    return out;
  }

  async appendVersion(
    productId: string,
    input: {
      calories: number;
      protein: number;
      fat: number;
      carbohydrate: number;
      fiber?: number | null;
      sodium?: number | null;
      source: string;
      createdBy?: string | null;
    },
    query?: SqlQuery,
  ): Promise<{ id: string; version: number }> {
    validateNutritionValues(input);
    const run = this.q(query);
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const next = await run<{ next: number }>(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM "ProductNutritionVersion" WHERE "productId" = $1`,
          [productId],
        );
        const version = next.rows[0]?.next ?? 1;
        const inserted = await run<{ id: string }>(
          `INSERT INTO "ProductNutritionVersion"
            ("productId", version, calories, protein, fat, carbohydrate, fiber, sodium, source, "createdBy")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [
            productId,
            version,
            input.calories,
            input.protein,
            input.fat,
            input.carbohydrate,
            input.fiber ?? null,
            input.sodium ?? null,
            input.source,
            input.createdBy ?? null,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('PRODUCT_NUTRITION_VERSION_CREATE_FAILED');
        await run(`UPDATE "Product" SET "currentNutritionVersionId" = $2, "updatedAt" = now() WHERE id = $1`, [
          productId,
          id,
        ]);
        return { id, version };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/unique|duplicate|ProductNutritionVersion_productId_version/i.test(message)) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('PRODUCT_NUTRITION_VERSION_CONCURRENT');
  }
}

@Injectable()
export class ProductRestrictionResolver {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async resolveForProduct(productId: string, query?: SqlQuery): Promise<ProductRestrictionSnapshot> {
    const map = await this.resolveForProducts([productId], query);
    return (
      map.get(productId) ?? {
        productId,
        allergenCodes: [],
        allergenLegacyCodes: [],
        dietaryTagCodes: [],
        allergenPresenceKnown: false,
      }
    );
  }

  async resolveForProducts(
    productIds: string[],
    query?: SqlQuery,
  ): Promise<Map<string, ProductRestrictionSnapshot>> {
    const map = new Map<string, ProductRestrictionSnapshot>();
    const ids = [...new Set(productIds.filter(Boolean))];
    for (const id of ids) {
      map.set(id, {
        productId: id,
        allergenCodes: [],
        allergenLegacyCodes: [],
        dietaryTagCodes: [],
        allergenPresenceKnown: false,
      });
    }
    if (!ids.length) return map;
    const run = this.q(query);

    const allergens = await run<{ productId: string; code: string }>(
      `SELECT pa."productId", a.code
       FROM "ProductAllergen" pa
       JOIN "Allergen" a ON a.id = pa."allergenId"
       WHERE pa."productId" = ANY($1::uuid[]) AND a.status = 'ACTIVE' AND pa.presence = 'CONTAINS'`,
      [ids],
    );
    for (const row of allergens.rows) {
      const snap = map.get(row.productId)!;
      snap.allergenCodes.push(row.code);
      snap.allergenPresenceKnown = true;
    }
    const tags = await run<{ productId: string; code: string }>(
      `SELECT pdt."productId", t.code
       FROM "ProductDietaryTag" pdt
       JOIN "DietaryTag" t ON t.id = pdt."dietaryTagId"
       WHERE pdt."productId" = ANY($1::uuid[]) AND t.status = 'ACTIVE'`,
      [ids],
    );
    for (const row of tags.rows) {
      map.get(row.productId)!.dietaryTagCodes.push(row.code);
    }
    for (const snap of map.values()) {
      snap.allergenLegacyCodes = [...new Set(snap.allergenCodes.flatMap((c) => allergenCodeToLegacy(c)))];
    }
    return map;
  }
}
