import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type {
  CreateProductInput,
  ProductListFilters,
  ProductListItem,
  ProductReviewQueueCode,
  ProductStatus,
} from '../domain/product-admin.types';

@Injectable()
export class ProductAdminRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  q(query?: SqlQuery): SqlQuery {
    return query ?? (this.db.query.bind(this.db) as SqlQuery);
  }

  async withTransaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    return this.db.withTransaction(fn);
  }

  async listProducts(filters: ProductListFilters): Promise<{ items: ProductListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const sortCol =
      filters.sort === 'canonicalName'
        ? 'p."canonicalName"'
        : filters.sort === 'productKey'
          ? 'p."productKey"'
          : 'p."updatedAt"';
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';

    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filters.status) {
      clauses.push(`p.status = $${params.length + 1}`);
      params.push(filters.status);
    } else {
      clauses.push(`p.status <> 'MERGED'`);
    }
    if (filters.q?.trim()) {
      clauses.push(
        `(p."canonicalName" ILIKE $${params.length + 1} OR p."productKey" ILIKE $${params.length + 1} OR EXISTS (
           SELECT 1 FROM "ProductAlias" a WHERE a."productId" = p.id AND (a.alias ILIKE $${params.length + 1} OR a."normalizedAlias" ILIKE $${params.length + 1})
         ))`,
      );
      params.push(`%${filters.q.trim()}%`);
    }
    if (filters.categoryId) {
      clauses.push(`p."categoryId" = $${params.length + 1}`);
      params.push(filters.categoryId);
    }
    if (filters.form) {
      clauses.push(`p.form = $${params.length + 1}`);
      params.push(filters.form);
    }
    if (filters.reviewStatus) {
      clauses.push(`p."reviewStatus" = $${params.length + 1}`);
      params.push(filters.reviewStatus);
    }
    if (filters.unclassified) {
      clauses.push(`(pc.code = 'UNCLASSIFIED' OR p."categoryId" IS NULL)`);
    }
    if (filters.nutrition === 'VERSIONED') {
      clauses.push(`p."currentNutritionVersionId" IS NOT NULL`);
    } else if (filters.nutrition === 'MISSING') {
      clauses.push(`p."currentNutritionVersionId" IS NULL AND (p."caloriesPer100g" IS NULL OR p."caloriesPer100g" = 0)`);
    } else if (filters.nutrition === 'UNVERSIONED_LEGACY') {
      clauses.push(`p."currentNutritionVersionId" IS NULL AND p."caloriesPer100g" IS NOT NULL AND p."caloriesPer100g" > 0`);
    }
    if (filters.roleMissing) {
      clauses.push(`NOT EXISTS (SELECT 1 FROM "ProductCulinaryRole" r WHERE r."productId" = p.id)`);
    }
    if (filters.retailMissing) {
      clauses.push(`NOT EXISTS (SELECT 1 FROM "RetailProduct" rp WHERE rp."canonicalProductId" = p.id AND rp.status <> 'MERGED')`);
    }
    if (filters.legacyPriceOnly) {
      clauses.push(`EXISTS (
        SELECT 1 FROM "PriceObservation" po WHERE po."productId" = p.id AND po."retailProductId" IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM "PriceObservation" po2 WHERE po2."productId" = p.id AND po2."retailProductId" IS NOT NULL
      )`);
    }
    if (filters.allergenReview) {
      clauses.push(`EXISTS (
        SELECT 1 FROM "ProductAllergen" pa WHERE pa."productId" = p.id AND pa.source IN ('HEURISTIC','LEGACY_BACKFILL')
      )`);
    }
    if (filters.dietaryReview) {
      clauses.push(`EXISTS (
        SELECT 1 FROM "ProductDietaryTag" pdt WHERE pdt."productId" = p.id AND pdt.source IN ('HEURISTIC','LEGACY_BACKFILL')
      )`);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = await this.db.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM "Product" p
       LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
       ${whereSql}`,
      params,
    );
    const total = Number(count.rows[0]?.c ?? 0);

    const result = await this.db.query<{
      id: string;
      canonicalName: string;
      productKey: string | null;
      categoryCode: string | null;
      categoryName: string | null;
      form: string | null;
      currentNutritionVersionId: string | null;
      caloriesPer100g: string | null;
      aliasesCount: string;
      allergenStatus: string;
      dietaryTags: string | null;
      culinaryRoles: string | null;
      retailProductCount: string;
      retailPriceCount: string;
      legacyPriceCount: string;
      reviewStatus: string;
      status: string;
      seedDatasetVersion: string | null;
      updatedAt: string;
    }>(
      `SELECT p.id, p."canonicalName", p."productKey", pc.code AS "categoryCode", pc.name AS "categoryName",
              p.form, p."seedDatasetVersion", p."currentNutritionVersionId", p."caloriesPer100g"::text,
              (SELECT count(*)::text FROM "ProductAlias" a WHERE a."productId" = p.id AND a.status = 'ACTIVE') AS "aliasesCount",
              CASE
                WHEN EXISTS (SELECT 1 FROM "ProductAllergen" pa WHERE pa."productId" = p.id AND pa.source = 'OWNER_REVIEWED') THEN 'CONFIRMED'
                WHEN EXISTS (SELECT 1 FROM "ProductAllergen" pa WHERE pa."productId" = p.id) THEN 'PARTIAL'
                ELSE 'UNKNOWN'
              END AS "allergenStatus",
              (SELECT string_agg(dt.code, ',' ORDER BY dt.code) FROM "ProductDietaryTag" pdt
                JOIN "DietaryTag" dt ON dt.id = pdt."dietaryTagId" WHERE pdt."productId" = p.id) AS "dietaryTags",
              (SELECT string_agg(cr.code || CASE WHEN pcr."isPrimary" THEN '*' ELSE '' END, ',' ORDER BY pcr."isPrimary" DESC, cr.code)
                FROM "ProductCulinaryRole" pcr JOIN "CulinaryRole" cr ON cr.id = pcr."culinaryRoleId"
                WHERE pcr."productId" = p.id) AS "culinaryRoles",
              (SELECT count(*)::text FROM "RetailProduct" rp WHERE rp."canonicalProductId" = p.id AND rp.status <> 'MERGED') AS "retailProductCount",
              (SELECT count(*)::text FROM "PriceObservation" po WHERE po."productId" = p.id AND po."retailProductId" IS NOT NULL) AS "retailPriceCount",
              (SELECT count(*)::text FROM "PriceObservation" po WHERE po."productId" = p.id AND po."retailProductId" IS NULL) AS "legacyPriceCount",
              p."reviewStatus", p.status, p."seedDatasetVersion", p."updatedAt"::text
       FROM "Product" p
       LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
       ${whereSql}
       ORDER BY ${sortCol} ${order}, p.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    const items: ProductListItem[] = result.rows.map((row) => {
      const retail = Number(row.retailPriceCount);
      const legacy = Number(row.legacyPriceCount);
      let priceCoverage: ProductListItem['priceCoverage'] = 'MISSING';
      if (retail > 0 && legacy > 0) priceCoverage = 'MIXED';
      else if (retail > 0) priceCoverage = 'RETAIL';
      else if (legacy > 0) priceCoverage = 'LEGACY';

      let nutritionStatus: ProductListItem['nutritionStatus'] = 'MISSING';
      if (row.currentNutritionVersionId) nutritionStatus = 'VERSIONED';
      else if (row.caloriesPer100g != null && Number(row.caloriesPer100g) > 0) nutritionStatus = 'UNVERSIONED_LEGACY';

      return {
        id: row.id,
        canonicalName: row.canonicalName,
        productKey: row.productKey,
        categoryCode: row.categoryCode,
        categoryName: row.categoryName,
        form: row.form,
        seedDatasetVersion: row.seedDatasetVersion,
        nutritionStatus,
        aliasesCount: Number(row.aliasesCount),
        allergenStatus: row.allergenStatus,
        dietaryTags: row.dietaryTags ? row.dietaryTags.split(',') : [],
        culinaryRoles: row.culinaryRoles ? row.culinaryRoles.split(',') : [],
        retailProductCount: Number(row.retailProductCount),
        priceCoverage,
        reviewStatus: row.reviewStatus as ProductListItem['reviewStatus'],
        status: row.status as ProductStatus,
        updatedAt: row.updatedAt,
      };
    });

    return { items, total, page, pageSize };
  }

  async getProductRow(id: string, query?: SqlQuery) {
    const result = await this.q(query)<Record<string, unknown>>(
      `SELECT p.*, pc.code AS "categoryCode", pc.name AS "categoryName",
              nv.version AS "currentNutritionVersion",
              nv.calories::text AS "nvCalories", nv.protein::text AS "nvProtein",
              nv.fat::text AS "nvFat", nv.carbohydrate::text AS "nvCarbohydrate"
       FROM "Product" p
       LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
       LEFT JOIN "ProductNutritionVersion" nv ON nv.id = p."currentNutritionVersionId"
       WHERE p.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async createProduct(input: CreateProductInput, actorUserId: string, query?: SqlQuery) {
    const cat = await this.q(query)<{ id: string; code: string }>(
      `SELECT id, code FROM "ProductCategory" WHERE id = $1 AND status = 'ACTIVE'`,
      [input.categoryId],
    );
    if (!cat.rows[0]) throw new Error('PRODUCT_CATEGORY_NOT_FOUND');

    const calories = input.caloriesPer100g ?? 0;
    const protein = input.proteinPer100g ?? 0;
    const reviewStatus = cat.rows[0].code === 'UNCLASSIFIED' ? 'NEEDS_REVIEW' : 'NONE';
    const inserted = await this.q(query)<{ id: string }>(
      `INSERT INTO "Product" (
         "canonicalName", "productKey", "categoryId", form, "defaultUnit", unit,
         "fatPercent", "ediblePartPercent", density, "averagePieceWeightGrams", "yieldCoefficient",
         "caloriesPer100g", "proteinPer100g", "fatPer100g", "carbsPer100g",
         status, "reviewStatus", "updatedAt"
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE',$16, now()
       )
       RETURNING id`,
      [
        input.canonicalName,
        input.productKey,
        input.categoryId,
        input.form,
        input.defaultUnit,
        input.unit ?? input.defaultUnit,
        input.fatPercent ?? null,
        input.ediblePartPercent ?? null,
        input.density ?? null,
        input.averagePieceWeightGrams ?? null,
        input.yieldCoefficient ?? null,
        calories,
        protein,
        input.fatPer100g ?? 0,
        input.carbsPer100g ?? 0,
        reviewStatus,
      ],
    );
    void actorUserId;
    return inserted.rows[0]!.id;
  }

  async updateProduct(
    id: string,
    patch: Record<string, unknown>,
    expectedRowVersion: number,
    query?: SqlQuery,
  ): Promise<boolean> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      canonicalName: '"canonicalName"',
      categoryId: '"categoryId"',
      form: 'form',
      defaultUnit: '"defaultUnit"',
      fatPercent: '"fatPercent"',
      ediblePartPercent: '"ediblePartPercent"',
      density: 'density',
      averagePieceWeightGrams: '"averagePieceWeightGrams"',
      yieldCoefficient: '"yieldCoefficient"',
      status: 'status',
      reviewStatus: '"reviewStatus"',
      reviewNote: '"reviewNote"',
    };
    for (const [key, col] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        vals.push(patch[key]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (!sets.length) throw new Error('PRODUCT_UPDATE_EMPTY');
    sets.push(`"updatedAt" = now()`);
    sets.push(`"rowVersion" = "rowVersion" + 1`);
    vals.push(id, expectedRowVersion);
    const result = await this.q(query)<{ id: string }>(
      `UPDATE "Product" SET ${sets.join(', ')}
       WHERE id = $${vals.length - 1} AND "rowVersion" = $${vals.length}
       RETURNING id`,
      vals,
    );
    return Boolean(result.rows[0]);
  }

  async findSimilarProducts(canonicalName: string, productKey: string, excludeId?: string) {
    const normalized = canonicalName.trim().toLowerCase();
    const result = await this.db.query<{ id: string; canonicalName: string; productKey: string | null; score: string }>(
      `SELECT p.id, p."canonicalName", p."productKey",
              (CASE WHEN lower(p."canonicalName") = $1 THEN 100
                    WHEN lower(p."canonicalName") LIKE $2 THEN 70
                    WHEN p."productKey" = $3 THEN 90
                    WHEN p."productKey" LIKE $4 THEN 50
                    ELSE 20 END)::text AS score
       FROM "Product" p
       WHERE p.status <> 'MERGED'
         AND ($5::uuid IS NULL OR p.id <> $5)
         AND (
           lower(p."canonicalName") = $1
           OR lower(p."canonicalName") LIKE $2
           OR p."productKey" = $3
           OR p."productKey" LIKE $4
           OR EXISTS (
             SELECT 1 FROM "ProductAlias" a
             WHERE a."productId" = p.id AND a."normalizedAlias" = $1 AND a.status = 'ACTIVE'
           )
         )
       ORDER BY score DESC, p."canonicalName"
       LIMIT 10`,
      [normalized, `%${normalized}%`, productKey, `${productKey}%`, excludeId ?? null],
    );
    return result.rows.map((r) => ({
      id: r.id,
      canonicalName: r.canonicalName,
      productKey: r.productKey,
      score: Number(r.score),
    }));
  }

  async lockProduct(id: string, query: SqlQuery) {
    const result = await query<{ id: string; status: string; canonicalProductId: string | null; rowVersion: number }>(
      `SELECT id, status, "canonicalProductId", "rowVersion" FROM "Product" WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async countRecipeIngredients(productId: string, query?: SqlQuery) {
    const result = await this.q(query)<{ c: string }>(
      `SELECT count(*)::text AS c FROM "RecipeIngredient" WHERE "productId" = $1`,
      [productId],
    );
    return Number(result.rows[0]?.c ?? 0);
  }

  async appendAudit(input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.query(
      `INSERT INTO "AuditEvent" ("actorUserId", action, "entityType", "entityId", "requestId", metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        input.actorUserId,
        input.action,
        input.entityType,
        input.entityId,
        input.requestId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async listReviewQueue(queue?: ProductReviewQueueCode, limit = 50) {
    const lim = Math.min(200, Math.max(1, limit));
    const items: Array<{
      queueCode: ProductReviewQueueCode;
      productId: string;
      canonicalName: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
      source: string;
      detectedAt: string;
    }> = [];

    const push = async (
      queueCode: ProductReviewQueueCode,
      sql: string,
      severity: 'LOW' | 'MEDIUM' | 'HIGH',
      source: string,
    ) => {
      if (queue && queue !== queueCode) return;
      const result = await this.db.query<{ productId: string; canonicalName: string; detectedAt: string }>(sql, [lim]);
      for (const row of result.rows) {
        items.push({
          queueCode,
          productId: row.productId,
          canonicalName: row.canonicalName,
          severity,
          source,
          detectedAt: row.detectedAt,
        });
      }
    };

    await push(
      'UNCLASSIFIED',
      `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "Product" p
       LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
       WHERE p.status = 'ACTIVE' AND (p."categoryId" IS NULL OR pc.code = 'UNCLASSIFIED')
       ORDER BY p."updatedAt" DESC LIMIT $1`,
      'HIGH',
      'CATEGORY',
    );
    await push(
      'MISSING_NUTRITION',
      `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "Product" p
       WHERE p.status = 'ACTIVE' AND p."currentNutritionVersionId" IS NULL
         AND (p."caloriesPer100g" IS NULL OR p."caloriesPer100g" = 0)
       ORDER BY p."updatedAt" DESC LIMIT $1`,
      'HIGH',
      'NUTRITION',
    );
    await push(
      'UNVERSIONED_LEGACY',
      `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "Product" p
       WHERE p.status = 'ACTIVE' AND p."currentNutritionVersionId" IS NULL
         AND p."caloriesPer100g" IS NOT NULL AND p."caloriesPer100g" > 0
       ORDER BY p."updatedAt" DESC LIMIT $1`,
      'MEDIUM',
      'NUTRITION',
    );
    await push(
      'AMBIGUOUS_ALIAS',
      `SELECT DISTINCT ON (p.id) p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "ProductAlias" a
       JOIN "Product" p ON p.id = a."productId"
       WHERE a.status IN ('ACTIVE','NEEDS_REVIEW') AND a."normalizedAlias" IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "ProductAlias" b
           WHERE b."normalizedAlias" = a."normalizedAlias"
             AND b."productId" <> a."productId"
             AND b.status = 'ACTIVE'
         )
       ORDER BY p.id, p."updatedAt" DESC
       LIMIT $1`,
      'HIGH',
      'ALIAS',
    );
    await push(
      'HEURISTIC_ALLERGEN',
      `SELECT DISTINCT ON (p.id) p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "ProductAllergen" pa JOIN "Product" p ON p.id = pa."productId"
       WHERE pa.source IN ('HEURISTIC','LEGACY_BACKFILL') AND p.status = 'ACTIVE'
       ORDER BY p.id, p."updatedAt" DESC
       LIMIT $1`,
      'MEDIUM',
      'ALLERGEN',
    );
    await push(
      'HEURISTIC_DIETARY_TAG',
      `SELECT DISTINCT ON (p.id) p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "ProductDietaryTag" pdt JOIN "Product" p ON p.id = pdt."productId"
       WHERE pdt.source IN ('HEURISTIC','LEGACY_BACKFILL') AND p.status = 'ACTIVE'
       ORDER BY p.id, p."updatedAt" DESC
       LIMIT $1`,
      'MEDIUM',
      'DIETARY',
    );
    await push(
      'MISSING_CULINARY_ROLE',
      `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "Product" p
       WHERE p.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM "ProductCulinaryRole" r WHERE r."productId" = p.id)
       ORDER BY p."updatedAt" DESC LIMIT $1`,
      'MEDIUM',
      'ROLE',
    );
    await push(
      'SUBSTITUTION_NEEDS_REVIEW',
      `SELECT DISTINCT ON (p.id) p.id AS "productId", p."canonicalName", ps."updatedAt"::text AS "detectedAt"
       FROM "ProductSubstitution" ps JOIN "Product" p ON p.id = ps."sourceProductId"
       WHERE ps.status = 'NEEDS_REVIEW'
       ORDER BY p.id, ps."updatedAt" DESC
       LIMIT $1`,
      'MEDIUM',
      'SUBSTITUTION',
    );
    await push(
      'RETAIL_NEEDS_PRODUCT_MAPPING',
      `SELECT COALESCE(rp."canonicalProductId", '00000000-0000-4000-8000-000000000000'::uuid) AS "productId",
              COALESCE(p."canonicalName", rp.title) AS "canonicalName",
              rp."updatedAt"::text AS "detectedAt"
       FROM "RetailProduct" rp
       LEFT JOIN "Product" p ON p.id = rp."canonicalProductId"
       WHERE rp."mappingStatus" = 'NEEDS_PRODUCT_MAPPING' AND rp.status = 'ACTIVE'
       ORDER BY rp."updatedAt" DESC LIMIT $1`,
      'HIGH',
      'RETAIL',
    );
    await push(
      'LEGACY_PRICE_ONLY',
      `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "Product" p
       WHERE p.status = 'ACTIVE'
         AND EXISTS (SELECT 1 FROM "PriceObservation" po WHERE po."productId" = p.id AND po."retailProductId" IS NULL)
         AND NOT EXISTS (SELECT 1 FROM "PriceObservation" po2 WHERE po2."productId" = p.id AND po2."retailProductId" IS NOT NULL)
       ORDER BY p."updatedAt" DESC LIMIT $1`,
      'LOW',
      'PRICE',
    );
    await push(
      'INVALID_COEFFICIENT',
      `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt"
       FROM "Product" p
       WHERE p.status = 'ACTIVE' AND (
         (p."ediblePartPercent" IS NOT NULL AND (p."ediblePartPercent" <= 0 OR p."ediblePartPercent" > 100))
         OR (p.density IS NOT NULL AND p.density <= 0)
         OR (p."yieldCoefficient" IS NOT NULL AND p."yieldCoefficient" <= 0)
       )
       ORDER BY p."updatedAt" DESC LIMIT $1`,
      'HIGH',
      'COEFFICIENT',
    );

    return items.slice(0, lim);
  }
}
