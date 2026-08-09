import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  assertControlledEnums,
  assertValidSlotBounds,
  buildCoverageSlotKey,
  computeCoverageStatus,
  COVERAGE_MATRIX_VERSION_V1,
  type CoverageAssignmentType,
  type CoveragePriority,
} from '../domain/recipe-coverage.policy';
import { COVERAGE_CORE_V1_SLOTS } from '../seed/coverage-core-v1.slots';
import { RecipeCoverageAnalyzer } from './recipe-coverage-analyzer.service';
import { RecipeSearchBeforeGenerateService } from './recipe-search-before-generate.service';

@Injectable()
export class RecipeCoverageService {
  readonly matrixVersion = COVERAGE_MATRIX_VERSION_V1;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(RecipeCoverageAnalyzer) private readonly analyzer?: RecipeCoverageAnalyzer,
    @Optional()
    @Inject(RecipeSearchBeforeGenerateService)
    private readonly recipeSearch?: RecipeSearchBeforeGenerateService,
  ) {}

  async listSlots(filters: {
    matrixVersion?: string;
    mealType?: string;
    priority?: string;
    status?: string;
    active?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    push(`s."matrixVersion" = ?`, filters.matrixVersion ?? COVERAGE_MATRIX_VERSION_V1);
    if (filters.mealType) push(`s."mealType" = ?`, filters.mealType);
    if (filters.priority) push(`s.priority = ?`, filters.priority);
    if (filters.status) push(`s.status = ?`, filters.status);
    if (filters.active != null) push(`s.active = ?`, filters.active);
    else push(`s.active = ?`, true);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    values.push(limit, offset);
    const rows = await this.db.query(
      `SELECT s.*, p."canonicalName" AS "primaryProductName", p."productKey" AS "primaryProductKey",
              COUNT(*) OVER()::int AS "totalCount"
       FROM "RecipeCoverageSlot" s
       LEFT JOIN "Product" p ON p.id = s."primaryProductId"
       ${where}
       ORDER BY s."sortRank" ASC, s.name ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: rows.rows,
      total: Number(rows.rows[0]?.totalCount ?? 0),
      limit,
      offset,
      matrixVersion: filters.matrixVersion ?? COVERAGE_MATRIX_VERSION_V1,
    };
  }

  async getSlot(id: string) {
    const row = await this.db.query(
      `SELECT s.*, p."canonicalName" AS "primaryProductName", p."productKey" AS "primaryProductKey"
       FROM "RecipeCoverageSlot" s
       LEFT JOIN "Product" p ON p.id = s."primaryProductId"
       WHERE s.id = $1`,
      [id],
    );
    return row.rows[0] ?? null;
  }

  async createSlot(input: {
    actorUserId: string;
    actorRole: string;
    name: string;
    description?: string;
    mealType: string;
    primaryProductId?: string | null;
    dishType: string;
    cookingMethod?: string | null;
    calorieMin?: number | null;
    calorieMax?: number | null;
    proteinMin?: number | null;
    fatMax?: number | null;
    maximumTimeMinutes?: number | null;
    maximumCost?: number | null;
    currency?: string | null;
    dietaryProfile: string;
    equipmentProfile: string;
    desiredRecipeCount: number;
    priority: CoveragePriority;
    sortRank?: number;
    provenance: string;
    rationale: string;
    matrixVersion?: string;
  }) {
    this.assertStaff(input.actorRole);
    assertControlledEnums(input);
    assertValidSlotBounds(input);
    const matrixVersion = input.matrixVersion ?? COVERAGE_MATRIX_VERSION_V1;
    if (matrixVersion !== COVERAGE_MATRIX_VERSION_V1) {
      throw new Error('COVERAGE_MATRIX_VERSION_UNSUPPORTED');
    }
    let primaryProductKey: string | null = null;
    if (input.primaryProductId) {
      const p = await this.db.query<{ productKey: string | null }>(
        `SELECT "productKey" FROM "Product" WHERE id = $1`,
        [input.primaryProductId],
      );
      if (!p.rows[0]) throw new Error('PRODUCT_NOT_FOUND');
      primaryProductKey = p.rows[0].productKey;
    }
    const slotKey = buildCoverageSlotKey({
      matrixVersion,
      mealType: input.mealType,
      primaryProductKey,
      dishType: input.dishType,
      cookingMethod: input.cookingMethod ?? null,
      calorieMin: input.calorieMin ?? null,
      calorieMax: input.calorieMax ?? null,
      proteinMin: input.proteinMin ?? null,
      fatMax: input.fatMax ?? null,
      maximumTimeMinutes: input.maximumTimeMinutes ?? null,
      dietaryProfile: input.dietaryProfile,
      equipmentProfile: input.equipmentProfile,
    });
    try {
      const inserted = await this.db.query(
        `INSERT INTO "RecipeCoverageSlot" (
           "slotKey", "matrixVersion", name, description, "mealType", "primaryProductId",
           "dishType", "cookingMethod", "calorieMin", "calorieMax", "proteinMin", "fatMax",
           "maximumTimeMinutes", "maximumCost", currency, "dietaryProfile", "equipmentProfile",
           "desiredRecipeCount", priority, "sortRank", status, provenance, rationale, "createdBy"
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'EMPTY',$21,$22,$23
         ) RETURNING *`,
        [
          slotKey,
          matrixVersion,
          input.name,
          input.description ?? '',
          input.mealType,
          input.primaryProductId ?? null,
          input.dishType,
          input.cookingMethod ?? null,
          input.calorieMin ?? null,
          input.calorieMax ?? null,
          input.proteinMin ?? null,
          input.fatMax ?? null,
          input.maximumTimeMinutes ?? null,
          input.maximumCost ?? null,
          input.currency ?? null,
          input.dietaryProfile,
          input.equipmentProfile,
          input.desiredRecipeCount,
          input.priority,
          input.sortRank ?? 9999,
          input.provenance,
          input.rationale,
          input.actorUserId,
        ],
      );
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.coverage.slot_created',
        entityType: 'RecipeCoverageSlot',
        entityId: inserted.rows[0]!.id,
        metadata: { slotKey, matrixVersion },
      });
      await this.analyzer?.markDirty({
        matrixVersion,
        reasons: ['COVERAGE_SLOT_CHANGED'],
        slotIds: [inserted.rows[0]!.id],
      });
      await this.recipeSearch?.invalidateForCatalogEvent({
        reason: 'COVERAGE_SLOT_CHANGED',
        coverageSlotId: inserted.rows[0]!.id,
        matrixVersion,
      });
      return inserted.rows[0];
    } catch (error) {
      if (String((error as Error).message ?? '').includes('RecipeCoverageSlot_matrix_slot_key')) {
        throw new Error('COVERAGE_SLOT_KEY_DUPLICATE');
      }
      throw error;
    }
  }

  async patchSlot(input: {
    slotId: string;
    actorUserId: string;
    actorRole: string;
    name?: string;
    description?: string;
    desiredRecipeCount?: number;
    priority?: CoveragePriority;
    active?: boolean;
    rationale?: string;
  }) {
    this.assertStaff(input.actorRole);
    const current = await this.getSlot(input.slotId);
    if (!current) throw new Error('COVERAGE_SLOT_NOT_FOUND');
    // matrixVersion / slotKey / publishedRecipeCount are server-owned.
    if (input.desiredRecipeCount != null) assertValidSlotBounds({ desiredRecipeCount: input.desiredRecipeCount });
    if (input.priority) {
      assertControlledEnums({
        mealType: String(current.mealType),
        dishType: String(current.dishType),
        cookingMethod: (current.cookingMethod as string) ?? null,
        dietaryProfile: String(current.dietaryProfile),
        equipmentProfile: String(current.equipmentProfile),
        priority: input.priority,
      });
    }
    const updated = await this.db.query(
      `UPDATE "RecipeCoverageSlot"
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           "desiredRecipeCount" = COALESCE($4, "desiredRecipeCount"),
           priority = COALESCE($5, priority),
           active = COALESCE($6, active),
           rationale = COALESCE($7, rationale),
           "updatedAt" = now(),
           status = CASE
             WHEN $4 IS NOT NULL THEN
               CASE
                 WHEN "publishedRecipeCount" = 0 THEN 'EMPTY'
                 WHEN "publishedRecipeCount" < $4 THEN 'UNDERFILLED'
                 WHEN "publishedRecipeCount" > $4 THEN 'OVERFILLED'
                 ELSE 'COVERED'
               END
             ELSE status
           END
       WHERE id = $1
       RETURNING *`,
      [
        input.slotId,
        input.name ?? null,
        input.description ?? null,
        input.desiredRecipeCount ?? null,
        input.priority ?? null,
        input.active ?? null,
        input.rationale ?? null,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: input.active === false ? 'recipe.coverage.slot_disabled' : 'recipe.coverage.slot_updated',
      entityType: 'RecipeCoverageSlot',
      entityId: input.slotId,
      metadata: { fields: Object.keys(input).filter((k) => k !== 'actorUserId' && k !== 'actorRole' && k !== 'slotId') },
    });
    await this.analyzer?.markDirty({
      matrixVersion: String(current.matrixVersion),
      reasons: ['COVERAGE_SLOT_CHANGED'],
      slotIds: [input.slotId],
    });
    await this.recipeSearch?.invalidateForCatalogEvent({
      reason: 'COVERAGE_SLOT_CHANGED',
      coverageSlotId: input.slotId,
      matrixVersion: String(current.matrixVersion),
    });
    return updated.rows[0];
  }

  async listAssignments(slotId: string) {
    const rows = await this.db.query(
      `SELECT a.*, r.id AS "recipeId", r.name AS "recipeName", r."recipeKey", v."versionNumber",
              l."lifecycleStatus", l."validationStatus"
       FROM "RecipeCoverageAssignment" a
       JOIN "RecipeVersion" v ON v.id = a."recipeVersionId"
       JOIN "Recipe" r ON r.id = v."recipeId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       WHERE a."slotId" = $1 AND a.active = true
       ORDER BY a."assignmentType", a."matchScore" DESC`,
      [slotId],
    );
    return rows.rows;
  }

  async manualAssign(input: {
    slotId: string;
    recipeVersionId: string;
    assignmentType: CoverageAssignmentType;
    actorUserId: string;
    actorRole: string;
    reason: string;
  }) {
    this.assertStaff(input.actorRole);
    if (!String(input.reason ?? '').trim()) throw new Error('COVERAGE_ASSIGNMENT_REASON_REQUIRED');
    if (input.assignmentType !== 'MANUAL_OVERRIDE' && input.assignmentType !== 'PRIMARY') {
      throw new Error('COVERAGE_ASSIGNMENT_TYPE_INVALID');
    }
    const slot = await this.getSlot(input.slotId);
    if (!slot || !slot.active) throw new Error('COVERAGE_SLOT_NOT_FOUND');
    const inserted = await this.db.query(
      `INSERT INTO "RecipeCoverageAssignment" (
         "slotId", "recipeVersionId", "assignmentType", "matchStatus", "matchScore",
         "reasonsJson", "assignedBy"
       ) VALUES ($1,$2,$3,'MATCHED',1,$4::jsonb,$5)
       ON CONFLICT ("slotId", "recipeVersionId", "assignmentType") WHERE active = true
       DO UPDATE SET "matchStatus" = 'MATCHED', "analyzedAt" = now(), "assignedBy" = EXCLUDED."assignedBy"
       RETURNING *`,
      [
        input.slotId,
        input.recipeVersionId,
        input.assignmentType,
        JSON.stringify([{ code: 'MANUAL_OVERRIDE', detail: input.reason }]),
        input.actorUserId,
      ],
    );
    await this.recomputeSlotCounts(input.slotId);
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.coverage.manual_assignment',
      entityType: 'RecipeCoverageAssignment',
      entityId: inserted.rows[0]!.id,
      metadata: { reason: input.reason, recipeVersionId: input.recipeVersionId },
    });
    return inserted.rows[0];
  }

  async seedMatrixV1(actorUserId?: string | null) {
    let created = 0;
    let existing = 0;
    for (const seed of COVERAGE_CORE_V1_SLOTS) {
      let primaryProductId: string | null = null;
      let primaryProductKey: string | null = seed.primaryProductKey;
      if (seed.primaryProductKey) {
        const p = await this.db.query<{ id: string; productKey: string }>(
          `SELECT id, "productKey" FROM "Product"
           WHERE "productKey" = $1 AND status <> 'MERGED'
           ORDER BY "updatedAt" DESC NULLS LAST
           LIMIT 1`,
          [seed.primaryProductKey],
        );
        if (!p.rows[0]) {
          // Skip slots whose product key is missing rather than inventing IDs.
          continue;
        }
        primaryProductId = p.rows[0].id;
        primaryProductKey = p.rows[0].productKey;
      }
      const slotKey = buildCoverageSlotKey({
        matrixVersion: COVERAGE_MATRIX_VERSION_V1,
        mealType: seed.mealType,
        primaryProductKey,
        dishType: seed.dishType,
        cookingMethod: seed.cookingMethod,
        calorieMin: seed.calorieMin,
        calorieMax: seed.calorieMax,
        proteinMin: seed.proteinMin,
        fatMax: seed.fatMax,
        maximumTimeMinutes: seed.maximumTimeMinutes,
        dietaryProfile: seed.dietaryProfile,
        equipmentProfile: seed.equipmentProfile,
      });
      const inserted = await this.db.query(
        `INSERT INTO "RecipeCoverageSlot" (
           "slotKey", "matrixVersion", name, description, "mealType", "primaryProductId",
           "dishType", "cookingMethod", "calorieMin", "calorieMax", "proteinMin", "fatMax",
           "maximumTimeMinutes", "maximumCost", currency, "dietaryProfile", "equipmentProfile",
           "desiredRecipeCount", priority, "sortRank", status, provenance, rationale, "createdBy"
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'EMPTY',$21,$22,$23
         )
         ON CONFLICT ("matrixVersion", "slotKey") DO NOTHING
         RETURNING id`,
        [
          slotKey,
          COVERAGE_MATRIX_VERSION_V1,
          seed.name,
          seed.description,
          seed.mealType,
          primaryProductId,
          seed.dishType,
          seed.cookingMethod,
          seed.calorieMin,
          seed.calorieMax,
          seed.proteinMin,
          seed.fatMax,
          seed.maximumTimeMinutes,
          seed.maximumCost,
          seed.currency,
          seed.dietaryProfile,
          seed.equipmentProfile,
          seed.desiredRecipeCount,
          seed.priority,
          seed.sortRank,
          seed.provenance,
          seed.rationale,
          actorUserId ?? null,
        ],
      );
      if (inserted.rows[0]) created += 1;
      else existing += 1;
    }
    await this.audit?.appendEvent({
      actorUserId: actorUserId ?? null,
      action: 'recipe.coverage.matrix_version_applied',
      entityType: 'RecipeCoverageSlot',
      entityId: null,
      metadata: { matrixVersion: COVERAGE_MATRIX_VERSION_V1, created, existing },
    });
    await this.analyzer?.markDirty({
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
      reasons: ['MATRIX_VERSION_APPLIED'],
      debounceMs: 0,
    });
    await this.recipeSearch?.invalidateForCatalogEvent({
      reason: 'MATRIX_VERSION_APPLIED',
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
    });
    return { matrixVersion: COVERAGE_MATRIX_VERSION_V1, created, existing, totalSeedDefinitions: COVERAGE_CORE_V1_SLOTS.length };
  }

  /** STEP_209/210: initial + regular analysis via unified RecipeCoverageAnalyzer. */
  async runInitialSnapshotAnalysis(actorUserId?: string | null) {
    if (!this.analyzer) throw new Error('COVERAGE_ANALYZER_UNAVAILABLE');
    const result = await this.analyzer.analyze({
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
      mode: 'FULL',
      reason: 'initial matrix snapshot / seed analysis',
      triggerType: 'SEED',
      requestedBy: actorUserId ?? null,
      dryRun: false,
    });
    return {
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
      slotsAnalyzed: result.slotsAnalyzed,
      eligibleVersions: result.eligibleRecipeCount,
      primaryAssigned: result.assignmentsCreated,
      secondaryAssigned: result.assignmentsUpdated,
      ambiguous: result.ambiguousMatches,
      runId: result.runId,
      inputChecksum: result.inputChecksum,
      resultChecksum: result.resultChecksum,
      semantic: result.semantic,
      analyzerVersion: result.analyzerVersion,
    };
  }

  async matrixReport() {
    const slots = await this.db.query(
      `SELECT status, "mealType", priority, "desiredRecipeCount", "publishedRecipeCount", "dishType", "cookingMethod"
       FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = $1 AND active = true`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    const byStatus: Record<string, number> = {};
    const byMeal: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let desiredTotal = 0;
    let publishedTotal = 0;
    for (const row of slots.rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byMeal[row.mealType] = (byMeal[row.mealType] ?? 0) + 1;
      byPriority[row.priority] = (byPriority[row.priority] ?? 0) + 1;
      desiredTotal += Number(row.desiredRecipeCount);
      publishedTotal += Number(row.publishedRecipeCount);
    }
    const assignments = await this.db.query(
      `SELECT a."assignmentType", a."matchStatus", COUNT(*)::int AS n
       FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a.active = true
       GROUP BY 1,2`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    const lastRun = this.analyzer
      ? (await this.analyzer.listRuns(COVERAGE_MATRIX_VERSION_V1, 1))[0] ?? null
      : null;
    return {
      package: 'RP2-03B',
      matrixVersion: COVERAGE_MATRIX_VERSION_V1,
      analyzerVersion: 'coverage-analyzer/v1',
      totalSlots: slots.rows.length,
      slotDistributionByMealType: byMeal,
      priorityDistribution: byPriority,
      statusDistribution: byStatus,
      EMPTY: byStatus.EMPTY ?? 0,
      UNDERFILLED: byStatus.UNDERFILLED ?? 0,
      COVERED: byStatus.COVERED ?? 0,
      OVERFILLED: byStatus.OVERFILLED ?? 0,
      NEEDS_REFRESH: byStatus.NEEDS_REFRESH ?? 0,
      desiredTotal,
      publishedPrimaryTotal: publishedTotal,
      assignments: assignments.rows,
      lastRun,
    };
  }

  async softDeleteTestSlot(input: { slotId: string; actorUserId: string; actorRole: string; reason: string }) {
    this.assertStaff(input.actorRole);
    if (!String(input.reason ?? '').trim()) throw new Error('COVERAGE_SLOT_DELETE_REASON_REQUIRED');
    const current = await this.getSlot(input.slotId);
    if (!current) throw new Error('COVERAGE_SLOT_NOT_FOUND');
    const provenance = String(current.provenance ?? '').toUpperCase();
    if (provenance !== 'E2E' && provenance !== 'TEST') {
      throw new Error('COVERAGE_SLOT_DELETE_NOT_ALLOWED');
    }
    await this.db.query(`DELETE FROM "RecipeCoverageAssignment" WHERE "slotId" = $1`, [input.slotId]);
    await this.db.query(`DELETE FROM "RecipeCoverageSlot" WHERE id = $1`, [input.slotId]);
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.coverage.slot_deleted_test',
      entityType: 'RecipeCoverageSlot',
      entityId: input.slotId,
      metadata: { reason: input.reason, provenance },
    });
    return { deleted: true, slotId: input.slotId };
  }

  private async recomputeSlotCounts(slotId: string) {
    const count = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM "RecipeCoverageAssignment"
       WHERE "slotId" = $1 AND active = true
         AND (
           ("assignmentType" = 'PRIMARY' AND "matchStatus" IN ('MATCHED','EXACT_MATCH'))
           OR ("assignmentType" = 'MANUAL_OVERRIDE' AND "matchStatus" NOT IN ('STALE','INELIGIBLE','PARTIAL_MATCH','PARTIAL'))
         )`,
      [slotId],
    );
    const published = Number(count.rows[0]?.n ?? 0);
    const slot = await this.getSlot(slotId);
    if (!slot) return;
    const status = computeCoverageStatus(published, Number(slot.desiredRecipeCount));
    await this.db.query(
      `UPDATE "RecipeCoverageSlot"
       SET "publishedRecipeCount" = $2, status = $3, "lastAnalyzedAt" = now(), "updatedAt" = now()
       WHERE id = $1`,
      [slotId, published, status],
    );
  }

  private assertStaff(role: string) {
    const normalized = String(role ?? '').toUpperCase();
    if (normalized !== 'OWNER' && normalized !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }
}
