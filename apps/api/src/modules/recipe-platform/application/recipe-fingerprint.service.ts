import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  buildFingerprintHashes,
  classifySimilarity,
  jaccard,
  normalizeRecipeTitle,
  orderedPairKey,
  RECIPE_FINGERPRINT_SCHEMA_V1,
  SIMILARITY_WEIGHTS,
  type DuplicateClassification,
  type FingerprintFeatures,
  type NormalizedIngredientFeature,
  type SimilarityReason,
} from '../domain/recipe-fingerprint.policy';
import { RecipeCoverageAnalyzer } from './recipe-coverage-analyzer.service';
import { RecipeSearchBeforeGenerateService } from './recipe-search-before-generate.service';

@Injectable()
export class RecipeFingerprintService {
  readonly schemaVersion = RECIPE_FINGERPRINT_SCHEMA_V1;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(RecipeCoverageAnalyzer) private readonly coverageAnalyzer?: RecipeCoverageAnalyzer,
    @Optional()
    @Inject(RecipeSearchBeforeGenerateService)
    private readonly recipeSearch?: RecipeSearchBeforeGenerateService,
  ) {}

  async getFingerprint(recipeVersionId: string, schemaVersion = RECIPE_FINGERPRINT_SCHEMA_V1) {
    const row = await this.db.query(
      `SELECT * FROM "RecipeFingerprint"
       WHERE "recipeVersionId" = $1 AND "fingerprintSchemaVersion" = $2
       LIMIT 1`,
      [recipeVersionId, schemaVersion],
    );
    return row.rows[0] ?? null;
  }

  async rebuild(input: {
    recipeVersionId: string;
    actorUserId: string;
    actorRole: string;
    schemaVersion?: string;
  }) {
    this.assertStaff(input.actorRole);
    const schemaVersion = input.schemaVersion ?? RECIPE_FINGERPRINT_SCHEMA_V1;
    if (schemaVersion !== RECIPE_FINGERPRINT_SCHEMA_V1) {
      throw new Error('RECIPE_FINGERPRINT_SCHEMA_UNSUPPORTED');
    }
    return this.db.withTransaction(async (query) => {
      const built = await this.computeAndStore(input.recipeVersionId, schemaVersion, query);
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.fingerprint.rebuilt',
        entityType: 'RecipeFingerprint',
        entityId: built.id,
        metadata: { recipeVersionId: input.recipeVersionId, schemaVersion },
      });
      await this.coverageAnalyzer?.markDirty({
        reasons: ['FINGERPRINT_REBUILD'],
        recipeVersionIds: [input.recipeVersionId],
      });
      await this.recipeSearch?.invalidateForCatalogEvent({
        reason: 'FINGERPRINT_REBUILD',
      });
      return built;
    });
  }

  async ensureFingerprint(recipeVersionId: string, query?: SqlQuery) {
    const run = query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    const existing = await run(
      `SELECT * FROM "RecipeFingerprint"
       WHERE "recipeVersionId" = $1 AND "fingerprintSchemaVersion" = $2
       LIMIT 1`,
      [recipeVersionId, RECIPE_FINGERPRINT_SCHEMA_V1],
    );
    if (existing.rows[0]) return existing.rows[0];
    return this.computeAndStore(recipeVersionId, RECIPE_FINGERPRINT_SCHEMA_V1, run);
  }

  async backfillAll(actorUserId?: string | null) {
    const versions = await this.db.query<{ id: string }>(
      `SELECT id FROM "RecipeVersion" ORDER BY "createdAt" ASC`,
    );
    let created = 0;
    for (const row of versions.rows) {
      const before = await this.getFingerprint(row.id);
      await this.ensureFingerprint(row.id);
      if (!before) created += 1;
    }
    await this.scanCandidates({ limitPerVersion: 40 });
    await this.audit?.appendEvent({
      actorUserId: actorUserId ?? null,
      action: 'recipe.fingerprint.backfill',
      entityType: 'RecipeFingerprint',
      entityId: null,
      metadata: { scanned: versions.rows.length, created },
    });
    return { scanned: versions.rows.length, fingerprintsCreated: created };
  }

  async evaluatePublicationGate(input: {
    recipeId: string;
    versionId: string;
    acknowledgeNearDuplicate?: boolean;
    overrideExactDuplicate?: boolean;
    overrideReason?: string;
    actorUserId: string;
    actorRole: string;
  }) {
    this.assertStaff(input.actorRole);
    const fp = await this.ensureFingerprint(input.versionId);
    const candidates = await this.findCandidatesForVersion(input.versionId, 20);
    const exact = candidates.filter((c) => c.classification === 'EXACT_DUPLICATE' && c.status === 'OPEN');
    const near = candidates.filter((c) => c.classification === 'NEAR_DUPLICATE' && c.status === 'OPEN');
    const variants = candidates.filter((c) => c.classification === 'FAMILY_VARIANT' && c.status === 'OPEN');

    if (exact.length > 0) {
      if (!input.overrideExactDuplicate) {
        throw Object.assign(new Error('DUPLICATE_RECIPE_CONFLICT'), {
          code: 'DUPLICATE_RECIPE_CONFLICT',
          candidates: exact,
        });
      }
      if (String(input.actorRole).toUpperCase() !== 'OWNER') {
        throw new Error('OWNER_ACCESS_FORBIDDEN');
      }
      if (!String(input.overrideReason ?? '').trim()) {
        throw new Error('DUPLICATE_OVERRIDE_REASON_REQUIRED');
      }
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.duplicate.publication_override',
        entityType: 'RecipeVersion',
        entityId: input.versionId,
        metadata: {
          reason: input.overrideReason,
          exactCandidateIds: exact.map((c) => c.id),
        },
      });
    }

    if (near.length > 0 && !input.acknowledgeNearDuplicate) {
      throw Object.assign(new Error('NEAR_DUPLICATE_ACK_REQUIRED'), {
        code: 'NEAR_DUPLICATE_ACK_REQUIRED',
        candidates: near,
      });
    }

    return {
      fingerprintId: fp.id,
      exactDuplicates: exact,
      nearDuplicates: near,
      familyVariants: variants,
      allowed: true,
    };
  }

  async listCandidates(filters: {
    status?: string;
    classification?: string;
    schemaVersion?: string;
    limit?: number;
  }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filters.status) push(`c.status = ?`, filters.status);
    if (filters.classification) push(`c.classification = ?`, filters.classification);
    push(`c."fingerprintSchemaVersion" = ?`, filters.schemaVersion ?? RECIPE_FINGERPRINT_SCHEMA_V1);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(filters.limit ?? 100);
    const rows = await this.db.query(
      `SELECT c.*,
              lv."recipeId" AS "leftRecipeId",
              rv."recipeId" AS "rightRecipeId",
              lr.name AS "leftRecipeName",
              rr.name AS "rightRecipeName",
              lv."versionNumber" AS "leftVersionNumber",
              rv."versionNumber" AS "rightVersionNumber"
       FROM "RecipeDuplicateCandidate" c
       JOIN "RecipeVersion" lv ON lv.id = c."leftRecipeVersionId"
       JOIN "RecipeVersion" rv ON rv.id = c."rightRecipeVersionId"
       JOIN "Recipe" lr ON lr.id = lv."recipeId"
       JOIN "Recipe" rr ON rr.id = rv."recipeId"
       ${where}
       ORDER BY c.score DESC, c."detectedAt" DESC
       LIMIT $${values.length}`,
      values,
    );
    return rows.rows;
  }

  async getCandidate(id: string) {
    const rows = await this.listCandidates({ limit: 500 });
    return rows.find((row) => String(row.id) === id) ?? null;
  }

  async resolveCandidate(input: {
    candidateId: string;
    actorUserId: string;
    actorRole: string;
    resolutionCode: 'CONFIRMED_DUPLICATE' | 'CONFIRMED_VARIANT' | 'DISMISSED' | 'RESOLVED';
    resolutionNote: string;
  }) {
    this.assertStaff(input.actorRole);
    if (!String(input.resolutionNote ?? '').trim()) throw new Error('DUPLICATE_RESOLUTION_REASON_REQUIRED');
    const status =
      input.resolutionCode === 'CONFIRMED_DUPLICATE'
        ? 'CONFIRMED_DUPLICATE'
        : input.resolutionCode === 'CONFIRMED_VARIANT'
          ? 'CONFIRMED_VARIANT'
          : input.resolutionCode === 'DISMISSED'
            ? 'DISMISSED'
            : 'RESOLVED';
    const updated = await this.db.query(
      `UPDATE "RecipeDuplicateCandidate"
       SET status = $2,
           "reviewedAt" = now(),
           "reviewedBy" = $3,
           "resolutionCode" = $4,
           "resolutionNote" = $5
       WHERE id = $1 AND status = 'OPEN'
       RETURNING *`,
      [input.candidateId, status, input.actorUserId, input.resolutionCode, input.resolutionNote],
    );
    if (!updated.rows[0]) throw new Error('DUPLICATE_CANDIDATE_NOT_OPEN');
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.duplicate.resolved',
      entityType: 'RecipeDuplicateCandidate',
      entityId: input.candidateId,
      metadata: { resolutionCode: input.resolutionCode },
    });
    await this.coverageAnalyzer?.markDirty({
      reasons: ['DUPLICATE_RESOLVED'],
      recipeVersionIds: [
        String(updated.rows[0].leftRecipeVersionId ?? ''),
        String(updated.rows[0].rightRecipeVersionId ?? ''),
      ].filter(Boolean),
    });
    return updated.rows[0];
  }

  async scanCandidates(input?: { limitPerVersion?: number }) {
    const fps = await this.db.query<{
      id: string;
      recipeVersionId: string;
      exactContentHash: string;
      ingredientSetHash: string;
      ingredientQuantityHash: string;
      cookingStructureHash: string;
      familyFeatureHash: string | null;
      normalizedFeaturesJson: FingerprintFeatures;
    }>(
      `SELECT f.id, f."recipeVersionId", f."exactContentHash", f."ingredientSetHash",
              f."ingredientQuantityHash", f."cookingStructureHash",
              f."familyFeatureHash", f."normalizedFeaturesJson"
       FROM "RecipeFingerprint" f
       WHERE f."fingerprintSchemaVersion" = $1`,
      [RECIPE_FINGERPRINT_SCHEMA_V1],
    );
    const byVersion = new Map(fps.rows.map((row) => [row.recipeVersionId, row]));
    const versionMeta = await this.db.query<{ id: string; recipeId: string }>(
      `SELECT id, "recipeId" FROM "RecipeVersion"`,
    );
    const recipeOf = new Map(versionMeta.rows.map((row) => [row.id, row.recipeId]));
    let created = 0;
    let updated = 0;

    for (const left of fps.rows) {
      const blockers = fps.rows.filter((right) => {
        if (right.recipeVersionId === left.recipeVersionId) return false;
        if (recipeOf.get(right.recipeVersionId) === recipeOf.get(left.recipeVersionId)) return false;
        return (
          right.exactContentHash === left.exactContentHash ||
          right.ingredientSetHash === left.ingredientSetHash ||
          (left.familyFeatureHash && right.familyFeatureHash === left.familyFeatureHash)
        );
      });
      const limited = blockers.slice(0, input?.limitPerVersion ?? 40);
      for (const right of limited) {
        const result = await this.upsertCandidate(left.recipeVersionId, right.recipeVersionId, byVersion);
        if (result === 'created') created += 1;
        if (result === 'updated') updated += 1;
      }
    }
    return { created, updated, comparedVersions: fps.rows.length };
  }

  private async findCandidatesForVersion(versionId: string, limit: number) {
    const rows = await this.db.query(
      `SELECT * FROM "RecipeDuplicateCandidate"
       WHERE ("leftRecipeVersionId" = $1 OR "rightRecipeVersionId" = $1)
         AND "fingerprintSchemaVersion" = $2
       ORDER BY score DESC
       LIMIT $3`,
      [versionId, RECIPE_FINGERPRINT_SCHEMA_V1, limit],
    );
    return rows.rows as Array<{
      id: string;
      classification: DuplicateClassification;
      status: string;
      score: string;
    }>;
  }

  private async upsertCandidate(
    leftVersionId: string,
    rightVersionId: string,
    byVersion: Map<
      string,
      {
        recipeVersionId: string;
        exactContentHash: string;
        ingredientSetHash: string;
        ingredientQuantityHash: string;
        cookingStructureHash: string;
        familyFeatureHash: string | null;
        normalizedFeaturesJson: FingerprintFeatures;
      }
    >,
  ) {
    const left = byVersion.get(leftVersionId);
    const right = byVersion.get(rightVersionId);
    if (!left || !right) return 'skipped';
    const leftRecipe = await this.db.query<{ recipeId: string }>(
      `SELECT "recipeId" FROM "RecipeVersion" WHERE id = $1`,
      [leftVersionId],
    );
    const rightRecipe = await this.db.query<{ recipeId: string }>(
      `SELECT "recipeId" FROM "RecipeVersion" WHERE id = $1`,
      [rightVersionId],
    );
    const sameRecipe = leftRecipe.rows[0]?.recipeId === rightRecipe.rows[0]?.recipeId;
    if (sameRecipe) return 'skipped';

    const leftFeatures = this.asFeatures(left.normalizedFeaturesJson);
    const rightFeatures = this.asFeatures(right.normalizedFeaturesJson);
    let comparison = this.compareFeatures(leftFeatures, rightFeatures, sameRecipe);
    if (
      !sameRecipe &&
      ((left.exactContentHash &&
        right.exactContentHash &&
        left.exactContentHash === right.exactContentHash) ||
        (left.ingredientSetHash &&
          right.ingredientSetHash &&
          left.ingredientSetHash === right.ingredientSetHash &&
          left.ingredientQuantityHash === right.ingredientQuantityHash &&
          left.cookingStructureHash === right.cookingStructureHash))
    ) {
      comparison = {
        ...comparison,
        classification: 'EXACT_DUPLICATE',
        blocked: true,
        score: Math.max(comparison.score, 0.99),
        reasons: [
          ...comparison.reasons,
          {
            code: 'EXACT_STRUCTURE_HASH',
            detail: 'ingredient set/quantity/cooking hashes identical (schema v1)',
            weight: 1,
            contribution: 0,
          },
        ],
      };
    }
    const { left: L, right: R, pairKey } = orderedPairKey(leftVersionId, rightVersionId);
    const existing = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM "RecipeDuplicateCandidate"
       WHERE "pairKey" = $1 AND "fingerprintSchemaVersion" = $2
       LIMIT 1`,
      [pairKey, RECIPE_FINGERPRINT_SCHEMA_V1],
    );
    if (existing.rows[0] && existing.rows[0].status !== 'OPEN') {
      // Preserve OWNER resolution unless schema changes (not here).
      return 'preserved';
    }
    if (comparison.classification === 'DISTINCT' && comparison.score < 0.45) {
      return 'skipped';
    }
    if (existing.rows[0]) {
      await this.db.query(
        `UPDATE "RecipeDuplicateCandidate"
         SET classification = $2,
             score = $3,
             "reasonsJson" = $4::jsonb,
             "lastEvaluatedAt" = now()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          comparison.classification,
          comparison.score,
          JSON.stringify(comparison.reasons),
        ],
      );
      return 'updated';
    }
    await this.db.query(
      `INSERT INTO "RecipeDuplicateCandidate" (
         "leftRecipeVersionId", "rightRecipeVersionId", "fingerprintSchemaVersion",
         classification, score, "reasonsJson", status, "pairKey"
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'OPEN',$7)`,
      [
        L,
        R,
        RECIPE_FINGERPRINT_SCHEMA_V1,
        comparison.classification,
        comparison.score,
        JSON.stringify(comparison.reasons),
        pairKey,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: null,
      action: 'recipe.duplicate.detected',
      entityType: 'RecipeDuplicateCandidate',
      entityId: pairKey,
      metadata: { classification: comparison.classification, score: comparison.score },
    });
    return 'created';
  }

  compareFeatures(left: FingerprintFeatures, right: FingerprintFeatures, sameRecipe: boolean) {
    const leftSet = new Set(left.ingredients.map((i) => i.canonicalProductId));
    const rightSet = new Set(right.ingredients.map((i) => i.canonicalProductId));
    const ingredientOverlap = jaccard(leftSet, rightSet);
    const quantityDelta = this.quantityDelta(left.ingredients, right.ingredients);
    const samePrimary = Boolean(
      left.primaryProductId && left.primaryProductId === right.primaryProductId,
    );
    const sameFamily = Boolean(left.familyId && left.familyId === right.familyId);
    const cookingMatch =
      left.cooking.stepCount === right.cooking.stepCount
        ? 1
        : Math.max(
            0,
            1 -
              Math.abs(left.cooking.stepCount - right.cooking.stepCount) /
                Math.max(left.cooking.stepCount, right.cooking.stepCount, 1),
          );
    const titleMatch = left.titleNormalized === right.titleNormalized;

    const reasons: SimilarityReason[] = [];
    const push = (code: string, detail: string, weight: number, contribution: number) => {
      reasons.push({ code, detail, weight, contribution });
    };
    push(
      'INGREDIENT_IDENTITY',
      `${Math.round(ingredientOverlap * 100)}% ingredients overlap`,
      SIMILARITY_WEIGHTS.ingredientIdentity,
      ingredientOverlap * SIMILARITY_WEIGHTS.ingredientIdentity,
    );
    push(
      'PRIMARY_PRODUCT',
      samePrimary ? 'primary Product matches' : 'primary Product differs',
      SIMILARITY_WEIGHTS.primaryProduct,
      (samePrimary ? 1 : 0) * SIMILARITY_WEIGHTS.primaryProduct,
    );
    const qtyScore = Math.max(0, 1 - quantityDelta);
    push(
      'INGREDIENT_QUANTITIES',
      `normalized quantity delta ${Math.round(quantityDelta * 100)}%`,
      SIMILARITY_WEIGHTS.ingredientQuantities,
      qtyScore * SIMILARITY_WEIGHTS.ingredientQuantities,
    );
    push(
      'COOKING_METHODS',
      `structure similarity ${Math.round(cookingMatch * 100)}%`,
      SIMILARITY_WEIGHTS.cookingMethods,
      cookingMatch * SIMILARITY_WEIGHTS.cookingMethods,
    );
    push(
      'FAMILY',
      sameFamily ? 'same RecipeFamily' : 'different/no family',
      SIMILARITY_WEIGHTS.family,
      (sameFamily ? 1 : 0) * SIMILARITY_WEIGHTS.family,
    );
    push(
      'NORMALIZED_TITLE',
      titleMatch ? 'normalized title equal' : 'normalized title differs',
      SIMILARITY_WEIGHTS.normalizedTitle,
      (titleMatch ? 1 : 0) * SIMILARITY_WEIGHTS.normalizedTitle,
    );
    // culinaryRoles + structure use modest defaults from available data
    push('CULINARY_ROLES', 'role signals included via ingredient tokens', SIMILARITY_WEIGHTS.culinaryRoles, ingredientOverlap * SIMILARITY_WEIGHTS.culinaryRoles);
    push('STRUCTURE', 'step-count structure proxy', SIMILARITY_WEIGHTS.structure, cookingMatch * SIMILARITY_WEIGHTS.structure);

    const score = reasons.reduce((sum, reason) => sum + reason.contribution, 0);
    const classified = classifySimilarity({
      sameRecipe,
      score,
      ingredientOverlap,
      quantityDelta,
      samePrimary,
      sameFamily,
      cookingMatch,
      titleMatch,
    });
    return { ...classified, score, reasons, ingredientOverlap, quantityDelta };
  }

  private quantityDelta(left: NormalizedIngredientFeature[], right: NormalizedIngredientFeature[]) {
    const rightMap = new Map(right.map((i) => [i.canonicalProductId, i]));
    const shared = left.filter((i) => rightMap.has(i.canonicalProductId));
    if (shared.length === 0) return 1;
    let total = 0;
    let count = 0;
    for (const item of shared) {
      const other = rightMap.get(item.canonicalProductId)!;
      if (item.amountPerServing == null || other.amountPerServing == null) continue;
      const base = Math.max(item.amountPerServing, other.amountPerServing, 0.001);
      total += Math.abs(item.amountPerServing - other.amountPerServing) / base;
      count += 1;
    }
    return count === 0 ? 0.5 : total / count;
  }

  private async computeAndStore(recipeVersionId: string, schemaVersion: string, query: SqlQuery) {
    const features = await this.buildFeatures(recipeVersionId, query);
    const hashes = buildFingerprintHashes(features);
    const inserted = await query<{ id: string }>(
      `INSERT INTO "RecipeFingerprint" (
         "recipeVersionId", "fingerprintSchemaVersion",
         "exactContentHash", "ingredientSetHash", "ingredientQuantityHash",
         "cookingStructureHash", "titleNormalizationHash", "familyFeatureHash",
         "normalizedFeaturesJson", checksum, confidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       ON CONFLICT ("recipeVersionId", "fingerprintSchemaVersion") DO UPDATE
         SET "exactContentHash" = EXCLUDED."exactContentHash",
             "ingredientSetHash" = EXCLUDED."ingredientSetHash",
             "ingredientQuantityHash" = EXCLUDED."ingredientQuantityHash",
             "cookingStructureHash" = EXCLUDED."cookingStructureHash",
             "titleNormalizationHash" = EXCLUDED."titleNormalizationHash",
             "familyFeatureHash" = EXCLUDED."familyFeatureHash",
             "normalizedFeaturesJson" = EXCLUDED."normalizedFeaturesJson",
             checksum = EXCLUDED.checksum,
             confidence = EXCLUDED.confidence
       RETURNING id`,
      [
        recipeVersionId,
        schemaVersion,
        hashes.exactContentHash,
        hashes.ingredientSetHash,
        hashes.ingredientQuantityHash,
        hashes.cookingStructureHash,
        hashes.titleNormalizationHash,
        hashes.familyFeatureHash,
        JSON.stringify(features),
        hashes.checksum,
        hashes.confidence,
      ],
    );
    return {
      id: inserted.rows[0]!.id,
      recipeVersionId,
      fingerprintSchemaVersion: schemaVersion,
      ...hashes,
      normalizedFeaturesJson: features,
    };
  }

  private async buildFeatures(recipeVersionId: string, query: SqlQuery): Promise<FingerprintFeatures> {
    const version = await query<{
      id: string;
      recipeId: string;
      servings: number;
      contentSnapshotJson: { title?: string };
      ingredientsSnapshotJson: Array<{
        productId?: string;
        canonicalProductId?: string;
        amount?: number;
        unit?: string;
        ordering?: number;
        preparationNote?: string | null;
      }>;
      stepsSnapshotJson: Array<{
        stepIndex?: number;
        durationMinutes?: number | null;
        temperatureC?: number | null;
        equipment?: string | null;
        instruction?: string;
      }>;
    }>(
      `SELECT id, "recipeId", servings,
              "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson"
       FROM "RecipeVersion" WHERE id = $1`,
      [recipeVersionId],
    );
    const row = version.rows[0];
    if (!row) throw new Error('RECIPE_VERSION_NOT_FOUND');
    const recipe = await query<{
      recipeFamilyId: string | null;
      dishType: string | null;
      primaryProductId: string | null;
    }>(
      `SELECT r."recipeFamilyId", f."dishType", f."primaryProductId"
       FROM "Recipe" r
       LEFT JOIN "RecipeFamily" f ON f.id = r."recipeFamilyId"
       WHERE r.id = $1`,
      [row.recipeId],
    );
    const servings = Math.max(Number(row.servings) || 1, 1);
    const productIds = row.ingredientsSnapshotJson
      .map((i) => i.canonicalProductId || i.productId)
      .filter(Boolean) as string[];
    const products = await query<{ id: string; form: string | null; canonicalProductId: string | null }>(
      `SELECT id, form, "canonicalProductId" FROM "Product" WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const productMap = new Map(products.rows.map((p) => [p.id, p]));
    const ingredients: NormalizedIngredientFeature[] = row.ingredientsSnapshotJson.map((ing, index) => {
      const productId = String(ing.canonicalProductId || ing.productId || '');
      const product = productMap.get(productId);
      const canonical = product?.canonicalProductId || productId;
      const unit = String(ing.unit || 'g').toLowerCase();
      const amount = Number(ing.amount ?? 0);
      let amountPerServing: number | null = null;
      let conversionStatus: NormalizedIngredientFeature['conversionStatus'] = 'UNKNOWN_UNIT';
      if (unit === 'g' || unit === 'ml') {
        amountPerServing = amount / servings;
        conversionStatus = 'NORMALIZED';
      } else if (unit === 'piece' || unit === 'pcs' || unit === 'шт') {
        amountPerServing = amount / servings;
        conversionStatus = 'UNCONVERTED_COUNT';
      }
      return {
        canonicalProductId: canonical,
        form: product?.form ?? null,
        culinaryRole: null,
        amountPerServing,
        unit,
        conversionStatus,
        position: Number(ing.ordering ?? index),
      };
    });
    const durations = row.stepsSnapshotJson
      .map((s) => s.durationMinutes)
      .filter((v): v is number => typeof v === 'number');
    const temps = row.stepsSnapshotJson
      .map((s) => s.temperatureC)
      .filter((v): v is number => typeof v === 'number');
    const equipment = row.stepsSnapshotJson
      .map((s) => s.equipment)
      .filter((v): v is string => Boolean(v));
    const structureConfidence =
      durations.length > 0 || temps.length > 0 || equipment.length > 0 ? 'MEDIUM' : 'LOW';

    return {
      schemaVersion: RECIPE_FINGERPRINT_SCHEMA_V1,
      titleNormalized: normalizeRecipeTitle(String(row.contentSnapshotJson?.title ?? '')),
      servingsOriginal: servings,
      normalizationBasis: 'PER_SERVING',
      ingredients,
      cooking: {
        stepCount: row.stepsSnapshotJson.length,
        durationMinutes: durations,
        temperaturesC: temps,
        equipment,
        structureConfidence,
      },
      familyId: recipe.rows[0]?.recipeFamilyId ?? null,
      dishType: recipe.rows[0]?.dishType ?? null,
      primaryProductId: recipe.rows[0]?.primaryProductId ?? null,
    };
  }

  private asFeatures(value: unknown): FingerprintFeatures {
    if (typeof value === 'string') return JSON.parse(value) as FingerprintFeatures;
    return value as FingerprintFeatures;
  }

  private assertStaff(role: string) {
    const normalized = String(role ?? '').toUpperCase();
    if (normalized !== 'OWNER' && normalized !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }
}
