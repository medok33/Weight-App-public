import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { allowTestPriceEvidence, classifyPriceObservationHeuristics } from '../domain/price-data-class.policy';
import {
  assertCookingMethodCode,
  assertCulinaryRoleCode,
  assertNutritionImpact,
  assertSubstitutionStatus,
  assertTextureImpact,
  methodCompatible,
  validateSubstitutionEdge,
} from '../domain/product-roles-retail.policy';
import type {
  CookingMethodCode,
  CulinaryRoleCode,
  ProductCulinaryRoleSnapshot,
  ProductPriceQuote,
  ProductSubstitutionEdge,
  RetailProductSnapshot,
} from '../domain/product-roles-retail.types';
import { COOKING_METHOD_CODES } from '../domain/product-roles-retail.types';

const STALE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

@Injectable()
export class ProductCulinaryRoleResolver {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async rolesForProducts(
    productIds: string[],
    query?: SqlQuery,
  ): Promise<Map<string, ProductCulinaryRoleSnapshot[]>> {
    const out = new Map<string, ProductCulinaryRoleSnapshot[]>();
    const ids = [...new Set(productIds.filter(Boolean))];
    if (!ids.length) return out;

    const hasTable = await this.q(query)<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ProductCulinaryRole'
       ) AS ok`,
    );
    if (!hasTable.rows[0]?.ok) return out;

    const result = await this.q(query)<{
      productId: string;
      culinaryRoleId: string;
      code: string;
      isPrimary: boolean;
      source: string;
      confidence: string;
    }>(
      `SELECT pcr."productId", pcr."culinaryRoleId", cr.code, pcr."isPrimary", pcr.source,
              pcr.confidence::text AS confidence
       FROM "ProductCulinaryRole" pcr
       JOIN "CulinaryRole" cr ON cr.id = pcr."culinaryRoleId"
       WHERE pcr."productId" = ANY($1::uuid[])
         AND cr.status = 'ACTIVE'
       ORDER BY pcr."isPrimary" DESC, cr.code`,
      [ids],
    );

    for (const row of result.rows) {
      const list = out.get(row.productId) ?? [];
      list.push({
        productId: row.productId,
        culinaryRoleId: row.culinaryRoleId,
        culinaryRoleCode: assertCulinaryRoleCode(row.code),
        isPrimary: row.isPrimary,
        source: row.source,
        confidence: Number(row.confidence),
      });
      out.set(row.productId, list);
    }
    return out;
  }

  async primaryRoleCode(productId: string, query?: SqlQuery): Promise<CulinaryRoleCode | null> {
    const map = await this.rolesForProducts([productId], query);
    const roles = map.get(productId) ?? [];
    return roles.find((r) => r.isPrimary)?.culinaryRoleCode ?? roles[0]?.culinaryRoleCode ?? null;
  }
}

@Injectable()
export class ProductSubstitutionResolver {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async listActiveForSource(
    sourceProductId: string,
    options?: { cookingMethod?: string | null; cookingMethods?: string[] | null; query?: SqlQuery },
  ): Promise<ProductSubstitutionEdge[]> {
    const edges = await this.listEdgesForSource(sourceProductId, {
      statuses: ['ACTIVE'],
      query: options?.query,
    });
    const recipeMethods = [
      ...new Set(
        [...(options?.cookingMethods ?? []), options?.cookingMethod]
          .filter((m): m is string => Boolean(m)),
      ),
    ];
    if (!recipeMethods.length) return edges;

    const out: ProductSubstitutionEdge[] = [];
    for (const edge of edges) {
      if (edge.supportedMethods.length && !recipeMethods.some((m) => methodCompatible(edge.supportedMethods, m))) {
        continue;
      }
      // Replacement must support the culinary role when role is set.
      if (edge.culinaryRoleId) {
        const roleOk = await this.q(options?.query)<{ ok: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM "ProductCulinaryRole"
             WHERE "productId" = $1 AND "culinaryRoleId" = $2
           ) AS ok`,
          [edge.replacementProductId, edge.culinaryRoleId],
        );
        if (!roleOk.rows[0]?.ok) continue;
      }
      out.push(edge);
    }
    return out;
  }

  /**
   * Load curated edges for eligibility (no cooking-method filter).
   * Includes non-ACTIVE so SUSPENDED/REJECTED/ARCHIVED never become curated but also
   * do not alone prove METHOD_INCOMPATIBLE.
   */
  async listEdgesForSource(
    sourceProductId: string,
    options?: {
      statuses?: Array<'ACTIVE' | 'NEEDS_REVIEW' | 'SUSPENDED' | 'REJECTED' | 'ARCHIVED'>;
      query?: SqlQuery;
    },
  ): Promise<ProductSubstitutionEdge[]> {
    const hasTable = await this.q(options?.query)<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ProductSubstitution'
       ) AS ok`,
    );
    if (!hasTable.rows[0]?.ok) return [];

    const statuses = options?.statuses ?? [
      'ACTIVE',
      'NEEDS_REVIEW',
      'SUSPENDED',
      'REJECTED',
      'ARCHIVED',
    ];

    const result = await this.q(options?.query)<{
      id: string;
      sourceProductId: string;
      replacementProductId: string;
      culinaryRoleId: string | null;
      culinaryRoleCode: string | null;
      replacementRatio: string;
      replacementRatioMin: string;
      replacementRatioMax: string;
      nutritionImpact: string;
      textureImpact: string;
      supportedMethods: string[] | null;
      status: string;
      source: string;
      confidence: string;
    }>(
      `SELECT ps.id, ps."sourceProductId", ps."replacementProductId", ps."culinaryRoleId",
              cr.code AS "culinaryRoleCode",
              ps."replacementRatio"::text, ps."replacementRatioMin"::text, ps."replacementRatioMax"::text,
              ps."nutritionImpact", ps."textureImpact", ps."supportedMethods",
              ps.status, ps.source, ps.confidence::text AS confidence
       FROM "ProductSubstitution" ps
       LEFT JOIN "CulinaryRole" cr ON cr.id = ps."culinaryRoleId"
       WHERE ps."sourceProductId" = $1
         AND ps.status = ANY($2::text[])
       ORDER BY ps."replacementProductId", ps."culinaryRoleId" NULLS FIRST, ps.id`,
      [sourceProductId, statuses],
    );

    return result.rows.map((row) => ({
      id: row.id,
      sourceProductId: row.sourceProductId,
      replacementProductId: row.replacementProductId,
      culinaryRoleId: row.culinaryRoleId,
      culinaryRoleCode: row.culinaryRoleCode
        ? assertCulinaryRoleCode(row.culinaryRoleCode)
        : null,
      replacementRatio: Number(row.replacementRatio),
      replacementRatioMin: Number(row.replacementRatioMin),
      replacementRatioMax: Number(row.replacementRatioMax),
      nutritionImpact: assertNutritionImpact(row.nutritionImpact),
      textureImpact: assertTextureImpact(row.textureImpact),
      supportedMethods: (row.supportedMethods ?? [])
        .filter((m) => (COOKING_METHOD_CODES as readonly string[]).includes(m))
        .map((m) => assertCookingMethodCode(m)),
      status: assertSubstitutionStatus(row.status),
      source: row.source,
      confidence: Number(row.confidence),
    }));
  }

  /** Domain validation helper for unit tests / future writes (STEP_200). */
  validateNewEdge(input: {
    sourceProductId: string;
    replacementProductId: string;
    replacementRatio: number;
    replacementRatioMin: number;
    replacementRatioMax: number;
  }): void {
    validateSubstitutionEdge(input);
  }
}

@Injectable()
export class RetailProductRepository {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async findMappedForProduct(
    productId: string,
    options?: { retailerId?: string | null; query?: SqlQuery },
  ): Promise<RetailProductSnapshot[]> {
    const hasTable = await this.q(options?.query)<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'RetailProduct'
       ) AS ok`,
    );
    if (!hasTable.rows[0]?.ok) return [];

    const result = await this.q(options?.query)<{
      id: string;
      retailerId: string;
      canonicalProductId: string | null;
      externalSku: string | null;
      title: string;
      brand: string | null;
      packageWeight: string | null;
      packageUnit: string | null;
      status: string;
      mappingStatus: string;
      source: string;
    }>(
      `SELECT id, "retailerId", "canonicalProductId", "externalSku", title, brand,
              "packageWeight"::text, "packageUnit", status, "mappingStatus", source
       FROM "RetailProduct"
       WHERE "canonicalProductId" = $1
         AND status = 'ACTIVE'
         AND "mappingStatus" = 'MAPPED'
         AND ($2::uuid IS NULL OR "retailerId" = $2)
       ORDER BY "updatedAt" DESC`,
      [productId, options?.retailerId ?? null],
    );

    return result.rows.map((row) => ({
      id: row.id,
      retailerId: row.retailerId,
      canonicalProductId: row.canonicalProductId,
      externalSku: row.externalSku,
      title: row.title,
      brand: row.brand,
      packageWeight: row.packageWeight != null ? Number(row.packageWeight) : null,
      packageUnit: row.packageUnit,
      status: row.status,
      mappingStatus: row.mappingStatus as 'MAPPED' | 'NEEDS_PRODUCT_MAPPING',
      source: row.source,
    }));
  }

  /**
   * Idempotent fixture helper: create mapped RetailProduct for a canonical Product + retailer SKU.
   */
  async ensureMappedFixture(input: {
    retailerId: string;
    canonicalProductId: string;
    externalSku: string;
    title: string;
    packageWeight: number;
    packageUnit: string;
    query?: SqlQuery;
  }): Promise<string> {
    const existing = await this.q(input.query)<{ id: string }>(
      `SELECT id FROM "RetailProduct"
       WHERE "retailerId" = $1 AND "externalSku" = $2 AND status <> 'MERGED'
       LIMIT 1`,
      [input.retailerId, input.externalSku],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await this.q(input.query)<{ id: string }>(
      `INSERT INTO "RetailProduct"
        ("retailerId", "canonicalProductId", "externalSku", title,
         "packageWeight", "packageUnit", status, "mappingStatus", source, "lastMatchedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','MAPPED','FIXTURE', now())
       RETURNING id`,
      [
        input.retailerId,
        input.canonicalProductId,
        input.externalSku,
        input.title,
        input.packageWeight,
        input.packageUnit,
      ],
    );
    return inserted.rows[0]!.id;
  }
}

@Injectable()
export class ProductPriceResolver {
  constructor(@Optional() @Inject(PrismaService) private readonly db?: PrismaService) {}

  private q(query?: SqlQuery): SqlQuery {
    if (query) return query;
    if (!this.db) throw new Error('PRODUCT_CATALOG_DB_MISSING');
    return this.db.query.bind(this.db) as SqlQuery;
  }

  async resolveForProduct(
    productId: string,
    options?: {
      retailerId?: string | null;
      regionCode?: string | null;
      consumedAmount?: number | null;
      query?: SqlQuery;
      /** Explicit opt-in for FIXTURE/TEST_ONLY evidence (never implied by VITEST alone). */
      allowTestPrices?: boolean;
    },
  ): Promise<ProductPriceQuote> {
    const map = await this.resolveForProducts([productId], options);
    return (
      map.get(productId) ?? {
        productId,
        retailProductId: null,
        retailerId: null,
        retailerName: null,
        retailerCode: null,
        packageWeight: null,
        packageUnit: null,
        packagePriceRub: null,
        currency: 'RUB',
        collectedAt: null,
        availability: null,
        confidence: null,
        stale: false,
        provenance: 'PRICE_MISSING',
        coverage: 'MISSING',
      }
    );
  }

  async resolveForProducts(
    productIds: string[],
    options?: {
      retailerId?: string | null;
      regionCode?: string | null;
      query?: SqlQuery;
    },
  ): Promise<Map<string, ProductPriceQuote>> {
    const out = new Map<string, ProductPriceQuote>();
    const ids = [...new Set(productIds.filter(Boolean))];
    for (const id of ids) {
      out.set(id, await this.resolveOne(id, options));
    }
    return out;
  }

  private async resolveOne(
    productId: string,
    options?: {
      retailerId?: string | null;
      regionCode?: string | null;
      query?: SqlQuery;
    },
  ): Promise<ProductPriceQuote> {
    const missing: ProductPriceQuote = {
      productId,
      retailProductId: null,
      retailerId: null,
      retailerName: null,
      retailerCode: null,
      packageWeight: null,
      packageUnit: null,
      packagePriceRub: null,
      currency: 'RUB',
      collectedAt: null,
      availability: null,
      confidence: null,
      stale: false,
      provenance: 'PRICE_MISSING',
      coverage: 'MISSING',
    };

    const hasRetailCol = await this.q(options?.query)<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'PriceObservation'
           AND column_name = 'retailProductId'
       ) AS ok`,
    );

    if (hasRetailCol.rows[0]?.ok) {
      const hasDataClass = await this.q(options?.query)<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'PriceObservation'
             AND column_name = 'dataClass'
         ) AS ok`,
      );
      const allowTest = allowTestPriceEvidence({
        allowTestPrices: (options as { allowTestPrices?: boolean } | undefined)?.allowTestPrices,
      });
      const dataClassFilter = hasDataClass.rows[0]?.ok
        ? allowTest
          ? ''
          : ` AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION'
              AND COALESCE(rp.source, '') <> 'FIXTURE' `
        : allowTest
          ? ''
          : ` AND COALESCE(rp.source, '') <> 'FIXTURE'
              AND lower(COALESCE(po.source, '')) NOT IN ('step092_fixture', 'fixture')
              AND lower(COALESCE(po."sourceName", '')) NOT LIKE '%fixture%'
              AND lower(COALESCE(po."sourceName", '')) NOT LIKE '%step092%' `;

      const retail = await this.q(options?.query)<{
        retailProductId: string;
        retailerId: string | null;
        retailerName: string | null;
        retailerCode: string | null;
        packageWeight: string | null;
        packageUnit: string | null;
        price: string;
        currency: string;
        collectedAt: string | null;
        availability: string | null;
        confidence: string | null;
        dataClass: string | null;
      }>(
        `SELECT po."retailProductId"::text AS "retailProductId",
                COALESCE(po."retailerId", rp."retailerId")::text AS "retailerId",
                r.name AS "retailerName", r.code AS "retailerCode",
                COALESCE(po."observedPackageWeight", rp."packageWeight")::text AS "packageWeight",
                COALESCE(po."observedPackageUnit", rp."packageUnit") AS "packageUnit",
                po.price::text AS price, po.currency,
                COALESCE(po."collectedAt", po."observedAt")::text AS "collectedAt",
                po.availability, po.confidence::text AS confidence,
                ${hasDataClass.rows[0]?.ok ? 'po."dataClass"' : `'PRODUCTION'`} AS "dataClass"
         FROM "PriceObservation" po
         JOIN "RetailProduct" rp ON rp.id = po."retailProductId"
         LEFT JOIN "Retailer" r ON r.id = COALESCE(po."retailerId", rp."retailerId")
         LEFT JOIN "RetailStore" s ON s.id = po."storeId"
         LEFT JOIN "Region" reg ON reg.id = s."regionId"
         WHERE po."productId" = $1
           AND po."retailProductId" IS NOT NULL
           AND rp.status = 'ACTIVE'
           AND rp."mappingStatus" = 'MAPPED'
           AND COALESCE(po.availability, 'IN_STOCK') <> 'OUT_OF_STOCK'
           AND ($2::uuid IS NULL OR COALESCE(po."retailerId", rp."retailerId") = $2)
           AND ($3::text IS NULL OR reg.code = $3)
           ${dataClassFilter}
         ORDER BY COALESCE(po."collectedAt", po."observedAt") DESC
         LIMIT 1`,
        [productId, options?.retailerId ?? null, options?.regionCode ?? null],
      );

      const row = retail.rows[0];
      if (row) {
        const collectedAt = row.collectedAt;
        const stale = collectedAt ? Date.now() - Date.parse(collectedAt) > STALE_MS : false;
        const packageWeight = row.packageWeight != null ? Number(row.packageWeight) : null;
        const packagePriceRub = Number(row.price);
        const incomplete = !(packageWeight && packageWeight > 0) || !(packagePriceRub >= 0);
        return {
          productId,
          retailProductId: row.retailProductId,
          retailerId: row.retailerId,
          retailerName: row.retailerName,
          retailerCode: row.retailerCode,
          packageWeight,
          packageUnit: row.packageUnit,
          packagePriceRub: incomplete ? null : packagePriceRub,
          currency: row.currency,
          collectedAt,
          availability: row.availability,
          confidence: row.confidence != null ? Number(row.confidence) : null,
          stale,
          provenance: incomplete ? 'PRICE_INCOMPLETE' : 'RETAIL_PRODUCT_PRICE',
          coverage: incomplete ? 'PARTIAL' : stale ? 'PARTIAL' : 'FULL',
          dataClass: (row.dataClass as 'PRODUCTION' | 'TEST_ONLY' | 'FIXTURE' | 'HISTORICAL_TEST') ?? 'PRODUCTION',
        };
      }
    }

    // Legacy fallback: PriceObservation by productId without retailProductId (or pre-migration).
    const allowTestLegacy = allowTestPriceEvidence({
      allowTestPrices: (options as { allowTestPrices?: boolean } | undefined)?.allowTestPrices,
    });
    const hasDataClassLegacy = await this.q(options?.query)<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'PriceObservation'
           AND column_name = 'dataClass'
       ) AS ok`,
    );
    const legacyFilter = allowTestLegacy
      ? ''
      : hasDataClassLegacy.rows[0]?.ok
        ? ` AND COALESCE(po."dataClass", 'PRODUCTION') = 'PRODUCTION' `
        : ` AND lower(COALESCE(po.source, '')) NOT IN ('step092_fixture', 'fixture')
            AND lower(COALESCE(po."sourceName", '')) NOT LIKE '%fixture%'
            AND lower(COALESCE(po."sourceName", '')) NOT LIKE '%step092%' `;

    const legacy = await this.q(options?.query)<{
      retailerId: string | null;
      retailerName: string | null;
      retailerCode: string | null;
      packageSize: string | null;
      packageUnit: string | null;
      price: string;
      currency: string;
      collectedAt: string | null;
      retailProductId: string | null;
      dataClass: string | null;
      source: string | null;
      sourceName: string | null;
    }>(
      `SELECT po."retailerId"::text AS "retailerId",
              r.name AS "retailerName", r.code AS "retailerCode",
              p."packageSize"::text AS "packageSize", p."packageUnit",
              po.price::text AS price, po.currency,
              COALESCE(po."collectedAt", po."observedAt")::text AS "collectedAt",
              ${hasRetailCol.rows[0]?.ok ? 'po."retailProductId"::text' : 'NULL::text'} AS "retailProductId",
              ${hasDataClassLegacy.rows[0]?.ok ? `COALESCE(po."dataClass", 'PRODUCTION')` : `'PRODUCTION'`} AS "dataClass",
              po.source AS source,
              po."sourceName" AS "sourceName"
       FROM "PriceObservation" po
       JOIN "Product" p ON p.id = po."productId"
       LEFT JOIN "Retailer" r ON r.id = po."retailerId"
       WHERE po."productId" = $1
         AND ($2::uuid IS NULL OR po."retailerId" = $2)
         ${hasRetailCol.rows[0]?.ok ? 'AND po."retailProductId" IS NULL' : ''}
         ${legacyFilter}
       ORDER BY COALESCE(po."collectedAt", po."observedAt") DESC
       LIMIT 1`,
      [productId, options?.retailerId ?? null],
    );

    const leg = legacy.rows[0];
    if (!leg) return missing;

    const packageWeight = leg.packageSize != null ? Number(leg.packageSize) : null;
    const packagePriceRub = Number(leg.price);
    const incomplete = !(packageWeight && packageWeight > 0) || !(packagePriceRub >= 0);
    const collectedAt = leg.collectedAt;
    const stale = collectedAt ? Date.now() - Date.parse(collectedAt) > STALE_MS : false;

    return {
      productId,
      retailProductId: leg.retailProductId,
      retailerId: leg.retailerId,
      retailerName: leg.retailerName,
      retailerCode: leg.retailerCode,
      packageWeight,
      packageUnit: leg.packageUnit,
      packagePriceRub: incomplete ? null : packagePriceRub,
      currency: leg.currency,
      collectedAt,
      availability: null,
      confidence: null,
      stale,
      provenance: incomplete ? 'PRICE_INCOMPLETE' : 'LEGACY_PRODUCT_PRICE',
      coverage: 'LEGACY',
      dataClass:
        (leg.dataClass as 'PRODUCTION' | 'TEST_ONLY' | 'FIXTURE' | 'HISTORICAL_TEST') ??
        classifyPriceObservationHeuristics({
          source: leg.source,
          sourceName: leg.sourceName,
          retailerCode: leg.retailerCode,
        }),
    };
  }
}

export type { CookingMethodCode };
