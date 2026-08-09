/**
 * RP2-03C STEP_211 — Recipe Search Before Generate service.
 * Searches existing RecipeVersions before any future research/generation.
 * Does not create Recipe, RecipeVersion, Research jobs, or call AI.
 *
 * User hard filters (allergens / diet / equipment): use hardFilterProfileFromStructured only.
 * Legacy profile foodRestrictions / availableEquipment free-text is never a hard restriction.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  ProductPriceResolver,
  ProductSubstitutionResolver,
} from '../../product-catalog/application/product-roles-retail.resolvers';
import {
  inferCookingMethodsFromRecipeText,
  methodCompatible,
  primaryCookingMethod,
} from '../../product-catalog/domain/product-roles-retail.policy';
import type { ProductSubstitutionEdge } from '../../product-catalog/domain/product-roles-retail.types';
import { costForIngredient, summarizeDishCost } from '../../meal-plan/domain/meal-dish.pricing';
import {
  allowTestPriceEvidence,
  isProductionPriceDataClass,
} from '../../product-catalog/domain/price-data-class.policy';
import { hardFilterProfileFromStructured } from '../../user-profile/domain/profile-structure.policy';
import { RecipeCoverageAnalyzer } from './recipe-coverage-analyzer.service';
import {
  COVERAGE_MATRIX_VERSION_V1,
  type CoverageCostStatus,
  type CoverageDietaryProfile,
  dietaryProfileMatches,
  evaluateCoverageMatch,
  isEligibleCoverageVersion,
  isTestOnlyRecipeKey,
  nutritionPerServing,
  resolveCostCriterion,
  stableJsonChecksum,
} from '../domain/recipe-coverage.policy';
import {
  SEARCH_RUN_TTL_MS,
  SEARCH_SCHEMA_VERSION,
  type SearchCandidateType,
  type SearchOverrideInput,
  type SearchRecommendation,
  type SearchRequestType,
  type SearchSlotSnapshot,
  assertDecisionUsable,
  assertNoClientControlledSearchFields,
  buildSearchInputChecksum,
  buildSearchResultChecksum,
  compareSearchCandidates,
  decideSearchRecommendation,
  findPortionAdjustment,
  hashSearchDecisionToken,
  issueSearchDecisionToken,
  scoreSearchCandidate,
  verifySearchDecisionToken,
} from '../domain/recipe-search-before-generate.policy';

type CatalogVersion = {
  recipeId: string;
  recipeKey: string | null;
  dataClass?: string | null;
  title: string;
  recipeFamilyId: string | null;
  versionId: string;
  versionNumber: number;
  servings: number;
  calories: number;
  proteinG: number;
  fatG: number;
  dishType: string | null;
  primaryProductId: string | null;
  dietaryTags: string[];
  equipment: string[];
  cookingMethod: string | null;
  totalMinutes: number | null;
  compositionKnown: boolean;
  lifecycleStatus: string;
  validationStatus: string;
  hasFingerprint: boolean;
  fingerprintHash: string | null;
  isCurrent: boolean;
  ingredientProductIds: string[];
  ingredients: Array<{ productId: string | null; amount: number; unit: string }>;
};

type SearchCandidateOut = {
  recipeId: string;
  recipeVersionId: string;
  recipeFamilyId: string | null;
  title: string;
  versionNumber: number;
  candidateType: SearchCandidateType;
  eligibility: boolean;
  contentGroupId: string;
  duplicateClassification: string | null;
  coverageAssignments: Array<{ slotId: string; assignmentType: string; matchStatus: string }>;
  matchedDimensions: string[];
  failedDimensions: string[];
  unknownDimensions: string[];
  nutrition: { calories: number; proteinG: number; fatG: number; servings: number };
  portionAdjustment: {
    feasible: boolean;
    multiplier: number | null;
    calories: number | null;
    proteinG: number | null;
    fatG: number | null;
    reason?: string;
  } | null;
  cookingMethods: string[];
  dietaryCompatibility: boolean;
  equipmentCompatibility: boolean;
  costStatus: CoverageCostStatus;
  adaptationSummary: Record<string, unknown> | null;
  reasons: string[];
  score: number;
  rank: number;
};

@Injectable()
export class RecipeSearchBeforeGenerateService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(RecipeCoverageAnalyzer) private readonly coverageAnalyzer?: RecipeCoverageAnalyzer,
    @Optional()
    @Inject(ProductSubstitutionResolver)
    private readonly substitutions?: ProductSubstitutionResolver,
    @Optional() @Inject(ProductPriceResolver) private readonly prices?: ProductPriceResolver,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
  ) {}

  async preflight(input: {
    coverageSlotId?: string | null;
    requestType?: SearchRequestType;
    reason: string;
    requestedBy?: string | null;
    overrides?: SearchOverrideInput | null;
    rawBody?: Record<string, unknown>;
  }) {
    if (input.rawBody) assertNoClientControlledSearchFields(input.rawBody);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('SEARCH_REASON_REQUIRED');
    const requestType = (input.requestType ?? 'COVERAGE_SLOT_REVIEW') as SearchRequestType;
    const started = Date.now();

    const slot = input.coverageSlotId ? await this.loadSlot(input.coverageSlotId) : null;
    if (input.coverageSlotId && !slot) throw new Error('COVERAGE_SLOT_NOT_FOUND');
    const matrixVersion = slot?.matrixVersion ?? COVERAGE_MATRIX_VERSION_V1;
    const overridesUsed = Boolean(input.overrides && Object.keys(input.overrides).length);
    const effectiveSlot = slot
      ? this.applyOverrides(slot, input.overrides ?? null)
      : this.slotFromOverridesOnly(input.overrides ?? null, matrixVersion);

    const dirty = this.coverageAnalyzer ? await this.coverageAnalyzer.getDirty(matrixVersion) : null;
    let coverageResultChecksum: string | null = null;
    let coverageAnalysisRequired = false;
    if (dirty) {
      if (this.coverageAnalyzer && slot) {
        try {
          const refresh = await this.coverageAnalyzer.analyze({
            mode: 'INCREMENTAL_SLOTS',
            slotIds: [slot.id],
            reason: 'search-before-generate controlled refresh',
            dryRun: true,
            requestedBy: input.requestedBy ?? null,
            triggerType: 'SYSTEM',
          });
          coverageResultChecksum = refresh.resultChecksum;
        } catch {
          coverageAnalysisRequired = true;
        }
      } else {
        coverageAnalysisRequired = true;
      }
    } else {
      coverageResultChecksum = await this.loadLatestCoverageChecksum(matrixVersion);
    }

    const catalogStateChecksum = await this.computeCatalogStateChecksum(matrixVersion);
    const inputChecksum = buildSearchInputChecksum({
      searchSchemaVersion: SEARCH_SCHEMA_VERSION,
      requestType,
      matrixVersion,
      coverageSlotId: slot?.id ?? null,
      slotSnapshot: effectiveSlot,
      overrides: overridesUsed ? (input.overrides ?? null) : null,
      catalogStateChecksum,
      coverageResultChecksum,
      analyzerDirty: Boolean(dirty),
    });

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO "RecipeSearchBeforeGenerateRun" (
         "matrixVersion", "coverageSlotId", "searchSchemaVersion", "requestType",
         "inputChecksum", status, "requestedBy", reason, "expiresAt"
       ) VALUES ($1,$2,$3,$4,$5,'RUNNING',$6,$7, now() + ($8::text || ' milliseconds')::interval)
       RETURNING id`,
      [
        matrixVersion,
        slot?.id ?? null,
        SEARCH_SCHEMA_VERSION,
        requestType,
        inputChecksum,
        input.requestedBy ?? null,
        reason,
        String(SEARCH_RUN_TTL_MS),
      ],
    );
    const runId = inserted.rows[0]!.id;
    await this.auditSafe({
      actorUserId: input.requestedBy ?? null,
      action: 'recipe.search.started',
      entityType: 'RecipeSearchBeforeGenerateRun',
      entityId: runId,
      metadata: { matrixVersion, coverageSlotId: slot?.id ?? null, requestType, inputChecksum },
    });

    try {
      if (!effectiveSlot || coverageAnalysisRequired) {
        const recommendation: SearchRecommendation = 'BLOCKED_NO_SAFE_ACTION';
        const result = {
          searchSchemaVersion: SEARCH_SCHEMA_VERSION,
          matrixVersion,
          coverageSlotId: slot?.id ?? null,
          coverageSlot: effectiveSlot,
          overridesApplied: overridesUsed,
          recommendation,
          coverageAnalysisRequired: coverageAnalysisRequired || !effectiveSlot,
          candidates: [] as SearchCandidateOut[],
          exactDuplicateBlockers: [] as string[],
          eligibleCount: 0,
          blockedHistoricalCount: 0,
          catalogStateChecksum,
          coverageResultChecksum,
          countsByLevel: {},
          reasons: coverageAnalysisRequired
            ? ['COVERAGE_ANALYSIS_REQUIRED']
            : ['SLOT_OR_CRITERIA_REQUIRED'],
        };
        const resultChecksum = buildSearchResultChecksum({
          recommendation,
          candidates: [],
          exactDuplicateBlockers: [],
          coverageAnalysisRequired: result.coverageAnalysisRequired,
        });
        return await this.finish(
          runId,
          result,
          resultChecksum,
          started,
          input.requestedBy ?? null,
          inputChecksum,
        );
      }

      const result = await this.executeSearch({
        slot: effectiveSlot,
        sourceSlotId: slot?.id ?? null,
        overridesApplied: overridesUsed,
        catalogStateChecksum,
        coverageResultChecksum,
        coverageAnalysisRequired: false,
      });
      const resultChecksum = buildSearchResultChecksum({
        recommendation: result.recommendation,
        candidates: result.candidates.map((c) => ({
          recipeVersionId: c.recipeVersionId,
          candidateType: c.candidateType,
          score: c.score,
          rank: c.rank,
        })),
        exactDuplicateBlockers: result.exactDuplicateBlockers,
        coverageAnalysisRequired: false,
      });
      return await this.finish(
        runId,
        result,
        resultChecksum,
        started,
        input.requestedBy ?? null,
        inputChecksum,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SEARCH_FAILED';
      await this.db.query(
        `UPDATE "RecipeSearchBeforeGenerateRun"
         SET status = 'FAILED', "completedAt" = now(), "durationMs" = $2,
             "errorCode" = $3, "errorSummary" = $4
         WHERE id = $1`,
        [runId, Date.now() - started, message.slice(0, 80), message.slice(0, 400)],
      );
      await this.auditSafe({
        actorUserId: input.requestedBy ?? null,
        action: 'recipe.search.failed',
        entityType: 'RecipeSearchBeforeGenerateRun',
        entityId: runId,
        metadata: { errorCode: message.slice(0, 80) },
      });
      throw error;
    }
  }

  async listRuns(input: { coverageSlotId?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
    const rows = input.coverageSlotId
      ? await this.db.query(
          `SELECT id, "matrixVersion", "coverageSlotId", "searchSchemaVersion", "requestType",
                  "inputChecksum", status, "requestedBy", reason, "resultChecksum",
                  "expiresAt", "createdAt", "completedAt", "durationMs", "errorCode",
                  "resultJson"->'recommendation' AS recommendation
           FROM "RecipeSearchBeforeGenerateRun"
           WHERE "coverageSlotId" = $1
           ORDER BY "createdAt" DESC LIMIT $2`,
          [input.coverageSlotId, limit],
        )
      : await this.db.query(
          `SELECT id, "matrixVersion", "coverageSlotId", "searchSchemaVersion", "requestType",
                  "inputChecksum", status, "requestedBy", reason, "resultChecksum",
                  "expiresAt", "createdAt", "completedAt", "durationMs", "errorCode",
                  "resultJson"->'recommendation' AS recommendation
           FROM "RecipeSearchBeforeGenerateRun"
           ORDER BY "createdAt" DESC LIMIT $1`,
          [limit],
        );
    return { items: rows.rows };
  }

  async getRun(runId: string): Promise<Record<string, unknown> & {
    latestDecision: {
      id: string;
      expiresAt: Date | null;
      invalidatedAt: Date | null;
      usedAt: Date | null;
    } | null;
    decisionStale: boolean;
  }> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM "RecipeSearchBeforeGenerateRun" WHERE id = $1`,
      [runId],
    );
    if (!rows.rows[0]) throw new Error('SEARCH_RUN_NOT_FOUND');
    const decision = await this.db.query<{
      id: string;
      expiresAt: Date | null;
      invalidatedAt: Date | null;
      usedAt: Date | null;
    }>(
      `SELECT id, "expiresAt", "invalidatedAt", "usedAt"
       FROM "RecipeSearchDecision"
       WHERE "searchRunId" = $1
       ORDER BY "issuedAt" DESC
       LIMIT 1`,
      [runId],
    );
    const latestDecision = decision.rows[0] ?? null;
    const decisionStale = Boolean(
      latestDecision &&
        (latestDecision.invalidatedAt ||
          (latestDecision.expiresAt && latestDecision.expiresAt.getTime() < Date.now())),
    );
    return {
      ...rows.rows[0],
      latestDecision,
      decisionStale,
    };
  }

  async getCandidates(runId: string) {
    const run = await this.getRun(runId);
    const result = (run.resultJson ?? {}) as {
      candidates?: SearchCandidateOut[];
      recommendation?: string;
    };
    return { runId, recommendation: result.recommendation, items: result.candidates ?? [] };
  }

  async issueDecision(input: {
    runId: string;
    actorUserId: string;
    actorRole: string;
    oneTime?: boolean;
  }) {
    if (String(input.actorRole).toUpperCase() !== 'OWNER') {
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    const run = await this.getRun(input.runId);
    if (run.status !== 'COMPLETED') throw new Error('SEARCH_RUN_NOT_COMPLETED');
    const result = run.resultJson as {
      recommendation: SearchRecommendation;
      catalogStateChecksum: string;
    };
    if (!result?.recommendation || !result.catalogStateChecksum) {
      throw new Error('SEARCH_RUN_RESULT_INCOMPLETE');
    }
    const issued = issueSearchDecisionToken({
      searchRunId: input.runId,
      coverageSlotId: (run.coverageSlotId as string | null) ?? null,
      recommendation: result.recommendation,
      inputChecksum: String(run.inputChecksum),
      resultChecksum: String(run.resultChecksum),
      matrixVersion: String(run.matrixVersion),
      catalogStateChecksum: result.catalogStateChecksum,
      oneTime: input.oneTime !== false,
    });
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO "RecipeSearchDecision" (
         "searchRunId", "coverageSlotId", "matrixVersion", recommendation,
         "inputChecksum", "resultChecksum", "catalogStateChecksum",
         token, "tokenHash", "issuedAt", "expiresAt", "issuedBy", "oneTime"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        input.runId,
        run.coverageSlotId,
        run.matrixVersion,
        result.recommendation,
        run.inputChecksum,
        run.resultChecksum,
        result.catalogStateChecksum,
        issued.token,
        issued.tokenHash,
        issued.issuedAt.toISOString(),
        issued.expiresAt.toISOString(),
        input.actorUserId,
        input.oneTime !== false,
      ],
    );
    await this.auditSafe({
      actorUserId: input.actorUserId,
      action: 'recipe.search.decision_issued',
      entityType: 'RecipeSearchDecision',
      entityId: row.rows[0]!.id,
      metadata: { searchRunId: input.runId, recommendation: result.recommendation },
    });
    await this.auditRecommendation(result.recommendation, input.actorUserId, input.runId);
    return {
      decisionId: row.rows[0]!.id,
      token: issued.token,
      recommendation: result.recommendation,
      expiresAt: issued.expiresAt.toISOString(),
      oneTime: input.oneTime !== false,
      searchRunId: input.runId,
      inputChecksum: run.inputChecksum,
      resultChecksum: run.resultChecksum,
    };
  }

  async invalidateDecision(input: {
    runId: string;
    actorUserId: string;
    reason: string;
    decisionId?: string;
  }) {
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('SEARCH_INVALIDATION_REASON_REQUIRED');
    const updated = await this.db.query<{ id: string }>(
      input.decisionId
        ? `UPDATE "RecipeSearchDecision"
           SET "invalidatedAt" = now(), "invalidationReason" = $2
           WHERE id = $1 AND "searchRunId" = $3 AND "invalidatedAt" IS NULL
           RETURNING id`
        : `UPDATE "RecipeSearchDecision"
           SET "invalidatedAt" = now(), "invalidationReason" = $2
           WHERE "searchRunId" = $1 AND "invalidatedAt" IS NULL
           RETURNING id`,
      input.decisionId ? [input.decisionId, reason, input.runId] : [input.runId, reason],
    );
    for (const row of updated.rows) {
      await this.auditSafe({
        actorUserId: input.actorUserId,
        action: 'recipe.search.decision_invalidated',
        entityType: 'RecipeSearchDecision',
        entityId: row.id,
        metadata: { reason, searchRunId: input.runId },
      });
    }
    return { invalidated: updated.rows.length };
  }

  async validateDecision(input: {
    token: string;
    coverageSlotId?: string | null;
    consume?: boolean;
  }) {
    verifySearchDecisionToken(input.token);
    const hash = hashSearchDecisionToken(input.token);
    const rows = await this.db.query<{
      id: string;
      expiresAt: Date;
      usedAt: Date | null;
      invalidatedAt: Date | null;
      oneTime: boolean;
      recommendation: string;
      matrixVersion: string;
      catalogStateChecksum: string;
      coverageSlotId: string | null;
    }>(`SELECT * FROM "RecipeSearchDecision" WHERE "tokenHash" = $1`, [hash]);
    const row = rows.rows[0];
    if (!row) throw new Error('SEARCH_DECISION_NOT_FOUND');
    const catalogStateChecksum = await this.computeCatalogStateChecksum(row.matrixVersion);
    assertDecisionUsable(row, {
      matrixVersion: row.matrixVersion,
      coverageSlotId: input.coverageSlotId !== undefined ? input.coverageSlotId : row.coverageSlotId,
      catalogStateChecksum,
    });
    if (input.consume) {
      const consumed = await this.db.query(
        `UPDATE "RecipeSearchDecision"
         SET "usedAt" = now()
         WHERE id = $1 AND "usedAt" IS NULL AND "invalidatedAt" IS NULL
         RETURNING id`,
        [row.id],
      );
      if (!consumed.rows[0]) throw new Error('SEARCH_DECISION_ALREADY_USED');
    }
    return { ok: true, decisionId: row.id, recommendation: row.recommendation };
  }

  async invalidateForCatalogEvent(input: {
    reason: string;
    coverageSlotId?: string | null;
    matrixVersion?: string;
  }) {
    const params: unknown[] = [input.reason];
    let sql = `UPDATE "RecipeSearchDecision"
               SET "invalidatedAt" = now(), "invalidationReason" = $1
               WHERE "invalidatedAt" IS NULL AND "usedAt" IS NULL`;
    if (input.coverageSlotId) {
      params.push(input.coverageSlotId);
      sql += ` AND "coverageSlotId" = $${params.length}`;
    }
    if (input.matrixVersion) {
      params.push(input.matrixVersion);
      sql += ` AND "matrixVersion" = $${params.length}`;
    }
    const updated = await this.db.query<{ id: string }>(`${sql} RETURNING id`, params);
    return { invalidated: updated.rows.length };
  }

  private async executeSearch(input: {
    slot: SearchSlotSnapshot;
    sourceSlotId: string | null;
    overridesApplied: boolean;
    catalogStateChecksum: string;
    coverageResultChecksum: string | null;
    coverageAnalysisRequired: boolean;
  }) {
    const slotContradictory = this.isSlotContradictory(input.slot);
    const versions = await this.loadEligibleCandidates();
    const assignments = input.sourceSlotId
      ? await this.loadSlotAssignments(input.sourceSlotId)
      : [];
    const assignmentByVersion = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const list = assignmentByVersion.get(a.recipeVersionId) ?? [];
      list.push(a);
      assignmentByVersion.set(a.recipeVersionId, list);
    }

    const openExact = await this.loadOpenExactDuplicates();
    const nearDupes = await this.loadNearOrPossibleDuplicates();
    const exactBlockers = new Set<string>();

    const costCache = new Map<string, { cost: number | null; status: CoverageCostStatus }>();
    const ranked: Array<
      SearchCandidateOut & {
        hardMatch: boolean;
        existingCoverage: boolean;
        nutritionFit: number;
        primaryProductMatch: boolean;
        cookingMethodMatch: boolean;
        dietaryOk: boolean;
        equipmentOk: boolean;
        timeOk: boolean;
        costConfidence: number;
        familyRelated: boolean;
        duplicatePenalty: number;
        adaptationComplexity: number;
      }
    > = [];

    let blockedHistoricalCount = 0;
    let eligibleCount = 0;

    for (const version of versions) {
      const eligibility = isEligibleCoverageVersion({
        lifecycleStatus: version.lifecycleStatus,
        validationStatus: version.validationStatus,
        isCurrent: version.isCurrent,
        hasFingerprint: version.hasFingerprint,
        recipeKey: version.recipeKey,
        dataClass: version.dataClass,
        hasOpenExactDuplicateBlocker: openExact.has(version.versionId),
      });

      const contentGroupId = openExact.get(version.versionId) ?? version.recipeId;
      const per = nutritionPerServing({
        calories: version.calories,
        proteinG: version.proteinG,
        fatG: version.fatG,
        servings: version.servings,
      });

      if (!eligibility.eligible) {
        blockedHistoricalCount += 1;
        if (
          eligibility.reason === 'OPEN_EXACT_DUPLICATE_BLOCKER' &&
          this.isVersionInSlotScope(input.slot, version, assignmentByVersion.has(version.versionId))
        ) {
          exactBlockers.add(version.versionId);
        }
        ranked.push(
          this.buildRankedCandidate({
            version,
            candidateType: 'HISTORICAL_OR_BLOCKED_CONTEXT',
            eligibility: false,
            contentGroupId,
            duplicateClassification: openExact.has(version.versionId) ? 'EXACT_DUPLICATE' : null,
            coverageAssignments: assignmentByVersion.get(version.versionId) ?? [],
            matchedDimensions: [],
            failedDimensions: [eligibility.reason ?? 'INELIGIBLE'],
            unknownDimensions: [],
            nutrition: { ...per, servings: version.servings },
            portionAdjustment: null,
            costStatus: 'NOT_APPLICABLE',
            adaptationSummary: null,
            reasons: [eligibility.reason ?? 'INELIGIBLE'],
            hardMatch: false,
            existingCoverage: false,
            nutritionFit: 0,
            primaryProductMatch: false,
            cookingMethodMatch: false,
            dietaryOk: false,
            equipmentOk: false,
            timeOk: false,
            costConfidence: 0,
            familyRelated: false,
            duplicatePenalty: openExact.has(version.versionId) ? 1 : 0.3,
            adaptationComplexity: 0,
          }),
        );
        continue;
      }
      eligibleCount += 1;

      let costInfo = costCache.get(version.versionId);
      if (!costInfo) {
        costInfo =
          input.slot.maximumCost != null
            ? await this.estimateVersionCost(version)
            : { cost: null, status: 'NOT_APPLICABLE' as CoverageCostStatus };
        costCache.set(version.versionId, costInfo);
      }
      const costCrit = resolveCostCriterion({
        maximumCost: input.slot.maximumCost,
        consumedCostPerServing: costInfo.cost,
        costStatus: costInfo.status,
      });
      const dims = this.dimensionFlags(input.slot, version);
      const contract = evaluateCoverageMatch({
        eligible: true,
        contentGroupId,
        ...dims,
        costConstrained: costCrit.costConstrained,
        costStatus: costCrit.costStatus,
        costOk: costCrit.costOk,
      });

      const slotAssignments = assignmentByVersion.get(version.versionId) ?? [];
      const existingCoverage = slotAssignments.some(
        (a) =>
          a.assignmentType === 'PRIMARY' ||
          a.assignmentType === 'MANUAL_OVERRIDE' ||
          a.assignmentType === 'SECONDARY',
      );
      const primaryCoverage = slotAssignments.some(
        (a) => a.assignmentType === 'PRIMARY' || a.assignmentType === 'MANUAL_OVERRIDE',
      );

      const nutritionBaseOk = dims.calorieOk && dims.proteinOk && dims.fatOk;
      const portion = findPortionAdjustment({
        baseCalories: per.calories,
        baseProteinG: per.proteinG,
        baseFatG: per.fatG,
        calorieMin: input.slot.calorieMin,
        calorieMax: input.slot.calorieMax,
        proteinMin: input.slot.proteinMin,
        fatMax: input.slot.fatMax,
      });

      const hardNonNutritionOk =
        dims.productOk &&
        dims.dishOk &&
        dims.methodOk &&
        dims.dietaryOk &&
        dims.equipmentOk &&
        dims.timeOk &&
        (costCrit.costOk !== false);

      let adaptationSummary: Record<string, unknown> | null = null;
      let adaptationOk = false;
      if (
        !dims.productOk &&
        input.slot.primaryProductId &&
        this.substitutions &&
        version.ingredientProductIds.length
      ) {
        const preview = await this.previewSafeAdaptation(version, input.slot.primaryProductId);
        if (preview) {
          adaptationSummary = preview;
          adaptationOk = true;
        }
      }

      const familyRelated = Boolean(
        version.recipeFamilyId &&
          versions.some(
            (other) =>
              other.versionId !== version.versionId &&
              other.recipeFamilyId === version.recipeFamilyId &&
              (assignmentByVersion.has(other.versionId) ||
                (other.primaryProductId && other.primaryProductId === input.slot.primaryProductId)),
          ),
      );

      const nearClass = nearDupes.get(version.versionId) ?? null;

      let candidateType: SearchCandidateType;
      if (primaryCoverage && contract.hardMatch) {
        candidateType = 'EXISTING_COVERAGE';
      } else if (contract.hardMatch || (contract.matchStatus === 'EXACT_MATCH' && nutritionBaseOk)) {
        candidateType = 'EXACT_SLOT_MATCH';
      } else if (
        !nutritionBaseOk &&
        portion.feasible &&
        portion.multiplier != null &&
        portion.multiplier !== 1 &&
        hardNonNutritionOk
      ) {
        candidateType = 'PORTION_ADJUSTABLE';
      } else if (
        adaptationOk &&
        dims.dishOk &&
        dims.methodOk &&
        dims.dietaryOk !== false &&
        dims.equipmentOk &&
        dims.timeOk &&
        costCrit.costOk !== false
      ) {
        // Product mismatch is expected; curated substitution repairs primary product fit.
        candidateType = 'SAFE_SUBSTITUTION_ADAPTABLE';
      } else if (familyRelated && dims.dishOk) {
        candidateType = 'FAMILY_VARIANT';
      } else if (nearClass) {
        candidateType = 'NEAR_OR_POSSIBLE_DUPLICATE';
      } else if (existingCoverage) {
        candidateType = 'EXISTING_COVERAGE';
      } else if (contract.matchStatus === 'PARTIAL_MATCH') {
        candidateType = familyRelated ? 'FAMILY_VARIANT' : 'NEAR_OR_POSSIBLE_DUPLICATE';
      } else {
        continue;
      }

      ranked.push(
        this.buildRankedCandidate({
          version,
          candidateType,
          eligibility: true,
          contentGroupId,
          duplicateClassification: openExact.has(version.versionId)
            ? 'EXACT_DUPLICATE'
            : nearClass,
          coverageAssignments: slotAssignments,
          matchedDimensions: contract.matchedDimensions,
          failedDimensions: contract.failedDimensions,
          unknownDimensions: contract.unknownDimensions,
          nutrition: { ...per, servings: version.servings },
          portionAdjustment:
            candidateType === 'PORTION_ADJUSTABLE' || (portion.feasible && portion.multiplier !== 1)
              ? portion
              : portion.feasible && portion.multiplier === 1
                ? portion
                : portion.feasible
                  ? portion
                  : null,
          costStatus: costCrit.costStatus,
          adaptationSummary:
            candidateType === 'SAFE_SUBSTITUTION_ADAPTABLE' ? adaptationSummary : null,
          reasons: [
            ...contract.reasons.map((r) => `${r.code}:${r.outcome}`),
            ...(candidateType === 'PORTION_ADJUSTABLE'
              ? [`PORTION_MULTIPLIER:${portion.multiplier}`]
              : []),
            ...(adaptationSummary ? ['SAFE_SUBSTITUTION_PREVIEW'] : []),
          ],
          hardMatch: contract.hardMatch,
          existingCoverage: primaryCoverage || existingCoverage,
          nutritionFit: nutritionBaseOk ? 1 : portion.feasible ? 0.7 : 0.2,
          primaryProductMatch: dims.productOk,
          cookingMethodMatch: dims.methodOk,
          dietaryOk: dims.dietaryOk === true,
          equipmentOk: dims.equipmentOk,
          timeOk: dims.timeOk,
          costConfidence:
            costCrit.costStatus === 'CURRENT_PRICE_CONFIRMED'
              ? 1
              : costCrit.costStatus === 'NOT_APPLICABLE'
                ? 0.8
                : 0.2,
          familyRelated,
          duplicatePenalty: openExact.has(version.versionId) ? 1 : nearClass ? 0.5 : 0,
          adaptationComplexity: candidateType === 'SAFE_SUBSTITUTION_ADAPTABLE' ? 0.4 : 0,
        }),
      );
    }

    for (const c of ranked) {
      c.score = scoreSearchCandidate(c);
    }
    ranked.sort(compareSearchCandidates);
    let rank = 1;
    for (const c of ranked) {
      c.rank = rank++;
    }

    // Prefer actionable catalog candidates in the recommendation matrix; keep historical for UI context.
    const actionable = ranked.filter((c) => c.candidateType !== 'HISTORICAL_OR_BLOCKED_CONTEXT');
    const top = actionable.slice(0, 40);
    const historicalTop = ranked
      .filter((c) => c.candidateType === 'HISTORICAL_OR_BLOCKED_CONTEXT')
      .slice(0, 5);
    const candidates = [...top, ...historicalTop].sort(compareSearchCandidates);
    let r = 1;
    for (const c of candidates) c.rank = r++;

    const countsByLevel: Record<string, number> = {};
    for (const c of candidates) {
      countsByLevel[c.candidateType] = (countsByLevel[c.candidateType] ?? 0) + 1;
    }

    const hasUnresolvedExactDuplicateBlocker = exactBlockers.size > 0;
    const hasEligibleExactCoverage = actionable.some(
      (c) =>
        c.eligibility &&
        (c.candidateType === 'EXISTING_COVERAGE' || c.candidateType === 'EXACT_SLOT_MATCH') &&
        c.hardMatch,
    );
    const hasPortionAdjustable = actionable.some(
      (c) => c.eligibility && c.candidateType === 'PORTION_ADJUSTABLE',
    );
    const hasSafeAdaptation = actionable.some(
      (c) => c.eligibility && c.candidateType === 'SAFE_SUBSTITUTION_ADAPTABLE',
    );
    const hasFamilyVariant = actionable.some(
      (c) => c.eligibility && c.candidateType === 'FAMILY_VARIANT',
    );
    const hasAnySafeCatalog = eligibleCount > 0 || actionable.length > 0 || !slotContradictory;

    const recommendation = decideSearchRecommendation({
      hasEligibleExactCoverage,
      hasPortionAdjustable,
      hasSafeAdaptation,
      hasFamilyVariant,
      hasUnresolvedExactDuplicateBlocker,
      hasAnySafeCatalog: hasAnySafeCatalog || eligibleCount === 0,
      slotContradictory,
      coverageAnalysisRequired: input.coverageAnalysisRequired,
    });

    // Empty eligible catalog with coherent slot → RESEARCH_REQUIRED (not blocked).
    const finalRecommendation =
      !slotContradictory &&
      !input.coverageAnalysisRequired &&
      !hasUnresolvedExactDuplicateBlocker &&
      eligibleCount === 0 &&
      actionable.length === 0
        ? ('RESEARCH_REQUIRED' as SearchRecommendation)
        : recommendation;

    return {
      searchSchemaVersion: SEARCH_SCHEMA_VERSION,
      matrixVersion: input.slot.matrixVersion,
      coverageSlotId: input.sourceSlotId,
      coverageSlot: input.slot,
      overridesApplied: input.overridesApplied,
      recommendation: finalRecommendation,
      coverageAnalysisRequired: false,
      candidates: candidates.map((c) => this.stripRankMeta(c)),
      exactDuplicateBlockers: [...exactBlockers].sort(),
      eligibleCount,
      blockedHistoricalCount,
      catalogStateChecksum: input.catalogStateChecksum,
      coverageResultChecksum: input.coverageResultChecksum,
      countsByLevel,
      reasons: [
        `recommendation:${finalRecommendation}`,
        `eligible:${eligibleCount}`,
        `actionable:${actionable.length}`,
      ],
    };
  }

  private stripRankMeta(
    c: SearchCandidateOut & Record<string, unknown>,
  ): SearchCandidateOut {
    const out = { ...c } as SearchCandidateOut & Record<string, unknown>;
    for (const key of [
      'hardMatch',
      'existingCoverage',
      'nutritionFit',
      'primaryProductMatch',
      'cookingMethodMatch',
      'dietaryOk',
      'equipmentOk',
      'timeOk',
      'costConfidence',
      'familyRelated',
      'duplicatePenalty',
      'adaptationComplexity',
    ]) {
      delete out[key];
    }
    return out as SearchCandidateOut;
  }

  private buildRankedCandidate(input: {
    version: CatalogVersion;
    candidateType: SearchCandidateType;
    eligibility: boolean;
    contentGroupId: string;
    duplicateClassification: string | null;
    coverageAssignments: Array<{ slotId: string; assignmentType: string; matchStatus: string }>;
    matchedDimensions: string[];
    failedDimensions: string[];
    unknownDimensions: string[];
    nutrition: { calories: number; proteinG: number; fatG: number; servings: number };
    portionAdjustment: SearchCandidateOut['portionAdjustment'];
    costStatus: CoverageCostStatus;
    adaptationSummary: Record<string, unknown> | null;
    reasons: string[];
    hardMatch: boolean;
    existingCoverage: boolean;
    nutritionFit: number;
    primaryProductMatch: boolean;
    cookingMethodMatch: boolean;
    dietaryOk: boolean;
    equipmentOk: boolean;
    timeOk: boolean;
    costConfidence: number;
    familyRelated: boolean;
    duplicatePenalty: number;
    adaptationComplexity: number;
  }) {
    return {
      recipeId: input.version.recipeId,
      recipeVersionId: input.version.versionId,
      recipeFamilyId: input.version.recipeFamilyId,
      title: input.version.title,
      versionNumber: input.version.versionNumber,
      candidateType: input.candidateType,
      eligibility: input.eligibility,
      contentGroupId: input.contentGroupId,
      duplicateClassification: input.duplicateClassification,
      coverageAssignments: input.coverageAssignments,
      matchedDimensions: input.matchedDimensions,
      failedDimensions: input.failedDimensions,
      unknownDimensions: input.unknownDimensions,
      nutrition: input.nutrition,
      portionAdjustment: input.portionAdjustment,
      cookingMethods: input.version.cookingMethod ? [input.version.cookingMethod] : [],
      dietaryCompatibility: input.dietaryOk,
      equipmentCompatibility: input.equipmentOk,
      costStatus: input.costStatus,
      adaptationSummary: input.adaptationSummary,
      reasons: input.reasons,
      score: 0,
      rank: 0,
      hardMatch: input.hardMatch,
      existingCoverage: input.existingCoverage,
      nutritionFit: input.nutritionFit,
      primaryProductMatch: input.primaryProductMatch,
      cookingMethodMatch: input.cookingMethodMatch,
      dietaryOk: input.dietaryOk,
      equipmentOk: input.equipmentOk,
      timeOk: input.timeOk,
      costConfidence: input.costConfidence,
      familyRelated: input.familyRelated,
      duplicatePenalty: input.duplicatePenalty,
      adaptationComplexity: input.adaptationComplexity,
    };
  }

  private async finish(
    runId: string,
    result: Record<string, unknown>,
    resultChecksum: string,
    started: number,
    actorUserId: string | null,
    inputChecksum: string,
  ) {
    const durationMs = Date.now() - started;
    await this.db.query(
      `UPDATE "RecipeSearchBeforeGenerateRun"
       SET status = 'COMPLETED', "completedAt" = now(), "durationMs" = $2,
           "resultJson" = $3::jsonb, "resultChecksum" = $4
       WHERE id = $1`,
      [runId, durationMs, JSON.stringify(result), resultChecksum],
    );
    await this.auditSafe({
      actorUserId,
      action: 'recipe.search.completed',
      entityType: 'RecipeSearchBeforeGenerateRun',
      entityId: runId,
      metadata: {
        recommendation: result.recommendation,
        resultChecksum,
        candidateCount: Array.isArray(result.candidates) ? result.candidates.length : 0,
      },
    });
    return {
      runId,
      inputChecksum,
      resultChecksum,
      durationMs,
      status: 'COMPLETED' as const,
      ...result,
    };
  }

  private async auditRecommendation(
    recommendation: SearchRecommendation,
    actorUserId: string,
    runId: string,
  ) {
    const map: Partial<Record<SearchRecommendation, string>> = {
      USE_EXISTING_RECIPE: 'recipe.search.existing_recommended',
      ADJUST_PORTION_OF_EXISTING: 'recipe.search.adaptation_recommended',
      ADAPT_EXISTING_RECIPE: 'recipe.search.adaptation_recommended',
      CREATE_FAMILY_VARIANT: 'recipe.search.adaptation_recommended',
      REVIEW_DUPLICATE_CANDIDATES: 'recipe.search.duplicate_review_required',
      RESEARCH_REQUIRED: 'recipe.search.research_required',
    };
    const action = map[recommendation];
    if (!action) return;
    await this.auditSafe({
      actorUserId,
      action,
      entityType: 'RecipeSearchBeforeGenerateRun',
      entityId: runId,
      metadata: { recommendation },
    });
  }

  private async auditSafe(input: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.audit?.appendEvent(input);
    } catch {
      // audit must not fail search
    }
  }

  private isVersionInSlotScope(
    slot: SearchSlotSnapshot,
    version: CatalogVersion,
    hasAssignment: boolean,
  ): boolean {
    if (hasAssignment) return true;
    if (!slot.primaryProductId) return true;
    return (
      version.primaryProductId === slot.primaryProductId ||
      version.ingredientProductIds.includes(slot.primaryProductId)
    );
  }

  private async loadSlot(id: string): Promise<(SearchSlotSnapshot & { matrixVersion: string }) | null> {
    const rows = await this.db.query<{
      id: string;
      matrixVersion: string;
      slotKey: string;
      mealType: string;
      primaryProductId: string | null;
      dishType: string;
      cookingMethod: string | null;
      calorieMin: number | null;
      calorieMax: number | null;
      proteinMin: string | null;
      fatMax: string | null;
      maximumTimeMinutes: number | null;
      maximumCost: string | null;
      dietaryProfile: string;
      equipmentProfile: string;
      status: string;
      publishedRecipeCount: number;
      desiredRecipeCount: number;
    }>(`SELECT * FROM "RecipeCoverageSlot" WHERE id = $1`, [id]);
    const row = rows.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      matrixVersion: row.matrixVersion,
      slotKey: row.slotKey,
      mealType: row.mealType,
      primaryProductId: row.primaryProductId,
      dishType: row.dishType,
      cookingMethod: row.cookingMethod,
      calorieMin: row.calorieMin == null ? null : Number(row.calorieMin),
      calorieMax: row.calorieMax == null ? null : Number(row.calorieMax),
      proteinMin: row.proteinMin == null ? null : Number(row.proteinMin),
      fatMax: row.fatMax == null ? null : Number(row.fatMax),
      maximumTimeMinutes: row.maximumTimeMinutes,
      maximumCost: row.maximumCost == null ? null : Number(row.maximumCost),
      dietaryProfile: row.dietaryProfile,
      equipmentProfile: row.equipmentProfile,
      status: row.status,
      publishedRecipeCount: Number(row.publishedRecipeCount),
      desiredRecipeCount: Number(row.desiredRecipeCount),
    };
  }

  private applyOverrides(
    slot: SearchSlotSnapshot & { matrixVersion: string },
    overrides: SearchOverrideInput | null,
  ): SearchSlotSnapshot & { matrixVersion: string } {
    if (!overrides) return slot;
    return {
      ...slot,
      mealType: overrides.mealType ?? slot.mealType,
      primaryProductId:
        overrides.primaryProductId !== undefined ? overrides.primaryProductId : slot.primaryProductId,
      dishType: overrides.dishType ?? slot.dishType,
      cookingMethod:
        overrides.cookingMethod !== undefined ? overrides.cookingMethod : slot.cookingMethod,
      calorieMin: overrides.calorieMin !== undefined ? overrides.calorieMin : slot.calorieMin,
      calorieMax: overrides.calorieMax !== undefined ? overrides.calorieMax : slot.calorieMax,
      proteinMin: overrides.proteinMin !== undefined ? overrides.proteinMin : slot.proteinMin,
      fatMax: overrides.fatMax !== undefined ? overrides.fatMax : slot.fatMax,
      maximumTimeMinutes:
        overrides.maximumTimeMinutes !== undefined
          ? overrides.maximumTimeMinutes
          : slot.maximumTimeMinutes,
      maximumCost: overrides.maximumCost !== undefined ? overrides.maximumCost : slot.maximumCost,
      dietaryProfile: overrides.dietaryProfile ?? slot.dietaryProfile,
      equipmentProfile: overrides.equipmentProfile ?? slot.equipmentProfile,
    };
  }

  private slotFromOverridesOnly(
    overrides: SearchOverrideInput | null,
    matrixVersion: string,
  ): (SearchSlotSnapshot & { matrixVersion: string }) | null {
    if (!overrides?.dishType || !overrides?.mealType || !overrides?.dietaryProfile) return null;
    return {
      id: 'override-only',
      matrixVersion,
      slotKey: 'override-only',
      mealType: overrides.mealType,
      primaryProductId: overrides.primaryProductId ?? null,
      dishType: overrides.dishType,
      cookingMethod: overrides.cookingMethod ?? null,
      calorieMin: overrides.calorieMin ?? null,
      calorieMax: overrides.calorieMax ?? null,
      proteinMin: overrides.proteinMin ?? null,
      fatMax: overrides.fatMax ?? null,
      maximumTimeMinutes: overrides.maximumTimeMinutes ?? null,
      maximumCost: overrides.maximumCost ?? null,
      dietaryProfile: overrides.dietaryProfile,
      equipmentProfile: overrides.equipmentProfile ?? 'BASIC_STOVE',
      status: 'EMPTY',
      publishedRecipeCount: 0,
      desiredRecipeCount: 1,
    };
  }

  private isSlotContradictory(slot: SearchSlotSnapshot): boolean {
    if (
      slot.calorieMin != null &&
      slot.calorieMax != null &&
      Number(slot.calorieMin) > Number(slot.calorieMax)
    ) {
      return true;
    }
    return false;
  }

  private async computeCatalogStateChecksum(matrixVersion: string): Promise<string> {
    const versions = await this.db.query<{
      versionId: string;
      fingerprintHash: string | null;
      lifecycleStatus: string;
      validationStatus: string;
    }>(
      `SELECT v.id AS "versionId", fp."exactContentHash" AS "fingerprintHash",
              l."lifecycleStatus", l."validationStatus"
       FROM "Recipe" r
       JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
       JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       LEFT JOIN "RecipeFingerprint" fp ON fp."recipeVersionId" = v.id
         AND fp."fingerprintSchemaVersion" = 'recipe-fingerprint/v1'
       ORDER BY v.id`,
    );
    const slots = await this.db.query<{ id: string; slotKey: string; status: string; published: number }>(
      `SELECT id, "slotKey", status, "publishedRecipeCount" AS published
       FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = $1 AND active = true
       ORDER BY "slotKey"`,
      [matrixVersion],
    );
    return stableJsonChecksum({
      matrixVersion,
      versions: versions.rows.map((v) => ({
        versionId: v.versionId,
        fingerprintHash: v.fingerprintHash,
        lifecycleStatus: v.lifecycleStatus,
        validationStatus: v.validationStatus,
      })),
      slots: slots.rows,
    });
  }

  private async loadLatestCoverageChecksum(matrixVersion: string): Promise<string | null> {
    const rows = await this.db.query<{ resultChecksum: string | null }>(
      `SELECT "resultChecksum" FROM "RecipeCoverageAnalysisRun"
       WHERE "matrixVersion" = $1
         AND mode = 'FULL'
         AND status IN ('SUCCEEDED','PARTIAL')
         AND "dryRun" = false
       ORDER BY "createdAt" DESC LIMIT 1`,
      [matrixVersion],
    );
    return rows.rows[0]?.resultChecksum ?? null;
  }

  private async loadSlotAssignments(slotId: string) {
    const rows = await this.db.query<{
      slotId: string;
      recipeVersionId: string;
      assignmentType: string;
      matchStatus: string;
    }>(
      `SELECT "slotId", "recipeVersionId", "assignmentType", "matchStatus"
       FROM "RecipeCoverageAssignment"
       WHERE "slotId" = $1 AND active = true`,
      [slotId],
    );
    return rows.rows;
  }

  private async loadOpenExactDuplicates() {
    const map = new Map<string, string>();
    const rows = await this.db.query<{
      leftRecipeVersionId: string;
      rightRecipeVersionId: string;
    }>(
      `SELECT "leftRecipeVersionId", "rightRecipeVersionId"
       FROM "RecipeDuplicateCandidate"
       WHERE classification = 'EXACT_DUPLICATE' AND status = 'OPEN'`,
    );
    for (const row of rows.rows) {
      const group = [row.leftRecipeVersionId, row.rightRecipeVersionId].sort().join(':');
      map.set(row.leftRecipeVersionId, group);
      map.set(row.rightRecipeVersionId, group);
    }
    return map;
  }

  private async loadNearOrPossibleDuplicates() {
    const map = new Map<string, string>();
    const rows = await this.db.query<{
      leftRecipeVersionId: string;
      rightRecipeVersionId: string;
      classification: string;
    }>(
      `SELECT "leftRecipeVersionId", "rightRecipeVersionId", classification
       FROM "RecipeDuplicateCandidate"
       WHERE classification IN ('NEAR_DUPLICATE','POSSIBLE_DUPLICATE')
         AND status IN ('OPEN','CONFIRMED_DUPLICATE')`,
    );
    for (const row of rows.rows) {
      map.set(row.leftRecipeVersionId, row.classification);
      map.set(row.rightRecipeVersionId, row.classification);
    }
    return map;
  }

  private dimensionFlags(slot: SearchSlotSnapshot, version: CatalogVersion) {
    const per = nutritionPerServing({
      calories: version.calories,
      proteinG: version.proteinG,
      fatG: version.fatG,
      servings: version.servings,
    });
    return {
      mealOk: true,
      productOk:
        !slot.primaryProductId ||
        version.primaryProductId === slot.primaryProductId ||
        version.ingredientProductIds.includes(slot.primaryProductId),
      dishOk:
        !version.dishType ||
        version.dishType === 'UNCLASSIFIED' ||
        version.dishType === slot.dishType ||
        (slot.dishType === 'MAIN' && ['MAIN', 'BOWL'].includes(version.dishType)),
      methodOk:
        !slot.cookingMethod || !version.cookingMethod || version.cookingMethod === slot.cookingMethod,
      dietaryOk: dietaryProfileMatches(
        slot.dietaryProfile as CoverageDietaryProfile,
        version.dietaryTags,
        version.compositionKnown,
      ),
      equipmentOk: this.equipmentOk(slot.equipmentProfile, version.equipment),
      calorieOk:
        (slot.calorieMin == null || per.calories >= slot.calorieMin) &&
        (slot.calorieMax == null || per.calories <= slot.calorieMax),
      proteinOk: slot.proteinMin == null || per.proteinG >= slot.proteinMin,
      fatOk: slot.fatMax == null || per.fatG <= slot.fatMax,
      timeOk:
        slot.maximumTimeMinutes == null ||
        version.totalMinutes == null ||
        version.totalMinutes <= slot.maximumTimeMinutes,
    };
  }

  private equipmentOk(profile: string, equipment: string[]): boolean {
    if (profile === 'NO_SPECIAL_EQUIPMENT') {
      const special = ['multicooker', 'мультивар', 'blender', 'блендер', 'grill', 'гриль'];
      return !equipment.some((e) => special.some((s) => e.toLowerCase().includes(s)));
    }
    if (profile === 'BASIC_STOVE') return true;
    if (profile === 'OVEN') return equipment.length === 0 || equipment.some((e) => /oven|духов/i.test(e));
    if (profile === 'MULTICOOKER') return equipment.some((e) => /multicook|мультивар/i.test(e));
    if (profile === 'BLENDER') return equipment.some((e) => /blend|бленд/i.test(e));
    if (profile === 'GRILL') return equipment.some((e) => /grill|гриль/i.test(e));
    return true;
  }

  private async estimateVersionCost(version: CatalogVersion): Promise<{
    cost: number | null;
    status: CoverageCostStatus;
  }> {
    if (!this.prices || version.ingredients.length === 0) {
      return { cost: null, status: 'PRICE_MISSING' };
    }
    const lines = [];
    let anyStale = false;
    let anyIncomplete = false;
    let anyMissing = false;
    for (const ing of version.ingredients) {
      if (!ing.productId) {
        anyMissing = true;
        continue;
      }
      const quote = await this.prices.resolveForProduct(ing.productId);
      if (quote.stale) anyStale = true;
      if (quote.coverage === 'PARTIAL' || quote.provenance === 'PRICE_INCOMPLETE') anyIncomplete = true;
      if (quote.provenance === 'PRICE_MISSING' || quote.packagePriceRub == null) anyMissing = true;
      // Production decisions ignore FIXTURE/TEST_ONLY unless ALLOW_TEST_PRICES=1.
      if (!isProductionPriceDataClass(quote.dataClass) && !allowTestPriceEvidence()) {
        anyMissing = true;
        continue;
      }
      lines.push(
        costForIngredient({
          productId: ing.productId,
          displayName: ing.productId,
          amount: ing.amount,
          unit: ing.unit,
          packageSize: quote.packageWeight,
          packageUnit: quote.packageUnit,
          packagePriceRub: quote.packagePriceRub,
          collectedAt: quote.collectedAt ?? undefined,
        }),
      );
    }
    const summary = summarizeDishCost(lines);
    if (anyMissing && summary.consumedCostRub == null) return { cost: null, status: 'PRICE_MISSING' };
    if (anyMissing) return { cost: summary.consumedCostRub, status: 'PRICE_MISSING' };
    if (anyIncomplete || !summary.complete) {
      return { cost: summary.consumedCostRub, status: 'PRICE_INCOMPLETE' };
    }
    if (anyStale || summary.stale) return { cost: summary.consumedCostRub, status: 'STALE_PRICE' };
    const perServing = (summary.consumedCostRub ?? 0) / Math.max(version.servings, 1);
    return { cost: perServing, status: 'CURRENT_PRICE_CONFIRMED' };
  }

  private async resolveProductDisplayNames(productIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(productIds.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.db.query<{ id: string; label: string }>(
      `SELECT id, COALESCE(NULLIF(TRIM(name), ''), "canonicalName") AS label
       FROM "Product" WHERE id = ANY($1::uuid[])`,
      [unique],
    );
    return new Map(rows.rows.map((r) => [r.id, r.label]));
  }

  private async buildSafeAdaptationPreview(
    version: CatalogVersion,
    edge: ProductSubstitutionEdge,
    sourceProductId: string,
    replacementProductId: string,
    names: Map<string, string>,
  ) {
    const sourceIng = version.ingredients.find((i) => i.productId === sourceProductId);
    const ratio = edge.replacementRatio;
    const adjustedQuantity =
      sourceIng && Number.isFinite(ratio) && ratio > 0
        ? { amount: Number((sourceIng.amount * ratio).toFixed(4)), unit: sourceIng.unit }
        : undefined;
    const cookingMethodCompatible =
      version.cookingMethod != null &&
      (edge.supportedMethods.length === 0 ||
        methodCompatible(edge.supportedMethods, version.cookingMethod));

    return {
      mutatesCanonicalRecipeVersion: false,
      previewOnly: true,
      sourceProductId,
      replacementProductId,
      sourceProductName: names.get(sourceProductId) ?? null,
      replacementProductName: names.get(replacementProductId) ?? null,
      edgeId: edge.id,
      curatedLabel: 'Проверенная замена',
      cookingMethodCompatible,
      ratio,
      ...(adjustedQuantity ? { adjustedQuantity } : {}),
      note: 'SAFE_SUBSTITUTION_PREVIEW',
    };
  }

  private async previewSafeAdaptation(version: CatalogVersion, slotPrimaryProductId: string) {
    if (!this.substitutions) return null;
    // Preview only: find ACTIVE substitution edges from ingredients toward slot primary (or reverse).
    const edgesFromPrimary = await this.substitutions.listActiveForSource(slotPrimaryProductId, {
      cookingMethod: version.cookingMethod,
    });
    const matching = edgesFromPrimary.filter((e) =>
      version.ingredientProductIds.includes(e.replacementProductId),
    );
    if (!matching.length) {
      // Try: recipe ingredient → slot primary as replacement
      for (const productId of version.ingredientProductIds.slice(0, 8)) {
        const edges = await this.substitutions.listActiveForSource(productId, {
          cookingMethod: version.cookingMethod,
        });
        const hit = edges.find((e) => e.replacementProductId === slotPrimaryProductId);
        if (hit) {
          const names = await this.resolveProductDisplayNames([productId, slotPrimaryProductId]);
          return this.buildSafeAdaptationPreview(
            version,
            hit,
            productId,
            slotPrimaryProductId,
            names,
          );
        }
      }
      return null;
    }
    const edge = matching[0]!;
    const names = await this.resolveProductDisplayNames([
      slotPrimaryProductId,
      edge.replacementProductId,
    ]);
    return this.buildSafeAdaptationPreview(
      version,
      edge,
      slotPrimaryProductId,
      edge.replacementProductId,
      names,
    );
  }

  private async loadEligibleCandidates(): Promise<CatalogVersion[]> {
    const rows = await this.db.query<{
      recipeId: string;
      recipeKey: string | null;
      title: string;
      recipeFamilyId: string | null;
      versionId: string;
      versionNumber: number;
      servings: number;
      calories: string;
      proteinG: string;
      fatG: string;
      dishType: string | null;
      primaryProductId: string | null;
      dietaryTags: unknown;
      equipment: unknown;
      prepMinutes: number | null;
      cookMinutes: number | null;
      contentSnapshotJson: { description?: string; prepMinutes?: number; cookMinutes?: number };
      stepsSnapshotJson: Array<{ instruction?: string; equipment?: string | null }>;
      ingredientsSnapshotJson: Array<{ productId?: string; amount?: number; unit?: string }>;
      lifecycleStatus: string;
      validationStatus: string;
      hasFingerprint: boolean;
      fingerprintHash: string | null;
      isCurrent: boolean;
    }>(
      `SELECT r.id AS "recipeId", r."recipeKey", COALESCE(r."dataClass", 'PRODUCTION') AS "dataClass",
              r.name AS title, r."recipeFamilyId",
              v.id AS "versionId", v."versionNumber", v.servings,
              COALESCE((v."nutritionSnapshotJson"->>'calories')::numeric, 0)::text AS calories,
              COALESCE((v."nutritionSnapshotJson"->>'proteinG')::numeric, 0)::text AS "proteinG",
              COALESCE((v."nutritionSnapshotJson"->>'fatG')::numeric, 0)::text AS "fatG",
              f."dishType", f."primaryProductId",
              r."dietaryTags", r.equipment, r."prepMinutes", r."cookMinutes",
              v."contentSnapshotJson", v."stepsSnapshotJson", v."ingredientsSnapshotJson",
              l."lifecycleStatus", l."validationStatus",
              (fp.id IS NOT NULL) AS "hasFingerprint",
              fp."exactContentHash" AS "fingerprintHash",
              (r."currentVersionId" = v.id) AS "isCurrent"
       FROM "Recipe" r
       JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
       JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       LEFT JOIN "RecipeFamily" f ON f.id = r."recipeFamilyId"
       LEFT JOIN "RecipeFingerprint" fp ON fp."recipeVersionId" = v.id
         AND fp."fingerprintSchemaVersion" = 'recipe-fingerprint/v1'`,
    );

    const out: CatalogVersion[] = [];
    for (const row of rows.rows) {
      if (isTestOnlyRecipeKey(row.recipeKey)) {
        // still load for HISTORICAL context via eligibility check below
      }
      const methods = inferCookingMethodsFromRecipeText({
        description: row.contentSnapshotJson?.description,
        stepInstructions: (row.stepsSnapshotJson ?? []).map((s) => s.instruction ?? ''),
      });
      const equipment = [
        ...((Array.isArray(row.equipment) ? row.equipment : []) as string[]),
        ...((row.stepsSnapshotJson ?? []).map((s) => s.equipment).filter(Boolean) as string[]),
      ];
      const dietaryTags = Array.isArray(row.dietaryTags)
        ? (row.dietaryTags as string[])
        : typeof row.dietaryTags === 'string'
          ? [row.dietaryTags]
          : [];
      const prep = row.contentSnapshotJson?.prepMinutes ?? row.prepMinutes;
      const cook = row.contentSnapshotJson?.cookMinutes ?? row.cookMinutes;
      out.push({
        recipeId: row.recipeId,
        recipeKey: row.recipeKey,
        dataClass: (row as { dataClass?: string }).dataClass ?? 'PRODUCTION',
        title: row.title,
        recipeFamilyId: row.recipeFamilyId,
        versionId: row.versionId,
        versionNumber: Number(row.versionNumber) || 1,
        servings: Number(row.servings) || 1,
        calories: Number(row.calories),
        proteinG: Number(row.proteinG),
        fatG: Number(row.fatG),
        dishType: row.dishType,
        primaryProductId: row.primaryProductId,
        dietaryTags,
        compositionKnown: dietaryTags.length > 0 && !dietaryTags.includes('UNKNOWN'),
        equipment,
        cookingMethod: primaryCookingMethod(methods),
        totalMinutes: prep != null || cook != null ? Number(prep ?? 0) + Number(cook ?? 0) : null,
        lifecycleStatus: row.lifecycleStatus,
        validationStatus: row.validationStatus,
        hasFingerprint: row.hasFingerprint,
        fingerprintHash: row.fingerprintHash,
        isCurrent: row.isCurrent,
        ingredientProductIds: (row.ingredientsSnapshotJson ?? [])
          .map((i) => i.productId)
          .filter(Boolean) as string[],
        ingredients: (row.ingredientsSnapshotJson ?? []).map((i) => ({
          productId: i.productId ?? null,
          amount: Number(i.amount ?? 0),
          unit: String(i.unit ?? 'g'),
        })),
      });
    }
    return out;
  }

  /**
   * STEP_211 user hard filters — structured allergen/diet/equipment codes only.
   * Legacy foodRestrictions / availableEquipment free-text must never be interpreted here.
   */
  private async loadUserHardFilterProfile(userId: string) {
    const row = await this.db.query<{
      allergenCodesJson: unknown;
      dietaryCodesJson: unknown;
      equipmentCodesJson: unknown;
      intoleranceCodesJson: unknown;
    }>(
      `SELECT COALESCE("allergenCodesJson", '[]'::jsonb) AS "allergenCodesJson",
              COALESCE("dietaryCodesJson", '[]'::jsonb) AS "dietaryCodesJson",
              COALESCE("equipmentCodesJson", '[]'::jsonb) AS "equipmentCodesJson",
              COALESCE("intoleranceCodesJson", '[]'::jsonb) AS "intoleranceCodesJson"
       FROM "UserProfile" WHERE "userId" = $1 LIMIT 1`,
      [userId],
    );
    const r = row.rows[0];
    if (!r) return null;
    const asCodes = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    return hardFilterProfileFromStructured({
      allergenCodes: asCodes(r.allergenCodesJson),
      dietaryCodes: asCodes(r.dietaryCodesJson),
      equipmentCodes: asCodes(r.equipmentCodesJson),
      intoleranceCodes: asCodes(r.intoleranceCodesJson),
    });
  }
}
