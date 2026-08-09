import { Inject, Injectable, Optional } from '@nestjs/common';
import { hasAdminAuthority } from '../../auth/domain/account-role.policy';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import { normalizeProductAlias, validateNutritionValues } from '../../product-catalog/domain/product-foundation.policy';
import {
  assertNutritionImpact,
  assertTextureImpact,
  validateSubstitutionEdge,
} from '../../product-catalog/domain/product-roles-retail.policy';
import { RecipeDependencyImpactService } from '../../recipe-platform/application/recipe-dependency-impact.service';
import {
  assertQueueCode,
  assertRateLimit,
  assertSafeStatusTransition,
  assertProductStatus,
  sanitizeAliasInput,
  sanitizeCreateProduct,
  sanitizeUpdateProduct,
} from '../domain/product-admin.policy';
import type {
  AliasCreateInput,
  CreateProductInput,
  CulinaryRoleAssignment,
  MergePreview,
  MergeResult,
  NutritionVersionInput,
  ProductListFilters,
  ProductReviewQueueCode,
  SubstitutionCreateInput,
  UpdateProductInput,
} from '../domain/product-admin.types';
import { ProductAdminRepository } from '../infrastructure/product-admin.repository';

@Injectable()
export class ProductAdminService {
  constructor(
    @Inject(ProductAdminRepository) private readonly repo: ProductAdminRepository,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(RecipeDependencyImpactService) private readonly recipeImpact?: RecipeDependencyImpactService,
  ) {}

  private assertStaff(user: RequestUser) {
    const role = String(user.role ?? '').toUpperCase();
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  private assertOwner(user: RequestUser) {
    if (String(user.role ?? '').toUpperCase() !== 'OWNER') throw new Error('OWNER_ROLE_REQUIRED');
  }

  async list(user: RequestUser, filters: ProductListFilters) {
    this.assertStaff(user);
    return this.repo.listProducts(filters);
  }

  async detail(user: RequestUser, id: string) {
    this.assertStaff(user);
    const product = await this.repo.getProductRow(id);
    if (!product) throw new Error('PRODUCT_NOT_FOUND');

    const q = this.repo.q();
    const [
      aliases,
      nutritionVersions,
      allergens,
      dietaryTags,
      roles,
      substitutions,
      retail,
      prices,
      recipeCount,
      auditRows,
    ] = await Promise.all([
      q<{ id: string; alias: string; normalizedAlias: string | null; source: string; status: string; confidence: string }>(
        `SELECT id, alias, "normalizedAlias", source, status, confidence::text FROM "ProductAlias" WHERE "productId" = $1 ORDER BY "createdAt" DESC`,
        [id],
      ),
      q<{
        id: string;
        version: number;
        calories: string;
        protein: string;
        fat: string;
        carbohydrate: string;
        fiber: string | null;
        sodium: string | null;
        source: string;
        validFrom: string;
        createdAt: string;
      }>(
        `SELECT id, version, calories::text, protein::text, fat::text, carbohydrate::text,
                fiber::text, sodium::text, source, "validFrom"::text, "createdAt"::text
         FROM "ProductNutritionVersion" WHERE "productId" = $1 ORDER BY version DESC`,
        [id],
      ),
      q<{ id: string; code: string; name: string; presence: string; source: string }>(
        `SELECT pa.id, a.code, a.name, pa.presence, pa.source
         FROM "ProductAllergen" pa JOIN "Allergen" a ON a.id = pa."allergenId"
         WHERE pa."productId" = $1 ORDER BY a.code`,
        [id],
      ),
      q<{ id: string; code: string; name: string; source: string }>(
        `SELECT pdt.id, dt.code, dt.name, pdt.source
         FROM "ProductDietaryTag" pdt JOIN "DietaryTag" dt ON dt.id = pdt."dietaryTagId"
         WHERE pdt."productId" = $1 ORDER BY dt.code`,
        [id],
      ),
      q<{ culinaryRoleId: string; code: string; isPrimary: boolean; source: string; confidence: string }>(
        `SELECT pcr."culinaryRoleId", cr.code, pcr."isPrimary", pcr.source, pcr.confidence::text
         FROM "ProductCulinaryRole" pcr JOIN "CulinaryRole" cr ON cr.id = pcr."culinaryRoleId"
         WHERE pcr."productId" = $1 ORDER BY pcr."isPrimary" DESC, cr.code`,
        [id],
      ),
      q<Record<string, unknown>>(
        `SELECT ps.*, cr.code AS "culinaryRoleCode",
                sp."canonicalName" AS "sourceName", rp."canonicalName" AS "replacementName"
         FROM "ProductSubstitution" ps
         LEFT JOIN "CulinaryRole" cr ON cr.id = ps."culinaryRoleId"
         JOIN "Product" sp ON sp.id = ps."sourceProductId"
         JOIN "Product" rp ON rp.id = ps."replacementProductId"
         WHERE ps."sourceProductId" = $1 OR ps."replacementProductId" = $1
         ORDER BY ps."updatedAt" DESC`,
        [id],
      ),
      q<Record<string, unknown>>(
        `SELECT rp.*, r.name AS "retailerName", r.code AS "retailerCode"
         FROM "RetailProduct" rp
         JOIN "Retailer" r ON r.id = rp."retailerId"
         WHERE rp."canonicalProductId" = $1
         ORDER BY rp."updatedAt" DESC`,
        [id],
      ),
      q<Record<string, unknown>>(
        `SELECT po.id, po.price::text, po.currency, po."collectedAt"::text, po."observedAt"::text,
                po."retailProductId"::text, po.availability, po.confidence::text,
                r.name AS "retailerName",
                CASE WHEN po."retailProductId" IS NULL THEN 'LEGACY_PRODUCT_PRICE' ELSE 'RETAIL_PRODUCT_PRICE' END AS provenance
         FROM "PriceObservation" po
         LEFT JOIN "Retailer" r ON r.id = po."retailerId"
         WHERE po."productId" = $1
         ORDER BY COALESCE(po."collectedAt", po."observedAt") DESC
         LIMIT 50`,
        [id],
      ),
      this.repo.countRecipeIngredients(id),
      q<{ id: string; action: string; createdAt: string; metadata: unknown }>(
        `SELECT id, action, "createdAt"::text, metadata FROM "AuditEvent"
         WHERE "entityType" = 'Product' AND "entityId" = $1
         ORDER BY "createdAt" DESC LIMIT 40`,
        [id],
      ),
    ]);

    const warnings: string[] = [];
    if (!product.categoryId || product.categoryCode === 'UNCLASSIFIED') warnings.push('UNCLASSIFIED');
    if (!product.currentNutritionVersionId) warnings.push('NUTRITION_UNVERSIONED_OR_MISSING');
    if (!roles.rows.length) warnings.push('MISSING_CULINARY_ROLE');
    const vegan = dietaryTags.rows.some((t) => t.code === 'vegan');
    const milk = allergens.rows.some((a) => a.code === 'milk' && a.presence === 'CONTAINS');
    if (vegan && milk) warnings.push('CONFLICT_VEGAN_MILK');

    return {
      overview: {
        id: product.id,
        canonicalName: product.canonicalName,
        productKey: product.productKey,
        status: product.status,
        categoryId: product.categoryId,
        categoryCode: product.categoryCode,
        categoryName: product.categoryName,
        form: product.form,
        defaultUnit: product.defaultUnit,
        unit: product.unit,
        fatPercent: product.fatPercent != null ? Number(product.fatPercent) : null,
        ediblePartPercent: product.ediblePartPercent != null ? Number(product.ediblePartPercent) : null,
        density: product.density != null ? Number(product.density) : null,
        averagePieceWeightGrams:
          product.averagePieceWeightGrams != null ? Number(product.averagePieceWeightGrams) : null,
        yieldCoefficient: product.yieldCoefficient != null ? Number(product.yieldCoefficient) : null,
        currentNutritionVersionId: product.currentNutritionVersionId,
        currentNutritionVersion: product.currentNutritionVersion ?? null,
        reviewStatus: product.reviewStatus,
        reviewNote: product.reviewNote,
        rowVersion: product.rowVersion,
        seedDatasetVersion: product.seedDatasetVersion ?? null,
        seedProvenance: product.seedProvenance ?? null,
        canonicalProductId: product.canonicalProductId,
        mergedAt: product.mergedAt,
        recipeDependencyCount: recipeCount,
        planDependencyCount: null,
        reviewWarnings: warnings,
        legacyFieldsActive: {
          packageSize: product.packageSize != null,
          packageUnit: product.packageUnit != null,
          legacyMacrosOnProduct: product.currentNutritionVersionId == null,
        },
        updatedAt: product.updatedAt,
        createdAt: product.createdAt,
      },
      aliases: aliases.rows,
      nutritionVersions: nutritionVersions.rows.map((v) => ({
        ...v,
        calories: Number(v.calories),
        protein: Number(v.protein),
        fat: Number(v.fat),
        carbohydrate: Number(v.carbohydrate),
        fiber: v.fiber != null ? Number(v.fiber) : null,
        sodium: v.sodium != null ? Number(v.sodium) : null,
        immutable: true,
      })),
      allergens: allergens.rows,
      dietaryTags: dietaryTags.rows,
      culinaryRoles: roles.rows,
      substitutions: substitutions.rows,
      retailProducts: retail.rows,
      prices: prices.rows,
      auditHistory: auditRows.rows,
      futureRecipeRevalidationRequired: recipeCount > 0,
    };
  }

  async create(user: RequestUser, raw: CreateProductInput, requestId?: string) {
    this.assertStaff(user);
    assertRateLimit(`product-create:${user.id}`, 30);
    const input = sanitizeCreateProduct(raw);
    const similar = await this.repo.findSimilarProducts(input.canonicalName, input.productKey);
    if (similar.length && !input.confirmPossibleDuplicate) {
      throw Object.assign(new Error('PRODUCT_POSSIBLE_DUPLICATE'), { similar });
    }
    const id = await this.repo.createProduct(input, user.id);
    await this.auditWrite(user.id, 'product.create', id, requestId, { productKey: input.productKey });
    return { id, similar };
  }

  async update(user: RequestUser, id: string, raw: UpdateProductInput, requestId?: string) {
    this.assertStaff(user);
    const before = await this.repo.getProductRow(id);
    if (!before) throw new Error('PRODUCT_NOT_FOUND');
    if (String(before.status) === 'MERGED') throw new Error('PRODUCT_MERGED_IMMUTABLE');
    const input = sanitizeUpdateProduct(raw);
    if (input.status) {
      assertSafeStatusTransition(assertProductStatus(String(before.status)), assertProductStatus(input.status));
    }
    const ok = await this.repo.updateProduct(
      id,
      Object.fromEntries(
        Object.entries({
          canonicalName: input.canonicalName,
          categoryId: input.categoryId,
          form: input.form,
          defaultUnit: input.defaultUnit,
          fatPercent: input.fatPercent,
          ediblePartPercent: input.ediblePartPercent,
          density: input.density,
          averagePieceWeightGrams: input.averagePieceWeightGrams,
          yieldCoefficient: input.yieldCoefficient,
          status: input.status,
          reviewStatus: input.reviewStatus,
          reviewNote: input.reviewNote,
        }).filter(([, value]) => value !== undefined),
      ),
      input.rowVersion,
    );
    if (!ok) throw new Error('PRODUCT_VERSION_CONFLICT');
    await this.auditWrite(user.id, 'product.update', id, requestId, {
      before: { canonicalName: before.canonicalName, categoryId: before.categoryId, form: before.form },
      after: input,
    });
    if (input.form != null && String(input.form) !== String(before.form)) {
      await this.recipeImpact?.onProductEvent({
        productId: id,
        reasonCode: 'PRODUCT_FORM_CHANGED',
        sourceEntityType: 'Product',
        sourceEntityId: id,
        actorUserId: user.id,
      });
    }
    if (input.defaultUnit != null && String(input.defaultUnit) !== String(before.defaultUnit)) {
      await this.recipeImpact?.onProductEvent({
        productId: id,
        reasonCode: 'PRODUCT_DEFAULT_UNIT_CHANGED',
        sourceEntityType: 'Product',
        sourceEntityId: id,
        actorUserId: user.id,
      });
    }
    if (
      (input.density != null && Number(input.density) !== Number(before.density)) ||
      (input.yieldCoefficient != null && Number(input.yieldCoefficient) !== Number(before.yieldCoefficient)) ||
      (input.ediblePartPercent != null &&
        Number(input.ediblePartPercent) !== Number(before.ediblePartPercent)) ||
      (input.averagePieceWeightGrams != null &&
        Number(input.averagePieceWeightGrams) !== Number(before.averagePieceWeightGrams))
    ) {
      await this.recipeImpact?.onProductEvent({
        productId: id,
        reasonCode: 'PRODUCT_COEFFICIENT_CHANGED',
        sourceEntityType: 'Product',
        sourceEntityId: id,
        actorUserId: user.id,
      });
    }
    if (input.status === 'SUSPENDED') {
      await this.recipeImpact?.onProductEvent({
        productId: id,
        reasonCode: 'PRODUCT_SUSPENDED',
        sourceEntityType: 'Product',
        sourceEntityId: id,
        actorUserId: user.id,
      });
    }
    return this.detail(user, id);
  }

  async addAlias(user: RequestUser, productId: string, raw: AliasCreateInput, requestId?: string) {
    this.assertStaff(user);
    const { alias, normalizedAlias } = sanitizeAliasInput(raw.alias);
    const product = await this.repo.getProductRow(productId);
    if (!product || String(product.status) === 'MERGED') throw new Error('PRODUCT_NOT_FOUND');

    const conflicts = await this.repo.q()<{ productId: string; canonicalName: string }>(
      `SELECT a."productId", p."canonicalName" FROM "ProductAlias" a
       JOIN "Product" p ON p.id = a."productId"
       WHERE a.status = 'ACTIVE' AND a."normalizedAlias" = $1 AND a."productId" <> $2`,
      [normalizedAlias, productId],
    );
    if (conflicts.rows.length && !raw.forceDespiteAmbiguity) {
      return {
        status: 'AMBIGUOUS',
        normalizedAlias,
        conflicts: conflicts.rows,
        created: false,
      };
    }

    const status = conflicts.rows.length ? 'NEEDS_REVIEW' : 'ACTIVE';
    const inserted = await this.repo.q()<{ id: string }>(
      `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
       VALUES ($1,$2,$3,$4,1.0,$5)
       RETURNING id`,
      [productId, alias, normalizedAlias, raw.source ?? 'MANUAL', status],
    );
    await this.repo.q()(
      `UPDATE "Product" SET "reviewStatus" = CASE WHEN $2 = 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW' ELSE "reviewStatus" END,
              "updatedAt" = now(), "rowVersion" = "rowVersion" + 1
       WHERE id = $1`,
      [productId, status],
    );
    await this.auditWrite(user.id, 'product.alias.add', productId, requestId, {
      aliasId: inserted.rows[0]!.id,
      alias,
      normalizedAlias,
      status,
    });
    return {
      status: conflicts.rows.length ? 'AMBIGUOUS_SAVED_FOR_REVIEW' : 'CREATED',
      normalizedAlias,
      conflicts: conflicts.rows,
      created: true,
      aliasId: inserted.rows[0]!.id,
    };
  }

  async patchAlias(
    user: RequestUser,
    aliasId: string,
    body: { status?: string; source?: string },
    requestId?: string,
  ) {
    this.assertStaff(user);
    const status = body.status ? String(body.status).toUpperCase() : undefined;
    if (status && !['ACTIVE', 'REJECTED', 'NEEDS_REVIEW', 'ARCHIVED'].includes(status)) {
      throw new Error('PRODUCT_ALIAS_STATUS_INVALID');
    }
    const result = await this.repo.q()<{ id: string; productId: string }>(
      `UPDATE "ProductAlias"
       SET status = COALESCE($2, status),
           source = COALESCE($3, source),
           "updatedAt" = now()
       WHERE id = $1
       RETURNING id, "productId"`,
      [aliasId, status ?? null, body.source ?? null],
    );
    if (!result.rows[0]) throw new Error('PRODUCT_ALIAS_NOT_FOUND');
    await this.auditWrite(user.id, 'product.alias.update', result.rows[0].productId, requestId, {
      aliasId,
      status,
    });
    return result.rows[0];
  }

  async deleteAlias(user: RequestUser, aliasId: string, requestId?: string) {
    this.assertStaff(user);
    const existing = await this.repo.q()<{ id: string; productId: string }>(
      `SELECT id, "productId" FROM "ProductAlias" WHERE id = $1`,
      [aliasId],
    );
    if (!existing.rows[0]) throw new Error('PRODUCT_ALIAS_NOT_FOUND');
    await this.repo.q()(`DELETE FROM "ProductAlias" WHERE id = $1`, [aliasId]);
    await this.auditWrite(user.id, 'product.alias.delete', existing.rows[0].productId, requestId, {
      aliasId,
    });
    return { ok: true };
  }

  async createNutritionVersion(
    user: RequestUser,
    productId: string,
    raw: NutritionVersionInput,
    requestId?: string,
  ) {
    this.assertStaff(user);
    validateNutritionValues({
      calories: raw.calories,
      protein: raw.protein,
      fat: raw.fat,
      carbohydrate: raw.carbohydrate,
      fiber: raw.fiber,
      sodium: raw.sodium,
    });
    const product = await this.repo.getProductRow(productId);
    if (!product || String(product.status) === 'MERGED') throw new Error('PRODUCT_NOT_FOUND');

    const next = await this.repo.withTransaction(async (query) => {
      await query(`SELECT id FROM "Product" WHERE id = $1 FOR UPDATE`, [productId]);
      const ver = await query<{ v: string }>(
        `SELECT COALESCE(max(version), 0)::text AS v FROM "ProductNutritionVersion" WHERE "productId" = $1`,
        [productId],
      );
      const version = Number(ver.rows[0]?.v ?? 0) + 1;
      const inserted = await query<{ id: string; version: number }>(
        `INSERT INTO "ProductNutritionVersion" (
           "productId", version, calories, protein, fat, carbohydrate, fiber, sodium,
           source, "validFrom", "reviewedAt", "createdBy"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, now()), now(), $11)
         RETURNING id, version`,
        [
          productId,
          version,
          raw.calories,
          raw.protein,
          raw.fat,
          raw.carbohydrate,
          raw.fiber ?? null,
          raw.sodium ?? null,
          raw.source || 'MANUAL',
          raw.validFrom ?? null,
          user.id,
        ],
      );
      await query(
        `UPDATE "Product"
         SET "currentNutritionVersionId" = $2,
             "caloriesPer100g" = $3,
             "proteinPer100g" = $4,
             "fatPer100g" = $5,
             "carbsPer100g" = $6,
             "updatedAt" = now(),
             "rowVersion" = "rowVersion" + 1
         WHERE id = $1`,
        [productId, inserted.rows[0]!.id, raw.calories, raw.protein, raw.fat, raw.carbohydrate],
      );
      return inserted.rows[0]!;
    });

    const recipeCount = await this.repo.countRecipeIngredients(productId);
    await this.auditWrite(user.id, 'product.nutrition_version.create', productId, requestId, {
      version: next.version,
      reviewNote: raw.reviewNote ?? null,
      recipeDependencyCount: recipeCount,
    });
    const impact = this.recipeImpact
      ? await this.recipeImpact.onProductEvent({
          productId,
          reasonCode: 'PRODUCT_NUTRITION_VERSION_CHANGED',
          sourceEntityType: 'ProductNutritionVersion',
          sourceEntityId: next.id,
          actorUserId: user.id,
        })
      : null;
    return {
      ...next,
      previousVersion: product.currentNutritionVersion ?? null,
      recipeDependencyCount: recipeCount,
      futureRecipeRevalidationRequired: recipeCount > 0,
      recipeImpact: impact,
      message: 'Historical meal plans are not rewritten; recipe revalidation will be required later.',
    };
  }

  async putAllergens(
    user: RequestUser,
    productId: string,
    items: Array<{ allergenId: string; presence: string; source?: string }>,
    requestId?: string,
  ) {
    this.assertStaff(user);
    await this.repo.withTransaction(async (query) => {
      await query(`DELETE FROM "ProductAllergen" WHERE "productId" = $1`, [productId]);
      for (const item of items) {
        const presence = String(item.presence || 'CONTAINS').toUpperCase();
        if (!['CONTAINS', 'MAY_CONTAIN', 'CROSS_CONTAMINATION_RISK'].includes(presence)) {
          throw new Error('PRODUCT_ALLERGEN_PRESENCE_INVALID');
        }
        await query(
          `INSERT INTO "ProductAllergen" ("productId", "allergenId", presence, source)
           VALUES ($1,$2,$3,$4)`,
          [productId, item.allergenId, presence, item.source ?? 'OWNER_REVIEWED'],
        );
      }
      await query(
        `UPDATE "Product" SET "updatedAt" = now(), "rowVersion" = "rowVersion" + 1 WHERE id = $1`,
        [productId],
      );
    });
    await this.auditWrite(user.id, 'product.allergens.put', productId, requestId, { count: items.length });
    await this.recipeImpact?.onProductEvent({
      productId,
      reasonCode: 'PRODUCT_ALLERGEN_CHANGED',
      sourceEntityType: 'ProductAllergen',
      sourceEntityId: productId,
      actorUserId: user.id,
    });
    return this.detail(user, productId);
  }

  async putDietaryTags(
    user: RequestUser,
    productId: string,
    items: Array<{ dietaryTagId: string; source?: string }>,
    requestId?: string,
  ) {
    this.assertStaff(user);
    await this.repo.withTransaction(async (query) => {
      await query(`DELETE FROM "ProductDietaryTag" WHERE "productId" = $1`, [productId]);
      for (const item of items) {
        await query(
          `INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", source)
           VALUES ($1,$2,$3)`,
          [productId, item.dietaryTagId, item.source ?? 'OWNER_REVIEWED'],
        );
      }
      await query(
        `UPDATE "Product" SET "updatedAt" = now(), "rowVersion" = "rowVersion" + 1 WHERE id = $1`,
        [productId],
      );
    });
    await this.auditWrite(user.id, 'product.dietary_tags.put', productId, requestId, {
      count: items.length,
    });
    await this.recipeImpact?.onProductEvent({
      productId,
      reasonCode: 'PRODUCT_DIETARY_TAG_CHANGED',
      sourceEntityType: 'ProductDietaryTag',
      sourceEntityId: productId,
      actorUserId: user.id,
    });
    return this.detail(user, productId);
  }

  async putCulinaryRoles(
    user: RequestUser,
    productId: string,
    roles: CulinaryRoleAssignment[],
    requestId?: string,
  ) {
    this.assertStaff(user);
    const primaryCount = roles.filter((r) => r.isPrimary).length;
    if (primaryCount > 1) throw new Error('PRODUCT_CULINARY_ROLE_PRIMARY_INVALID');
    await this.repo.withTransaction(async (query) => {
      await query(`DELETE FROM "ProductCulinaryRole" WHERE "productId" = $1`, [productId]);
      for (const role of roles) {
        await query(
          `INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", source, confidence, "reviewedAt")
           VALUES ($1,$2,$3,$4,1.0, now())`,
          [productId, role.culinaryRoleId, Boolean(role.isPrimary), role.source ?? 'OWNER_REVIEWED'],
        );
      }
      await query(
        `UPDATE "Product" SET "updatedAt" = now(), "rowVersion" = "rowVersion" + 1 WHERE id = $1`,
        [productId],
      );
    });
    await this.auditWrite(user.id, 'product.culinary_roles.put', productId, requestId, {
      count: roles.length,
    });
    return this.detail(user, productId);
  }

  async createSubstitution(
    user: RequestUser,
    sourceProductId: string,
    raw: SubstitutionCreateInput,
    requestId?: string,
  ) {
    this.assertStaff(user);
    validateSubstitutionEdge({
      sourceProductId,
      replacementProductId: raw.replacementProductId,
      replacementRatio: raw.replacementRatio,
      replacementRatioMin: raw.replacementRatioMin,
      replacementRatioMax: raw.replacementRatioMax,
    });
    const nutritionImpact = assertNutritionImpact(raw.nutritionImpact ?? 'UNKNOWN');
    const textureImpact = assertTextureImpact(raw.textureImpact ?? 'UNKNOWN');
    const status = raw.status ?? 'NEEDS_REVIEW';
    try {
      const inserted = await this.repo.q()<{ id: string }>(
        `INSERT INTO "ProductSubstitution" (
           "sourceProductId", "replacementProductId", "culinaryRoleId",
           "replacementRatio", "replacementRatioMin", "replacementRatioMax",
           "nutritionImpact", "textureImpact", "supportedMethods", status, source, confidence, "reviewedAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,0.9, now())
         RETURNING id`,
        [
          sourceProductId,
          raw.replacementProductId,
          raw.culinaryRoleId ?? null,
          raw.replacementRatio,
          raw.replacementRatioMin,
          raw.replacementRatioMax,
          nutritionImpact,
          textureImpact,
          raw.supportedMethods ?? [],
          status,
          raw.source ?? 'MANUAL',
        ],
      );
      await this.auditWrite(user.id, 'product.substitution.create', sourceProductId, requestId, {
        substitutionId: inserted.rows[0]!.id,
        status,
      });
      return { id: inserted.rows[0]!.id, status };
    } catch (error) {
      const msg = String(error);
      if (/unique|ProductSubstitution_edge_role_uidx/i.test(msg)) {
        throw new Error('PRODUCT_SUBSTITUTION_DUPLICATE');
      }
      throw error;
    }
  }

  async patchSubstitution(
    user: RequestUser,
    id: string,
    body: Partial<SubstitutionCreateInput>,
    requestId?: string,
  ) {
    this.assertStaff(user);
    const existing = await this.repo.q()<{ id: string; sourceProductId: string }>(
      `SELECT id, "sourceProductId" FROM "ProductSubstitution" WHERE id = $1`,
      [id],
    );
    if (!existing.rows[0]) throw new Error('PRODUCT_SUBSTITUTION_NOT_FOUND');
    await this.repo.q()(
      `UPDATE "ProductSubstitution" SET
         "replacementRatio" = COALESCE($2, "replacementRatio"),
         "replacementRatioMin" = COALESCE($3, "replacementRatioMin"),
         "replacementRatioMax" = COALESCE($4, "replacementRatioMax"),
         "nutritionImpact" = COALESCE($5, "nutritionImpact"),
         "textureImpact" = COALESCE($6, "textureImpact"),
         "supportedMethods" = COALESCE($7::text[], "supportedMethods"),
         "culinaryRoleId" = COALESCE($8, "culinaryRoleId"),
         "updatedAt" = now()
       WHERE id = $1`,
      [
        id,
        body.replacementRatio ?? null,
        body.replacementRatioMin ?? null,
        body.replacementRatioMax ?? null,
        body.nutritionImpact ?? null,
        body.textureImpact ?? null,
        body.supportedMethods ?? null,
        body.culinaryRoleId ?? null,
      ],
    );
    await this.auditWrite(user.id, 'product.substitution.update', existing.rows[0].sourceProductId, requestId, {
      substitutionId: id,
    });
    return { id };
  }

  async setSubstitutionStatus(
    user: RequestUser,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    requestId?: string,
  ) {
    this.assertStaff(user);
    const existing = await this.repo.q()<{ id: string; sourceProductId: string }>(
      `UPDATE "ProductSubstitution" SET status = $2, "updatedAt" = now(), "reviewedAt" = now()
       WHERE id = $1 RETURNING id, "sourceProductId"`,
      [id, status],
    );
    if (!existing.rows[0]) throw new Error('PRODUCT_SUBSTITUTION_NOT_FOUND');
    await this.auditWrite(
      user.id,
      status === 'ACTIVE' ? 'product.substitution.activate' : 'product.substitution.suspend',
      existing.rows[0].sourceProductId,
      requestId,
      { substitutionId: id },
    );
    return { id, status };
  }

  async listRetail(user: RequestUser, productId: string) {
    this.assertStaff(user);
    const detail = await this.detail(user, productId);
    return { items: detail.retailProducts };
  }

  async listPrices(user: RequestUser, productId: string) {
    this.assertStaff(user);
    const detail = await this.detail(user, productId);
    return { items: detail.prices };
  }

  async remapRetailProduct(
    user: RequestUser,
    productId: string,
    retailProductId: string,
    requestId?: string,
  ) {
    this.assertStaff(user);
    const result = await this.repo.q()<{ id: string }>(
      `UPDATE "RetailProduct"
       SET "canonicalProductId" = $2, "mappingStatus" = 'MAPPED', "lastMatchedAt" = now(), "updatedAt" = now()
       WHERE id = $1
       RETURNING id`,
      [retailProductId, productId],
    );
    if (!result.rows[0]) throw new Error('RETAIL_PRODUCT_NOT_FOUND');
    await this.auditWrite(user.id, 'product.retail.remap', productId, requestId, { retailProductId });
    return { ok: true, retailProductId, canonicalProductId: productId };
  }

  async review(
    user: RequestUser,
    productId: string,
    body: { queueCode: string; decision: string; note?: string },
    requestId?: string,
  ) {
    this.assertStaff(user);
    const queueCode = assertQueueCode(body.queueCode);
    const decision = String(body.decision || 'RESOLVED').toUpperCase();
    if (!['RESOLVED', 'DISMISSED', 'ESCALATED', 'MERGED', 'NEEDS_MORE_INFO'].includes(decision)) {
      throw new Error('PRODUCT_REVIEW_DECISION_INVALID');
    }
    await this.repo.q()(
      `INSERT INTO "ProductReviewDecision" ("productId", "queueCode", decision, note, "actorUserId")
       VALUES ($1,$2,$3,$4,$5)`,
      [productId, queueCode, decision, body.note ?? null, user.id],
    );
    await this.repo.q()(
      `UPDATE "Product"
       SET "reviewStatus" = CASE WHEN $2 IN ('RESOLVED','DISMISSED','MERGED') THEN 'RESOLVED' ELSE 'IN_REVIEW' END,
           "reviewNote" = COALESCE($3, "reviewNote"),
           "updatedAt" = now(),
           "rowVersion" = "rowVersion" + 1
       WHERE id = $1`,
      [productId, decision, body.note ?? null],
    );
    await this.auditWrite(user.id, 'product.review.decision', productId, requestId, {
      queueCode,
      decision,
    });
    return { ok: true };
  }

  async reviewQueue(
    user: RequestUser,
    filters: {
      queue?: string;
      datasetVersion?: string;
      severity?: string;
      source?: string;
      category?: string;
      issueType?: string;
    } = {},
  ) {
    this.assertStaff(user);
    const code = filters.queue ? assertQueueCode(filters.queue) : undefined;
    let items = await this.repo.listReviewQueue(code as ProductReviewQueueCode | undefined);

    // Append seed needs-review rows as a synthetic queue for dataset provenance work.
    if (!code || code === 'MANUAL') {
      const seeded = await this.repo.q()<{
        productId: string;
        canonicalName: string;
        detectedAt: string;
        seedDatasetVersion: string | null;
        categoryCode: string | null;
      }>(
        `SELECT p.id AS "productId", p."canonicalName", p."updatedAt"::text AS "detectedAt",
                p."seedDatasetVersion", pc.code AS "categoryCode"
         FROM "Product" p
         LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
         WHERE p.status = 'ACTIVE' AND p."reviewStatus" = 'NEEDS_REVIEW'
         ORDER BY p."updatedAt" DESC
         LIMIT 100`,
      );
      for (const row of seeded.rows) {
        items.push({
          queueCode: 'MANUAL',
          productId: row.productId,
          canonicalName: row.canonicalName,
          severity: 'MEDIUM',
          source: row.seedDatasetVersion ? `SEED:${row.seedDatasetVersion}` : 'SEED',
          detectedAt: row.detectedAt,
          datasetVersion: row.seedDatasetVersion,
          categoryCode: row.categoryCode,
          issueType: 'NEEDS_REVIEW',
        } as never);
      }
    }

    if (filters.datasetVersion || filters.severity || filters.source || filters.category || filters.issueType) {
      const ids = [...new Set(items.map((i) => i.productId))];
      const meta = await this.repo.q()<{
        id: string;
        seedDatasetVersion: string | null;
        categoryCode: string | null;
      }>(
        `SELECT p.id, p."seedDatasetVersion", pc.code AS "categoryCode"
         FROM "Product" p
         LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
         WHERE p.id = ANY($1::uuid[])`,
        [ids],
      );
      const byId = new Map(meta.rows.map((r) => [r.id, r]));
      items = items.filter((item) => {
        const m = byId.get(item.productId);
        if (filters.datasetVersion && m?.seedDatasetVersion !== filters.datasetVersion) return false;
        if (filters.severity && item.severity !== filters.severity) return false;
        if (filters.source && !String(item.source).includes(filters.source)) return false;
        if (filters.category && m?.categoryCode !== filters.category) return false;
        if (filters.issueType && filters.issueType !== item.queueCode && filters.issueType !== 'NEEDS_REVIEW') {
          return false;
        }
        if (filters.issueType === 'NEEDS_REVIEW' && item.queueCode !== 'MANUAL') return false;
        return true;
      });
    }

    return { items };
  }

  async duplicates(user: RequestUser, limit = 50) {
    this.assertStaff(user);
    const result = await this.repo.q()<{
      aId: string;
      aName: string;
      bId: string;
      bName: string;
      reasons: string;
      confidence: string;
    }>(
      `SELECT a.id AS "aId", a."canonicalName" AS "aName",
              b.id AS "bId", b."canonicalName" AS "bName",
              concat_ws(',',
                CASE WHEN lower(a."canonicalName") = lower(b."canonicalName") THEN 'same_normalized_name' END,
                CASE WHEN a."productKey" IS NOT NULL AND a."productKey" = b."productKey" THEN 'same_product_key' END,
                CASE WHEN a."categoryId" IS NOT NULL AND a."categoryId" = b."categoryId" THEN 'same_category' END,
                CASE WHEN a.form IS NOT NULL AND a.form = b.form THEN 'same_form' END,
                CASE WHEN EXISTS (
                  SELECT 1 FROM "ProductAlias" aa JOIN "ProductAlias" bb
                    ON aa."normalizedAlias" = bb."normalizedAlias"
                   AND aa."productId" = a.id AND bb."productId" = b.id
                   AND aa.status = 'ACTIVE' AND bb.status = 'ACTIVE'
                ) THEN 'shared_alias' END
              ) AS reasons,
              CASE
                WHEN lower(a."canonicalName") = lower(b."canonicalName") THEN '0.95'
                WHEN a."productKey" = b."productKey" THEN '0.9'
                ELSE '0.65'
              END AS confidence
       FROM "Product" a
       JOIN "Product" b ON a.id < b.id
       WHERE a.status = 'ACTIVE' AND b.status = 'ACTIVE'
         AND (
           lower(a."canonicalName") = lower(b."canonicalName")
           OR (a."productKey" IS NOT NULL AND a."productKey" = b."productKey")
           OR EXISTS (
             SELECT 1 FROM "ProductAlias" aa JOIN "ProductAlias" bb
               ON aa."normalizedAlias" = bb."normalizedAlias"
              AND aa."productId" = a.id AND bb."productId" = b.id
              AND aa.status = 'ACTIVE' AND bb.status = 'ACTIVE'
           )
           OR (
             a."categoryId" IS NOT NULL AND a."categoryId" = b."categoryId"
             AND a.form IS NOT NULL AND a.form = b.form
             AND abs(COALESCE(a."caloriesPer100g",0) - COALESCE(b."caloriesPer100g",0)) <= 15
           )
         )
       ORDER BY confidence DESC, a."canonicalName"
       LIMIT $1`,
      [Math.min(100, Math.max(1, limit))],
    );
    return {
      items: result.rows.map((r) => ({
        pair: [
          { id: r.aId, canonicalName: r.aName },
          { id: r.bId, canonicalName: r.bName },
        ],
        reasons: r.reasons.split(',').filter(Boolean),
        confidence: Number(r.confidence),
      })),
    };
  }

  async mergePreview(user: RequestUser, sourceProductId: string, targetProductId: string): Promise<MergePreview> {
    this.assertStaff(user);
    if (sourceProductId === targetProductId) {
      return {
        sourceProductId,
        targetProductId,
        blocked: true,
        blockReason: 'MERGE_SOURCE_EQUALS_TARGET',
        recipeIngredientCount: 0,
        aliasCount: 0,
        nutritionVersionCount: 0,
        allergenCount: 0,
        dietaryTagCount: 0,
        culinaryRoleCount: 0,
        substitutionEdgeCount: 0,
        retailProductCount: 0,
        priceObservationCount: 0,
        conflicts: ['SOURCE_EQUALS_TARGET'],
        willRebind: [],
        willKeepHistorical: [],
      };
    }
    const [source, target] = await Promise.all([
      this.repo.getProductRow(sourceProductId),
      this.repo.getProductRow(targetProductId),
    ]);
    const conflicts: string[] = [];
    if (!source || !target) conflicts.push('PRODUCT_NOT_FOUND');
    if (source && String(source.status) === 'MERGED') conflicts.push('SOURCE_ALREADY_MERGED');
    if (target && (String(target.status) === 'MERGED' || String(target.status) === 'SUSPENDED')) {
      conflicts.push('TARGET_NOT_MERGEABLE');
    }

    const counts = await this.repo.q()<{
      recipes: string;
      aliases: string;
      nutrition: string;
      allergens: string;
      dietary: string;
      roles: string;
      substitutions: string;
      retail: string;
      prices: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM "RecipeIngredient" WHERE "productId" = $1) AS recipes,
         (SELECT count(*)::text FROM "ProductAlias" WHERE "productId" = $1) AS aliases,
         (SELECT count(*)::text FROM "ProductNutritionVersion" WHERE "productId" = $1) AS nutrition,
         (SELECT count(*)::text FROM "ProductAllergen" WHERE "productId" = $1) AS allergens,
         (SELECT count(*)::text FROM "ProductDietaryTag" WHERE "productId" = $1) AS dietary,
         (SELECT count(*)::text FROM "ProductCulinaryRole" WHERE "productId" = $1) AS roles,
         (SELECT count(*)::text FROM "ProductSubstitution" WHERE "sourceProductId" = $1 OR "replacementProductId" = $1) AS substitutions,
         (SELECT count(*)::text FROM "RetailProduct" WHERE "canonicalProductId" = $1) AS retail,
         (SELECT count(*)::text FROM "PriceObservation" WHERE "productId" = $1) AS prices`,
      [sourceProductId],
    );
    const c = counts.rows[0]!;
    return {
      sourceProductId,
      targetProductId,
      blocked: conflicts.length > 0,
      blockReason: conflicts[0] ?? null,
      recipeIngredientCount: Number(c.recipes),
      aliasCount: Number(c.aliases),
      nutritionVersionCount: Number(c.nutrition),
      allergenCount: Number(c.allergens),
      dietaryTagCount: Number(c.dietary),
      culinaryRoleCount: Number(c.roles),
      substitutionEdgeCount: Number(c.substitutions),
      retailProductCount: Number(c.retail),
      priceObservationCount: Number(c.prices),
      conflicts,
      willRebind: [
        'RecipeIngredient.productId',
        'RetailProduct.canonicalProductId',
        'PriceObservation.productId',
        'ProductAlias (non-conflicting)',
        'ProductAllergen/ProductDietaryTag/ProductCulinaryRole (union)',
        'ProductSubstitution endpoints',
      ],
      willKeepHistorical: [
        'ProductNutritionVersion rows on source (history retained)',
        'PlanRevision JSON snapshots (unchanged)',
        'source Product row marked MERGED',
      ],
    };
  }

  async merge(
    user: RequestUser,
    sourceProductId: string,
    targetProductId: string,
    requestId?: string,
  ): Promise<MergeResult> {
    this.assertOwner(user);
    assertRateLimit(`product-merge:${user.id}`, 10);
    const preview = await this.mergePreview(user, sourceProductId, targetProductId);
    if (preview.blocked) {
      return { status: 'MERGE_BLOCKED', reason: preview.blockReason ?? 'MERGE_BLOCKED', conflicts: preview.conflicts };
    }

    try {
      await this.repo.withTransaction(async (query) => {
        const source = await this.repo.lockProduct(sourceProductId, query);
        const target = await this.repo.lockProduct(targetProductId, query);
        if (!source || !target) throw new Error('PRODUCT_NOT_FOUND');
        if (source.status === 'MERGED') throw new Error('SOURCE_ALREADY_MERGED');
        if (target.status === 'MERGED' || target.status === 'SUSPENDED') throw new Error('TARGET_NOT_MERGEABLE');

        await query(`UPDATE "RecipeIngredient" SET "productId" = $2 WHERE "productId" = $1`, [
          sourceProductId,
          targetProductId,
        ]);
        await query(
          `UPDATE "RetailProduct" SET "canonicalProductId" = $2, "mappingStatus" = 'MAPPED', "updatedAt" = now()
           WHERE "canonicalProductId" = $1`,
          [sourceProductId, targetProductId],
        );
        await query(`UPDATE "PriceObservation" SET "productId" = $2 WHERE "productId" = $1`, [
          sourceProductId,
          targetProductId,
        ]);

        // Aliases: move non-conflicting; mark conflicting as REJECTED on source.
        await query(
          `UPDATE "ProductAlias" a SET "productId" = $2, "updatedAt" = now()
           WHERE a."productId" = $1
             AND NOT EXISTS (
               SELECT 1 FROM "ProductAlias" b
               WHERE b."productId" = $2 AND b.status = 'ACTIVE'
                 AND b."normalizedAlias" IS NOT DISTINCT FROM a."normalizedAlias"
             )`,
          [sourceProductId, targetProductId],
        );
        await query(
          `UPDATE "ProductAlias" SET status = 'REJECTED', "updatedAt" = now() WHERE "productId" = $1 AND status = 'ACTIVE'`,
          [sourceProductId],
        );

        await query(
          `INSERT INTO "ProductAllergen" ("productId", "allergenId", presence, source)
           SELECT $2, "allergenId", presence, source FROM "ProductAllergen" WHERE "productId" = $1
           ON CONFLICT ("productId", "allergenId") DO NOTHING`,
          [sourceProductId, targetProductId],
        );
        await query(
          `INSERT INTO "ProductDietaryTag" ("productId", "dietaryTagId", source)
           SELECT $2, "dietaryTagId", source FROM "ProductDietaryTag" WHERE "productId" = $1
           ON CONFLICT ("productId", "dietaryTagId") DO NOTHING`,
          [sourceProductId, targetProductId],
        );
        await query(
          `INSERT INTO "ProductCulinaryRole" ("productId", "culinaryRoleId", "isPrimary", source, confidence, "reviewedAt")
           SELECT $2, "culinaryRoleId", false, source, confidence, "reviewedAt"
           FROM "ProductCulinaryRole" WHERE "productId" = $1
           ON CONFLICT ("productId", "culinaryRoleId") DO NOTHING`,
          [sourceProductId, targetProductId],
        );

        // Substitutions: rebind endpoints; drop self-edges created by merge.
        await query(
          `UPDATE "ProductSubstitution" SET "sourceProductId" = $2, "updatedAt" = now()
           WHERE "sourceProductId" = $1`,
          [sourceProductId, targetProductId],
        );
        await query(
          `UPDATE "ProductSubstitution" SET "replacementProductId" = $2, "updatedAt" = now()
           WHERE "replacementProductId" = $1`,
          [sourceProductId, targetProductId],
        );
        await query(
          `DELETE FROM "ProductSubstitution"
           WHERE "sourceProductId" = "replacementProductId"`,
        );

        await query(
          `UPDATE "Product"
           SET status = 'MERGED',
               "canonicalProductId" = $2,
               "mergedAt" = now(),
               "mergedBy" = $3,
               "updatedAt" = now(),
               "rowVersion" = "rowVersion" + 1
           WHERE id = $1`,
          [sourceProductId, targetProductId, user.id],
        );
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'MERGE_FAILED';
      if (/unique|duplicate/i.test(reason)) {
        return {
          status: 'MERGE_BLOCKED',
          reason: 'MERGE_CONFLICT_UNIQUE',
          conflicts: [reason],
        };
      }
      throw error;
    }

    await this.auditWrite(user.id, 'product.merge', targetProductId, requestId, {
      sourceProductId,
      targetProductId,
    });
    await this.recipeImpact?.onProductEvent({
      productId: sourceProductId,
      reasonCode: 'PRODUCT_MERGED',
      sourceEntityType: 'Product',
      sourceEntityId: targetProductId,
      actorUserId: user.id,
    });
    return { status: 'MERGED', sourceProductId, targetProductId };
  }

  async metaLookups(user: RequestUser) {
    this.assertStaff(user);
    const [categories, allergens, dietaryTags, culinaryRoles] = await Promise.all([
      this.repo.q()<{ id: string; code: string; name: string }>(
        `SELECT id, code, name FROM "ProductCategory" WHERE status = 'ACTIVE' ORDER BY position, code`,
      ),
      this.repo.q()<{ id: string; code: string; name: string }>(
        `SELECT id, code, name FROM "Allergen" WHERE status = 'ACTIVE' ORDER BY code`,
      ),
      this.repo.q()<{ id: string; code: string; name: string }>(
        `SELECT id, code, name FROM "DietaryTag" WHERE status = 'ACTIVE' ORDER BY code`,
      ),
      this.repo.q()<{ id: string; code: string; name: string }>(
        `SELECT id, code, name FROM "CulinaryRole" WHERE status = 'ACTIVE' ORDER BY code`,
      ),
    ]);
    return {
      categories: categories.rows,
      allergens: allergens.rows,
      dietaryTags: dietaryTags.rows,
      culinaryRoles: culinaryRoles.rows,
      forms: ['RAW', 'DRY', 'BOILED', 'BAKED', 'FRIED', 'STEWED', 'FROZEN', 'CANNED', 'DRAINED', 'READY_TO_EAT'],
      units: ['g', 'ml', 'piece'],
    };
  }

  private async auditWrite(
    actorUserId: string,
    action: string,
    entityId: string,
    requestId: string | undefined,
    metadata: Record<string, unknown>,
  ) {
    await this.repo.appendAudit({
      actorUserId,
      action,
      entityType: 'Product',
      entityId,
      requestId,
      metadata,
    });
    if (this.audit) {
      try {
        await this.audit.appendEvent({
          actorUserId,
          action,
          entityType: 'Product',
          entityId,
          requestId: requestId ?? null,
          metadata,
        });
      } catch {
        // repository AuditEvent already written
      }
    }
  }
}

export { normalizeProductAlias };
