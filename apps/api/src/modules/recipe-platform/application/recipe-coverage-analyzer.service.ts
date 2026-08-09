import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import { ProductPriceResolver } from '../../product-catalog/application/product-roles-retail.resolvers';
import { inferCookingMethodsFromRecipeText, primaryCookingMethod } from '../../product-catalog/domain/product-roles-retail.policy';
import { costForIngredient, summarizeDishCost } from '../../meal-plan/domain/meal-dish.pricing';
import {
  allowTestPriceEvidence,
  isProductionPriceDataClass,
} from '../../product-catalog/domain/price-data-class.policy';
import {
  COVERAGE_ANALYZER_LOCK_KEY,
  COVERAGE_ANALYZER_VERSION,
  COVERAGE_DIRTY_DEBOUNCE_MS,
  COVERAGE_MATRIX_VERSION_V1,
  COVERAGE_PRIMARY_SCORE_GAP,
  COVERAGE_PRIMARY_SCORE_THRESHOLD,
  COVERAGE_STALE_RUN_MS,
  computeCoverageStatus,
  countsTowardPublished,
  dietaryProfileMatches,
  evaluateCoverageMatch,
  isEligibleCoverageVersion,
  mergeDirtyReasonSets,
  mergeIdSets,
  nutritionPerServing,
  resolveCostCriterion,
  stableJsonChecksum,
  type CoverageCostStatus,
  type CoverageDietaryProfile,
  type CoverageMatchContract,
} from '../domain/recipe-coverage.policy';

export type AnalyzerMode = 'FULL' | 'INCREMENTAL_SLOTS' | 'INCREMENTAL_RECIPES';
export type AnalyzerTriggerType = 'MANUAL' | 'SCHEDULED' | 'DIRTY_QUEUE' | 'SYSTEM' | 'SEED';

export type AnalyzeRequest = {
  matrixVersion?: string;
  mode: AnalyzerMode;
  slotIds?: string[];
  recipeVersionIds?: string[];
  reason: string;
  dryRun?: boolean;
  triggerType?: AnalyzerTriggerType;
  requestedBy?: string | null;
  actorRole?: string;
};

export type ProposedAssignment = {
  slotId: string;
  recipeVersionId: string;
  assignmentType: 'PRIMARY' | 'SECONDARY' | 'MANUAL_OVERRIDE';
  matchStatus: string;
  matchScore: number;
  contentGroupId: string;
  costStatus: CoverageCostStatus;
  matchContract: CoverageMatchContract;
  preserve?: boolean;
};

@Injectable()
export class RecipeCoverageAnalyzer {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(ProductPriceResolver) private readonly prices?: ProductPriceResolver,
  ) {}

  async analyze(input: AnalyzeRequest) {
    const matrixVersion = input.matrixVersion ?? COVERAGE_MATRIX_VERSION_V1;
    if (!String(input.reason ?? '').trim()) throw new Error('COVERAGE_ANALYZE_REASON_REQUIRED');
    if (input.mode !== 'FULL' && input.mode !== 'INCREMENTAL_SLOTS' && input.mode !== 'INCREMENTAL_RECIPES') {
      throw new Error('COVERAGE_ANALYZE_MODE_INVALID');
    }
    if (input.mode === 'INCREMENTAL_SLOTS' && !(input.slotIds?.length)) {
      throw new Error('COVERAGE_ANALYZE_SLOT_IDS_REQUIRED');
    }
    if (input.mode === 'INCREMENTAL_RECIPES' && !(input.recipeVersionIds?.length)) {
      throw new Error('COVERAGE_ANALYZE_RECIPE_IDS_REQUIRED');
    }

    await this.failStaleRuns(matrixVersion);

    const dryRun = Boolean(input.dryRun);
    const triggerType = input.triggerType ?? 'MANUAL';
    const runInsert = await this.db.query<{ id: string }>(
      `INSERT INTO "RecipeCoverageAnalysisRun" (
         "matrixVersion", mode, "triggerType", reason, status, "dryRun", "requestedBy", "startedAt"
       ) VALUES ($1,$2,$3,$4,'QUEUED',$5,$6,now())
       RETURNING id`,
      [matrixVersion, input.mode, triggerType, input.reason.trim(), dryRun, input.requestedBy ?? null],
    );
    const runId = runInsert.rows[0]!.id;

    await this.audit?.appendEvent({
      actorUserId: input.requestedBy ?? null,
      action: 'recipe.coverage.analysis_requested',
      entityType: 'RecipeCoverageAnalysisRun',
      entityId: runId,
      metadata: { matrixVersion, mode: input.mode, dryRun, reason: input.reason },
    });

    if (!dryRun) {
      const started = Date.now();
      try {
        const lockedRun = await this.db.withSessionAdvisoryLock(
          COVERAGE_ANALYZER_LOCK_KEY,
          matrixVersion,
          async () => {
            await this.db.query(`UPDATE "RecipeCoverageAnalysisRun" SET status = 'RUNNING' WHERE id = $1`, [runId]);
            const result = await this.executeAnalysis({
              runId,
              matrixVersion,
              mode: input.mode,
              slotIds: input.slotIds,
              recipeVersionIds: input.recipeVersionIds,
              dryRun,
              requestedBy: input.requestedBy,
            });
            const durationMs = Date.now() - started;
            const runStatus =
              result.ambiguousMatches > 0 || result.needsReviewAssignments > 0 ? 'PARTIAL' : 'SUCCEEDED';
            await this.finishRun(runId, {
              status: runStatus,
              inputChecksum: result.inputChecksum,
              resultChecksum: result.resultChecksum,
              durationMs,
              slotCount: result.slotsAnalyzed,
              eligibleRecipeCount: result.eligibleRecipeCount,
              comparisonCount: result.comparisonsEvaluated,
              resultJson: result,
            });
            if (input.mode === 'FULL') {
              await this.clearProcessedDirty(matrixVersion, result.dirtySnapshotAt);
            }
            await this.audit?.appendEvent({
              actorUserId: input.requestedBy ?? null,
              action: 'recipe.coverage.analysis_completed',
              entityType: 'RecipeCoverageAnalysisRun',
              entityId: runId,
              metadata: {
                status: runStatus,
                semantic: result.semantic,
                inputChecksum: result.inputChecksum,
                resultChecksum: result.resultChecksum,
                assignmentsCreated: result.assignmentsCreated,
                assignmentsUpdated: result.assignmentsUpdated,
                assignmentsStaled: result.assignmentsStaled,
              },
            });
            return { runId, ...result, status: runStatus, durationMs };
          },
        );
        if (!lockedRun.acquired) {
          await this.finishRun(runId, {
            status: 'CANCELLED',
            errorCode: 'ALREADY_RUNNING',
            errorSummary: 'Another applying analysis holds the matrix lock',
            resultJson: { semantic: 'ALREADY_RUNNING' },
          });
          throw Object.assign(new Error('COVERAGE_ANALYSIS_ALREADY_RUNNING'), { runId });
        }
        return lockedRun.result;
      } catch (error) {
        if ((error as Error).message === 'COVERAGE_ANALYSIS_ALREADY_RUNNING') throw error;
        const summary = error instanceof Error ? error.message : 'COVERAGE_ANALYSIS_FAILED';
        await this.finishRun(runId, {
          status: 'FAILED',
          errorCode: 'ANALYSIS_FAILED',
          errorSummary: summary.slice(0, 500),
          durationMs: Date.now() - started,
          resultJson: { semantic: 'FAILED' },
        });
        await this.audit?.appendEvent({
          actorUserId: input.requestedBy ?? null,
          action: 'recipe.coverage.analysis_failed',
          entityType: 'RecipeCoverageAnalysisRun',
          entityId: runId,
          metadata: { error: summary.slice(0, 200) },
        });
        throw error;
      }
    }

    const startedDry = Date.now();
    try {
      await this.db.query(`UPDATE "RecipeCoverageAnalysisRun" SET status = 'RUNNING' WHERE id = $1`, [runId]);
      const result = await this.executeAnalysis({
        runId,
        matrixVersion,
        mode: input.mode,
        slotIds: input.slotIds,
        recipeVersionIds: input.recipeVersionIds,
        dryRun: true,
        requestedBy: input.requestedBy,
      });
      const durationMs = Date.now() - startedDry;
      const runStatus =
        result.ambiguousMatches > 0 || result.needsReviewAssignments > 0 ? 'PARTIAL' : 'SUCCEEDED';
      await this.finishRun(runId, {
        status: runStatus,
        inputChecksum: result.inputChecksum,
        resultChecksum: result.resultChecksum,
        durationMs,
        slotCount: result.slotsAnalyzed,
        eligibleRecipeCount: result.eligibleRecipeCount,
        comparisonCount: result.comparisonsEvaluated,
        resultJson: result,
      });
      await this.audit?.appendEvent({
        actorUserId: input.requestedBy ?? null,
        action: 'recipe.coverage.analysis_completed',
        entityType: 'RecipeCoverageAnalysisRun',
        entityId: runId,
        metadata: {
          status: runStatus,
          semantic: result.semantic,
          dryRun: true,
          inputChecksum: result.inputChecksum,
          resultChecksum: result.resultChecksum,
        },
      });
      return { runId, ...result, status: runStatus, durationMs };
    } catch (error) {
      const summary = error instanceof Error ? error.message : 'COVERAGE_ANALYSIS_FAILED';
      await this.finishRun(runId, {
        status: 'FAILED',
        errorCode: 'ANALYSIS_FAILED',
        errorSummary: summary.slice(0, 500),
        durationMs: Date.now() - startedDry,
        resultJson: { semantic: 'FAILED' },
      });
      await this.audit?.appendEvent({
        actorUserId: input.requestedBy ?? null,
        action: 'recipe.coverage.analysis_failed',
        entityType: 'RecipeCoverageAnalysisRun',
        entityId: runId,
        metadata: { error: summary.slice(0, 200) },
      });
      throw error;
    }
  }

  async markDirty(input: {
    matrixVersion?: string;
    reasons: string[];
    slotIds?: string[];
    recipeVersionIds?: string[];
    debounceMs?: number;
  }) {
    const matrixVersion = input.matrixVersion ?? COVERAGE_MATRIX_VERSION_V1;
    const debounceMs = input.debounceMs ?? COVERAGE_DIRTY_DEBOUNCE_MS;
    const existing = await this.db.query<{
      reasonSetJson: unknown;
      affectedSlotIdsJson: unknown;
      affectedRecipeVersionIdsJson: unknown;
      nextEligibleRunAt: Date;
    }>(`SELECT * FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`, [matrixVersion]);

    const reasons = mergeDirtyReasonSets(
      Array.isArray(existing.rows[0]?.reasonSetJson) ? (existing.rows[0]!.reasonSetJson as string[]) : [],
      input.reasons,
    );
    const slotIds = mergeIdSets(
      Array.isArray(existing.rows[0]?.affectedSlotIdsJson)
        ? (existing.rows[0]!.affectedSlotIdsJson as string[])
        : [],
      input.slotIds ?? [],
    );
    const recipeVersionIds = mergeIdSets(
      Array.isArray(existing.rows[0]?.affectedRecipeVersionIdsJson)
        ? (existing.rows[0]!.affectedRecipeVersionIdsJson as string[])
        : [],
      input.recipeVersionIds ?? [],
    );
    const nextEligible = new Date(Date.now() + debounceMs);

    await this.db.query(
      `INSERT INTO "RecipeCoverageDirtyState" (
         "matrixVersion", "dirtySince", "nextEligibleRunAt", "reasonSetJson",
         "affectedSlotIdsJson", "affectedRecipeVersionIdsJson", "updatedAt"
       ) VALUES ($1, now(), $2, $3::jsonb, $4::jsonb, $5::jsonb, now())
       ON CONFLICT ("matrixVersion") DO UPDATE SET
         "nextEligibleRunAt" = GREATEST("RecipeCoverageDirtyState"."nextEligibleRunAt", EXCLUDED."nextEligibleRunAt"),
         "reasonSetJson" = EXCLUDED."reasonSetJson",
         "affectedSlotIdsJson" = EXCLUDED."affectedSlotIdsJson",
         "affectedRecipeVersionIdsJson" = EXCLUDED."affectedRecipeVersionIdsJson",
         "updatedAt" = now()`,
      [matrixVersion, nextEligible.toISOString(), JSON.stringify(reasons), JSON.stringify(slotIds), JSON.stringify(recipeVersionIds)],
    );
    return { matrixVersion, reasons, slotIds, recipeVersionIds, nextEligibleRunAt: nextEligible };
  }

  async getDirty(matrixVersion: string = COVERAGE_MATRIX_VERSION_V1) {
    const row = await this.db.query(`SELECT * FROM "RecipeCoverageDirtyState" WHERE "matrixVersion" = $1`, [
      matrixVersion,
    ]);
    return row.rows[0] ?? null;
  }

  async listRuns(matrixVersion: string = COVERAGE_MATRIX_VERSION_V1, limit = 20) {
    const rows = await this.db.query(
      `SELECT id, "matrixVersion", mode, "triggerType", reason, status, "dryRun",
              "inputChecksum", "resultChecksum", "requestedBy", "startedAt", "completedAt",
              "durationMs", "slotCount", "eligibleRecipeCount", "comparisonCount",
              "errorCode", "errorSummary", "createdAt"
       FROM "RecipeCoverageAnalysisRun"
       WHERE "matrixVersion" = $1
       ORDER BY "createdAt" DESC
       LIMIT $2`,
      [matrixVersion, limit],
    );
    return rows.rows;
  }

  async getRun(runId: string) {
    const row = await this.db.query(`SELECT * FROM "RecipeCoverageAnalysisRun" WHERE id = $1`, [runId]);
    return row.rows[0] ?? null;
  }

  async processDirtyQueue(matrixVersion = COVERAGE_MATRIX_VERSION_V1) {
    const dirty = await this.getDirty(matrixVersion);
    if (!dirty) return null;
    if (new Date(dirty.nextEligibleRunAt).getTime() > Date.now()) return { deferred: true, dirty };
    const reasons = Array.isArray(dirty.reasonSetJson) ? (dirty.reasonSetJson as string[]) : [];
    const slotIds = Array.isArray(dirty.affectedSlotIdsJson) ? (dirty.affectedSlotIdsJson as string[]) : [];
    const recipeVersionIds = Array.isArray(dirty.affectedRecipeVersionIdsJson)
      ? (dirty.affectedRecipeVersionIdsJson as string[])
      : [];

    const mode: AnalyzerMode =
      slotIds.length && !recipeVersionIds.length
        ? 'INCREMENTAL_SLOTS'
        : recipeVersionIds.length && !slotIds.length
          ? 'INCREMENTAL_RECIPES'
          : slotIds.length || recipeVersionIds.length
            ? recipeVersionIds.length
              ? 'INCREMENTAL_RECIPES'
              : 'INCREMENTAL_SLOTS'
            : 'FULL';

    return this.analyze({
      matrixVersion,
      mode: mode === 'INCREMENTAL_SLOTS' && !slotIds.length ? 'FULL' : mode === 'INCREMENTAL_RECIPES' && !recipeVersionIds.length ? 'FULL' : mode,
      slotIds: mode === 'INCREMENTAL_SLOTS' ? slotIds : undefined,
      recipeVersionIds: mode === 'INCREMENTAL_RECIPES' ? recipeVersionIds : undefined,
      reason: `dirty:${reasons.join(',') || 'unknown'}`,
      triggerType: 'DIRTY_QUEUE',
      dryRun: false,
    });
  }

  async maybeScheduledFull(matrixVersion = COVERAGE_MATRIX_VERSION_V1) {
    const last = await this.db.query<{ createdAt: Date }>(
      `SELECT "createdAt" FROM "RecipeCoverageAnalysisRun"
       WHERE "matrixVersion" = $1 AND mode = 'FULL' AND status IN ('SUCCEEDED','PARTIAL') AND "dryRun" = false
       ORDER BY "createdAt" DESC LIMIT 1`,
      [matrixVersion],
    );
    const lastAt = last.rows[0]?.createdAt ? new Date(last.rows[0].createdAt).getTime() : 0;
    if (Date.now() - lastAt < 24 * 60 * 60 * 1000) return null;
    await this.markDirty({
      matrixVersion,
      reasons: ['SCHEDULED_DAILY'],
      debounceMs: 0,
    });
    return this.analyze({
      matrixVersion,
      mode: 'FULL',
      reason: 'scheduled daily safety FULL',
      triggerType: 'SCHEDULED',
      dryRun: false,
    });
  }

  private async executeAnalysis(input: {
    runId: string;
    matrixVersion: string;
    mode: AnalyzerMode;
    slotIds?: string[];
    recipeVersionIds?: string[];
    dryRun: boolean;
    requestedBy?: string | null;
  }) {
    const dirtySnapshotAt = new Date().toISOString();
    const slots = await this.loadSlots(input.matrixVersion, input.mode, input.slotIds, input.recipeVersionIds);
    const versions = await this.loadEligibleCandidates(input.recipeVersionIds);
    const exactGroups = await this.loadExactDuplicateGroups();
    const contentGroupCount = new Set(
      versions.map((v) => exactGroups.get(v.versionId) ?? v.recipeId),
    ).size;

    const costCache = new Map<string, { cost: number | null; status: CoverageCostStatus }>();
    const inputPayload = {
      analyzerVersion: COVERAGE_ANALYZER_VERSION,
      matrixVersion: input.matrixVersion,
      mode: input.mode,
      slots: slots.map((s) => ({
        id: s.id,
        slotKey: s.slotKey,
        desiredRecipeCount: Number(s.desiredRecipeCount),
        maximumCost: s.maximumCost == null ? null : Number(s.maximumCost),
        primaryProductId: s.primaryProductId,
        dishType: s.dishType,
        cookingMethod: s.cookingMethod,
        calorieMin: s.calorieMin,
        calorieMax: s.calorieMax,
        proteinMin: s.proteinMin,
        fatMax: s.fatMax,
        maximumTimeMinutes: s.maximumTimeMinutes,
        dietaryProfile: s.dietaryProfile,
        equipmentProfile: s.equipmentProfile,
        active: s.active,
      })),
      versions: versions.map((v) => ({
        versionId: v.versionId,
        recipeId: v.recipeId,
        fingerprintHash: v.fingerprintHash,
        dishType: v.dishType,
        primaryProductId: v.primaryProductId,
        calories: v.calories,
        proteinG: v.proteinG,
        fatG: v.fatG,
        servings: v.servings,
        cookingMethod: v.cookingMethod,
        totalMinutes: v.totalMinutes,
        dietaryTags: v.dietaryTags,
        equipment: v.equipment,
        ingredientProductIds: [...v.ingredientProductIds].sort(),
      })),
      duplicateGroups: [...exactGroups.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
    const inputChecksum = stableJsonChecksum(inputPayload);

    let comparisons = 0;
    let exactMatches = 0;
    let partialMatches = 0;
    let ambiguousMatches = 0;
    let noMatch = 0;
    const proposed: ProposedAssignment[] = [];
    const usedPrimaryVersions = new Set<string>();
    const usedPrimaryGroups = new Set<string>();
    const warnings: string[] = [];

    // Preserve MANUAL_OVERRIDE rows (validated or marked STALE).
    const overrides = await this.loadManualOverrides(input.matrixVersion, slots.map((s) => s.id));

    for (const slot of slots) {
      const candidates = this.blockCandidates(slot, versions);
      const matches: Array<{
        version: EligibleVersion;
        contract: CoverageMatchContract;
        groupId: string;
      }> = [];

      for (const version of candidates) {
        comparisons += 1;
        const groupId = exactGroups.get(version.versionId) ?? version.recipeId;
        let costInfo = costCache.get(version.versionId);
        if (!costInfo && slot.maximumCost != null) {
          costInfo = await this.estimateVersionCost(version);
          costCache.set(version.versionId, costInfo);
        } else if (!costInfo) {
          costInfo = { cost: null, status: 'NOT_APPLICABLE' };
        }
        const costCrit = resolveCostCriterion({
          maximumCost: slot.maximumCost == null ? null : Number(slot.maximumCost),
          consumedCostPerServing: costInfo.cost,
          costStatus: costInfo.status,
        });
        const dims = this.dimensionFlags(slot, version);
        const contract = evaluateCoverageMatch({
          eligible: true,
          contentGroupId: groupId,
          ...dims,
          costConstrained: costCrit.costConstrained,
          costStatus: costCrit.costStatus,
          costOk: costCrit.costOk,
        });
        if (contract.matchStatus === 'EXACT_MATCH') exactMatches += 1;
        else if (contract.matchStatus === 'PARTIAL_MATCH') partialMatches += 1;
        else if (contract.matchStatus === 'NO_MATCH' || contract.matchStatus === 'INELIGIBLE') noMatch += 1;

        if (contract.matchStatus === 'NO_MATCH' || contract.matchStatus === 'INELIGIBLE') continue;
        if (contract.score < 0.5 && !contract.hardMatch) continue;
        matches.push({ version, contract, groupId });
      }

      matches.sort(
        (a, b) =>
          Number(b.contract.hardMatch) - Number(a.contract.hardMatch) ||
          b.contract.score - a.contract.score ||
          a.version.versionId.localeCompare(b.version.versionId),
      );

      const hard = matches.filter((m) => m.contract.hardMatch);
      const uniqueHardByGroup = this.dedupeByGroup(hard);

      if (
        uniqueHardByGroup.length === 1 ||
        (uniqueHardByGroup.length > 1 &&
          uniqueHardByGroup[0]!.contract.score - (uniqueHardByGroup[1]?.contract.score ?? 0) >=
            COVERAGE_PRIMARY_SCORE_GAP &&
          uniqueHardByGroup[0]!.contract.score >= COVERAGE_PRIMARY_SCORE_THRESHOLD)
      ) {
        const best = uniqueHardByGroup[0]!;
        const versionKey = best.version.versionId;
        const groupKey = `${slot.id}:${best.groupId}`;
        if (!usedPrimaryVersions.has(versionKey) && !usedPrimaryGroups.has(groupKey)) {
          proposed.push({
            slotId: slot.id,
            recipeVersionId: best.version.versionId,
            assignmentType: 'PRIMARY',
            matchStatus: 'EXACT_MATCH',
            matchScore: best.contract.score,
            contentGroupId: best.groupId,
            costStatus: best.contract.costStatus,
            matchContract: { ...best.contract, assignmentRecommendation: 'PRIMARY' },
          });
          usedPrimaryVersions.add(versionKey);
          usedPrimaryGroups.add(groupKey);
        }
      } else if (uniqueHardByGroup.length > 1) {
        ambiguousMatches += 1;
        for (const m of uniqueHardByGroup.slice(0, 3)) {
          proposed.push({
            slotId: slot.id,
            recipeVersionId: m.version.versionId,
            assignmentType: 'SECONDARY',
            matchStatus: 'AMBIGUOUS',
            matchScore: m.contract.score,
            contentGroupId: m.groupId,
            costStatus: m.contract.costStatus,
            matchContract: { ...m.contract, matchStatus: 'AMBIGUOUS', assignmentRecommendation: 'NEEDS_REVIEW' },
          });
        }
      }

      for (const m of matches.filter((x) => x.contract.matchStatus === 'PARTIAL_MATCH').slice(0, 3)) {
        proposed.push({
          slotId: slot.id,
          recipeVersionId: m.version.versionId,
          assignmentType: 'SECONDARY',
          matchStatus: 'PARTIAL_MATCH',
          matchScore: m.contract.score,
          contentGroupId: m.groupId,
          costStatus: m.contract.costStatus,
          matchContract: m.contract,
        });
      }

      // Manual overrides
      for (const ov of overrides.filter((o) => o.slotId === slot.id)) {
        const version = versions.find((v) => v.versionId === ov.recipeVersionId);
        if (!version) {
          proposed.push({
            slotId: slot.id,
            recipeVersionId: ov.recipeVersionId,
            assignmentType: 'MANUAL_OVERRIDE',
            matchStatus: 'STALE',
            matchScore: Number(ov.matchScore ?? 1),
            contentGroupId: ov.contentGroupId ?? ov.recipeVersionId,
            costStatus: 'NOT_APPLICABLE',
            matchContract: {
              eligibility: false,
              hardMatch: false,
              matchStatus: 'STALE',
              score: 0,
              matchedDimensions: [],
              failedDimensions: ['ELIGIBILITY'],
              unknownDimensions: [],
              warnings: ['MANUAL_OVERRIDE_VERSION_INELIGIBLE'],
              costStatus: 'NOT_APPLICABLE',
              duplicateContentGroupId: ov.contentGroupId ?? ov.recipeVersionId,
              assignmentRecommendation: 'STALE',
              reasons: [{ code: 'ELIGIBILITY', outcome: 'failed' }],
            },
            preserve: true,
          });
          warnings.push(`override_stale:${ov.id}`);
          continue;
        }
        const dims = this.dimensionFlags(slot, version);
        let costInfo = costCache.get(version.versionId);
        if (!costInfo && slot.maximumCost != null) {
          costInfo = await this.estimateVersionCost(version);
          costCache.set(version.versionId, costInfo);
        } else if (!costInfo) {
          costInfo = { cost: null, status: 'NOT_APPLICABLE' };
        }
        const costCrit = resolveCostCriterion({
          maximumCost: slot.maximumCost == null ? null : Number(slot.maximumCost),
          consumedCostPerServing: costInfo.cost,
          costStatus: costInfo.status,
        });
        const contract = evaluateCoverageMatch({
          eligible: true,
          contentGroupId: exactGroups.get(version.versionId) ?? version.recipeId,
          ...dims,
          costConstrained: costCrit.costConstrained,
          costStatus: costCrit.costStatus,
          costOk: costCrit.costOk,
        });
        const stale = !contract.hardMatch;
        proposed.push({
          slotId: slot.id,
          recipeVersionId: version.versionId,
          assignmentType: 'MANUAL_OVERRIDE',
          matchStatus: stale ? 'STALE' : 'EXACT_MATCH',
          matchScore: contract.score,
          contentGroupId: contract.duplicateContentGroupId,
          costStatus: contract.costStatus,
          matchContract: {
            ...contract,
            matchStatus: stale ? 'STALE' : contract.matchStatus,
            assignmentRecommendation: stale ? 'STALE' : 'PRIMARY',
            warnings: stale
              ? [...contract.warnings, 'MANUAL_OVERRIDE_INVALID']
              : contract.warnings,
          },
          preserve: true,
        });
        if (stale) warnings.push(`override_invalid:${ov.id}`);
      }
    }

    const slotCountPlan = this.planSlotCounts(slots, proposed);
    const resultPayload = {
      analyzerVersion: COVERAGE_ANALYZER_VERSION,
      // Deterministic applied-state identity (PRIMARY/OVERRIDE + counts). Secondary review rows are evidence-only.
      proposed: proposed
        .filter((p) => p.assignmentType === 'PRIMARY' || p.assignmentType === 'MANUAL_OVERRIDE')
        .map((p) => ({
          slotId: p.slotId,
          recipeVersionId: p.recipeVersionId,
          assignmentType: p.assignmentType,
          matchStatus: p.matchStatus,
          matchScore: Number(p.matchScore.toFixed(6)),
          contentGroupId: p.contentGroupId ?? '',
          costStatus: p.costStatus ?? 'NOT_APPLICABLE',
        }))
        .sort(
          (a, b) =>
            a.slotId.localeCompare(b.slotId) ||
            a.assignmentType.localeCompare(b.assignmentType) ||
            a.recipeVersionId.localeCompare(b.recipeVersionId),
        ),
      slotCounts: slotCountPlan
        .map((s) => ({
          slotId: s.slotId,
          publishedRecipeCount: s.publishedRecipeCount,
          status: s.status,
        }))
        .sort((a, b) => a.slotId.localeCompare(b.slotId)),
    };
    const resultChecksum = stableJsonChecksum(resultPayload);

    const normalizeStatus = (status: string) => {
      if (status === 'MATCHED') return 'EXACT_MATCH';
      if (status === 'PARTIAL') return 'PARTIAL_MATCH';
      if (status === 'NEEDS_REVIEW') return 'AMBIGUOUS';
      return status;
    };
    const currentAuto = await this.loadActiveAutoAssignments(
      input.matrixVersion,
      slots.map((s) => s.id),
    );
    const currentSig = stableJsonChecksum({
      analyzerVersion: COVERAGE_ANALYZER_VERSION,
      proposed: currentAuto
        .filter((a) => a.assignmentType === 'PRIMARY' || a.assignmentType === 'MANUAL_OVERRIDE')
        .map((a) => ({
          slotId: a.slotId,
          recipeVersionId: a.recipeVersionId,
          assignmentType: a.assignmentType,
          matchStatus: normalizeStatus(a.matchStatus),
          matchScore: Number(Number(a.matchScore).toFixed(6)),
          contentGroupId: a.contentGroupId ?? '',
          costStatus: a.costStatus ?? 'NOT_APPLICABLE',
        }))
        .sort(
          (a, b) =>
            a.slotId.localeCompare(b.slotId) ||
            a.assignmentType.localeCompare(b.assignmentType) ||
            a.recipeVersionId.localeCompare(b.recipeVersionId),
        ),
      slotCounts: (
        await this.db.query<{ id: string; publishedRecipeCount: number; status: string }>(
          `SELECT id, "publishedRecipeCount", status FROM "RecipeCoverageSlot" WHERE id = ANY($1::uuid[])`,
          [slots.map((s) => s.id)],
        )
      ).rows
        .map((s) => ({
          slotId: s.id,
          publishedRecipeCount: Number(s.publishedRecipeCount),
          status: s.status,
        }))
        .sort((a, b) => a.slotId.localeCompare(b.slotId)),
    });

    const lastApply = await this.db.query<{ inputChecksum: string; resultChecksum: string }>(
      `SELECT "inputChecksum", "resultChecksum"
       FROM "RecipeCoverageAnalysisRun"
       WHERE "matrixVersion" = $1
         AND "dryRun" = false
         AND status IN ('SUCCEEDED','PARTIAL')
         AND "inputChecksum" IS NOT NULL
         AND "resultChecksum" IS NOT NULL
       ORDER BY "completedAt" DESC NULLS LAST, "createdAt" DESC
       LIMIT 1`,
      [input.matrixVersion],
    );
    const ledgerNoChange =
      Boolean(lastApply.rows[0]) &&
      lastApply.rows[0]!.inputChecksum === inputChecksum &&
      lastApply.rows[0]!.resultChecksum === resultChecksum;

    const semantic =
      ledgerNoChange || resultChecksum === currentSig ? 'NO_CHANGE' : 'CHANGED';

    let assignmentsCreated = 0;
    let assignmentsUpdated = 0;
    let assignmentsStaled = 0;
    const needsReviewAssignments = proposed.filter(
      (p) =>
        p.matchStatus === 'AMBIGUOUS' ||
        p.matchContract.assignmentRecommendation === 'NEEDS_REVIEW',
    ).length;

    if (!input.dryRun && semantic !== 'NO_CHANGE') {
      const applied = await this.applyProposed({
        matrixVersion: input.matrixVersion,
        slotIds: slots.map((s) => s.id),
        proposed,
        slotCountPlan,
        requestedBy: input.requestedBy,
      });
      assignmentsCreated = applied.created;
      assignmentsUpdated = applied.updated;
      assignmentsStaled = applied.staled;
    } else if (!input.dryRun && semantic === 'NO_CHANGE') {
      // Touch lastAnalyzedAt lightly? Spec: do not change domain timestamps unnecessarily — skip.
    }

    const prevStatus = await this.statusDistribution(input.matrixVersion);
    const newStatus = Object.fromEntries(
      slotCountPlan.reduce((m, s) => m.set(s.status, (m.get(s.status) ?? 0) + 1), new Map<string, number>()),
    );

    return {
      analyzerVersion: COVERAGE_ANALYZER_VERSION,
      matrixVersion: input.matrixVersion,
      mode: input.mode,
      dryRun: input.dryRun,
      semantic,
      inputChecksum,
      resultChecksum,
      slotsAnalyzed: slots.length,
      eligibleRecipeCount: versions.length,
      contentGroupCount,
      comparisonsEvaluated: comparisons,
      exactMatches,
      partialMatches,
      ambiguousMatches,
      noMatch,
      assignmentsCreated,
      assignmentsUpdated,
      assignmentsStaled,
      needsReviewAssignments,
      statusChanges: { previous: prevStatus, proposed: newStatus },
      warnings,
      proposedChanges: input.dryRun
        ? proposed
            .map((p) => ({
              slotId: p.slotId,
              recipeVersionId: p.recipeVersionId,
              assignmentType: p.assignmentType,
              matchStatus: p.matchStatus,
              matchScore: Number(p.matchScore.toFixed(6)),
              contentGroupId: p.contentGroupId,
              costStatus: p.costStatus,
            }))
            .sort(
              (a, b) =>
                a.slotId.localeCompare(b.slotId) ||
                a.assignmentType.localeCompare(b.assignmentType) ||
                a.recipeVersionId.localeCompare(b.recipeVersionId),
            )
        : undefined,
      dirtySnapshotAt,
    };
  }

  private async applyProposed(input: {
    matrixVersion: string;
    slotIds: string[];
    proposed: ProposedAssignment[];
    slotCountPlan: Array<{ slotId: string; publishedRecipeCount: number; status: string }>;
    requestedBy?: string | null;
  }) {
    let created = 0;
    let updated = 0;
    let staled = 0;

    await this.db.withTransaction(async (query) => {
      await query(
        `UPDATE "RecipeCoverageAssignment" a
         SET active = false
         WHERE a."slotId" = ANY($1::uuid[])
           AND a."assignmentType" <> 'MANUAL_OVERRIDE'
           AND a.active = true`,
        [input.slotIds],
      );

      for (const p of input.proposed) {
        if (p.assignmentType === 'MANUAL_OVERRIDE') {
          const res = await query(
            `UPDATE "RecipeCoverageAssignment"
             SET "matchStatus" = $3,
                 "matchScore" = $4,
                 "reasonsJson" = $5::jsonb,
                 "contentGroupId" = $6,
                 "costStatus" = $7,
                 "matchContractJson" = $8::jsonb,
                 "analyzedAt" = now(),
                 active = true
             WHERE "slotId" = $1 AND "recipeVersionId" = $2 AND "assignmentType" = 'MANUAL_OVERRIDE' AND active = true
             RETURNING id, "matchStatus"`,
            [
              p.slotId,
              p.recipeVersionId,
              p.matchStatus,
              p.matchScore,
              JSON.stringify(p.matchContract.reasons),
              p.contentGroupId,
              p.costStatus,
              JSON.stringify(p.matchContract),
            ],
          );
          if (res.rows[0]) {
            updated += 1;
            if (p.matchStatus === 'STALE') staled += 1;
          }
          continue;
        }

        try {
          await query(
            `INSERT INTO "RecipeCoverageAssignment" (
               "slotId", "recipeVersionId", "assignmentType", "matchStatus", "matchScore",
               "reasonsJson", "contentGroupId", "assignedBy", "costStatus", "matchContractJson"
             ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)`,
            [
              p.slotId,
              p.recipeVersionId,
              p.assignmentType,
              p.matchStatus,
              p.matchScore,
              JSON.stringify(p.matchContract.reasons),
              p.contentGroupId,
              input.requestedBy ?? null,
              p.costStatus,
              JSON.stringify(p.matchContract),
            ],
          );
          created += 1;
        } catch (error) {
          if (!String((error as Error).message ?? '').includes('duplicate key')) throw error;
          updated += 1;
        }
      }

      for (const plan of input.slotCountPlan) {
        await query(
          `UPDATE "RecipeCoverageSlot"
           SET "publishedRecipeCount" = $2, status = $3, "lastAnalyzedAt" = now(), "updatedAt" = now()
           WHERE id = $1
             AND ("publishedRecipeCount" IS DISTINCT FROM $2 OR status IS DISTINCT FROM $3)`,
          [plan.slotId, plan.publishedRecipeCount, plan.status],
        );
      }
    });

    await this.audit?.appendEvent({
      actorUserId: input.requestedBy ?? null,
      action: 'recipe.coverage.assignments_applied',
      entityType: 'RecipeCoverageAnalysisRun',
      entityId: null,
      metadata: {
        matrixVersion: input.matrixVersion,
        created,
        updated,
        staled,
        slots: input.slotIds.length,
      },
    });

    return { created, updated, staled };
  }

  private planSlotCounts(
    slots: Array<Record<string, unknown> & { id: string; desiredRecipeCount: unknown }>,
    proposed: ProposedAssignment[],
  ) {
    return slots.map((slot) => {
      const published = proposed.filter(
        (p) =>
          p.slotId === slot.id &&
          countsTowardPublished({
            assignmentType: p.assignmentType,
            matchStatus: p.matchStatus,
            active: true,
          }),
      ).length;
      const needsRefresh = proposed.some(
        (p) =>
          p.slotId === slot.id &&
          (p.matchStatus === 'STALE' ||
            p.matchContract.costStatus === 'STALE_PRICE' ||
            p.matchContract.costStatus === 'PRICE_MISSING'),
      ) && published === 0 && proposed.some((p) => p.slotId === slot.id && p.assignmentType === 'MANUAL_OVERRIDE');
      const status = computeCoverageStatus(published, Number(slot.desiredRecipeCount), needsRefresh);
      return { slotId: slot.id, publishedRecipeCount: published, status };
    });
  }

  private dedupeByGroup<T extends { groupId: string; contract: CoverageMatchContract }>(items: T[]): T[] {
    const best = new Map<string, T>();
    for (const item of items) {
      const prev = best.get(item.groupId);
      if (!prev || item.contract.score > prev.contract.score) best.set(item.groupId, item);
    }
    return [...best.values()].sort(
      (a, b) => b.contract.score - a.contract.score || a.groupId.localeCompare(b.groupId),
    );
  }

  private blockCandidates(slot: Record<string, unknown>, versions: EligibleVersion[]) {
    if (!slot.primaryProductId) return versions;
    const pid = String(slot.primaryProductId);
    const blocked = versions.filter(
      (v) => v.primaryProductId === pid || v.ingredientProductIds.includes(pid),
    );
    return blocked.length ? blocked : versions;
  }

  private dimensionFlags(slot: Record<string, unknown>, version: EligibleVersion) {
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
        version.ingredientProductIds.includes(String(slot.primaryProductId)),
      dishOk:
        !version.dishType ||
        version.dishType === 'UNCLASSIFIED' ||
        version.dishType === slot.dishType ||
        (slot.dishType === 'MAIN' && ['MAIN', 'BOWL'].includes(version.dishType)),
      methodOk: !slot.cookingMethod || !version.cookingMethod || version.cookingMethod === slot.cookingMethod,
      dietaryOk: dietaryProfileMatches(
        slot.dietaryProfile as CoverageDietaryProfile,
        version.dietaryTags,
        version.compositionKnown,
      ),
      equipmentOk: this.equipmentOk(String(slot.equipmentProfile), version.equipment),
      calorieOk:
        (slot.calorieMin == null || per.calories >= Number(slot.calorieMin)) &&
        (slot.calorieMax == null || per.calories <= Number(slot.calorieMax)),
      proteinOk: slot.proteinMin == null || per.proteinG >= Number(slot.proteinMin),
      fatOk: slot.fatMax == null || per.fatG <= Number(slot.fatMax),
      timeOk:
        slot.maximumTimeMinutes == null ||
        version.totalMinutes == null ||
        version.totalMinutes <= Number(slot.maximumTimeMinutes),
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

  private async estimateVersionCost(version: EligibleVersion): Promise<{
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
    if (anyIncomplete || !summary.complete) return { cost: summary.consumedCostRub, status: 'PRICE_INCOMPLETE' };
    if (anyStale || summary.stale) return { cost: summary.consumedCostRub, status: 'STALE_PRICE' };
    const perServing = (summary.consumedCostRub ?? 0) / Math.max(version.servings, 1);
    return { cost: perServing, status: 'CURRENT_PRICE_CONFIRMED' };
  }

  private async loadSlots(
    matrixVersion: string,
    mode: AnalyzerMode,
    slotIds?: string[],
    recipeVersionIds?: string[],
  ) {
    if (mode === 'INCREMENTAL_SLOTS' && slotIds?.length) {
      const rows = await this.db.query(
        `SELECT * FROM "RecipeCoverageSlot" WHERE "matrixVersion" = $1 AND active = true AND id = ANY($2::uuid[])`,
        [matrixVersion, slotIds],
      );
      return rows.rows as Array<Record<string, unknown> & { id: string; slotKey: string; desiredRecipeCount: unknown; maximumCost: unknown; primaryProductId: string | null; dishType: string; cookingMethod: string | null; calorieMin: unknown; calorieMax: unknown; proteinMin: unknown; fatMax: unknown; maximumTimeMinutes: unknown; dietaryProfile: string; equipmentProfile: string; active: boolean }>;
    }
    if (mode === 'INCREMENTAL_RECIPES' && recipeVersionIds?.length) {
      const related = await this.db.query<{ slotId: string }>(
        `SELECT DISTINCT a."slotId" AS "slotId"
         FROM "RecipeCoverageAssignment" a
         JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
         WHERE s."matrixVersion" = $1 AND a."recipeVersionId" = ANY($2::uuid[])
         UNION
         SELECT s.id FROM "RecipeCoverageSlot" s WHERE s."matrixVersion" = $1 AND s.active = true`,
        [matrixVersion, recipeVersionIds],
      );
      // For incremental recipes: analyze all active slots (candidate blocking keeps cost down) —
      // parity with FULL requires same slot set when recipes change matching potential.
      const rows = await this.db.query(
        `SELECT * FROM "RecipeCoverageSlot" WHERE "matrixVersion" = $1 AND active = true`,
        [matrixVersion],
      );
      void related;
      return rows.rows as Array<Record<string, unknown> & { id: string; slotKey: string; desiredRecipeCount: unknown; maximumCost: unknown; primaryProductId: string | null; dishType: string; cookingMethod: string | null; calorieMin: unknown; calorieMax: unknown; proteinMin: unknown; fatMax: unknown; maximumTimeMinutes: unknown; dietaryProfile: string; equipmentProfile: string; active: boolean }>;
    }
    const rows = await this.db.query(
      `SELECT * FROM "RecipeCoverageSlot" WHERE "matrixVersion" = $1 AND active = true ORDER BY "sortRank", name`,
      [matrixVersion],
    );
    return rows.rows as Array<Record<string, unknown> & { id: string; slotKey: string; desiredRecipeCount: unknown; maximumCost: unknown; primaryProductId: string | null; dishType: string; cookingMethod: string | null; calorieMin: unknown; calorieMax: unknown; proteinMin: unknown; fatMax: unknown; maximumTimeMinutes: unknown; dietaryProfile: string; equipmentProfile: string; active: boolean }>;
  }

  private async loadEligibleCandidates(filterVersionIds?: string[]): Promise<EligibleVersion[]> {
    const rows = await this.db.query<{
      recipeId: string;
      recipeKey: string | null;
      versionId: string;
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
              v.id AS "versionId", v.servings,
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
       LEFT JOIN "RecipeFingerprint" fp ON fp."recipeVersionId" = v.id AND fp."fingerprintSchemaVersion" = 'recipe-fingerprint/v1'`,
    );

    const out: EligibleVersion[] = [];
    for (const row of rows.rows) {
      if (filterVersionIds?.length && !filterVersionIds.includes(row.versionId)) {
        // Still include for FULL parity when analyzing affected recipes' competing slots —
        // for INCREMENTAL_RECIPES we load all eligible and rely on apply scope.
      }
      const check = isEligibleCoverageVersion({
        lifecycleStatus: row.lifecycleStatus,
        validationStatus: row.validationStatus,
        isCurrent: row.isCurrent,
        hasFingerprint: row.hasFingerprint,
        recipeKey: row.recipeKey,
        dataClass: (row as { dataClass?: string }).dataClass,
        hasOpenExactDuplicateBlocker: false,
      });
      if (!check.eligible) continue;
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
        versionId: row.versionId,
        servings: Number(row.servings) || 1,
        calories: Number(row.calories),
        proteinG: Number(row.proteinG),
        fatG: Number(row.fatG),
        dishType: row.dishType,
        primaryProductId: row.primaryProductId,
        ingredientProductIds: (row.ingredientsSnapshotJson ?? [])
          .map((i) => i.productId)
          .filter(Boolean) as string[],
        ingredients: (row.ingredientsSnapshotJson ?? []).map((i) => ({
          productId: i.productId ?? null,
          amount: Number(i.amount ?? 0),
          unit: String(i.unit ?? 'g'),
        })),
        dietaryTags,
        compositionKnown: dietaryTags.length > 0 && !dietaryTags.includes('UNKNOWN'),
        equipment,
        cookingMethod: primaryCookingMethod(methods),
        totalMinutes: prep != null || cook != null ? Number(prep ?? 0) + Number(cook ?? 0) : null,
        fingerprintHash: row.fingerprintHash,
      });
    }
    return out;
  }

  private async loadExactDuplicateGroups() {
    const map = new Map<string, string>();
    const rows = await this.db.query<{
      leftRecipeVersionId: string;
      rightRecipeVersionId: string;
      status: string;
    }>(
      `SELECT "leftRecipeVersionId", "rightRecipeVersionId", status
       FROM "RecipeDuplicateCandidate"
       WHERE classification = 'EXACT_DUPLICATE'
         AND status IN ('OPEN','CONFIRMED_DUPLICATE')`,
    );
    for (const row of rows.rows) {
      const group = [row.leftRecipeVersionId, row.rightRecipeVersionId].sort().join(':');
      map.set(row.leftRecipeVersionId, group);
      map.set(row.rightRecipeVersionId, group);
    }
    // DISMISSED no longer joins; CONFIRMED_VARIANT not in this query → separate groups.
    return map;
  }

  private async loadManualOverrides(matrixVersion: string, slotIds: string[]) {
    if (!slotIds.length) return [];
    const rows = await this.db.query<{
      id: string;
      slotId: string;
      recipeVersionId: string;
      matchScore: string;
      contentGroupId: string | null;
    }>(
      `SELECT a.id, a."slotId", a."recipeVersionId", a."matchScore"::text AS "matchScore", a."contentGroupId"
       FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1
         AND a."slotId" = ANY($2::uuid[])
         AND a."assignmentType" = 'MANUAL_OVERRIDE'
         AND a.active = true`,
      [matrixVersion, slotIds],
    );
    return rows.rows;
  }

  private async loadActiveAutoAssignments(matrixVersion: string, slotIds: string[]) {
    if (!slotIds.length) return [];
    const rows = await this.db.query<{
      slotId: string;
      recipeVersionId: string;
      assignmentType: string;
      matchStatus: string;
      matchScore: string;
      contentGroupId: string | null;
      costStatus: string | null;
    }>(
      `SELECT a."slotId", a."recipeVersionId", a."assignmentType", a."matchStatus",
              a."matchScore"::text AS "matchScore", a."contentGroupId", a."costStatus"
       FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a."slotId" = ANY($2::uuid[]) AND a.active = true`,
      [matrixVersion, slotIds],
    );
    return rows.rows;
  }

  private async statusDistribution(matrixVersion: string) {
    const rows = await this.db.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n FROM "RecipeCoverageSlot"
       WHERE "matrixVersion" = $1 AND active = true GROUP BY status`,
      [matrixVersion],
    );
    return Object.fromEntries(rows.rows.map((r) => [r.status, Number(r.n)]));
  }

  private async clearProcessedDirty(matrixVersion: string, snapshotAt: string) {
    // Keep dirty if updated after analysis started (events during run).
    await this.db.query(
      `DELETE FROM "RecipeCoverageDirtyState"
       WHERE "matrixVersion" = $1 AND "updatedAt" <= $2::timestamptz`,
      [matrixVersion, snapshotAt],
    );
  }

  private async failStaleRuns(matrixVersion: string) {
    await this.db.query(
      `UPDATE "RecipeCoverageAnalysisRun"
       SET status = 'FAILED',
           "errorCode" = 'STALE_RUN',
           "errorSummary" = 'Run exceeded stale threshold without completion',
           "completedAt" = now()
       WHERE "matrixVersion" = $1
         AND status = 'RUNNING'
         AND "startedAt" < now() - ($2::text || ' milliseconds')::interval`,
      [matrixVersion, String(COVERAGE_STALE_RUN_MS)],
    );
  }

  private async finishRun(
    runId: string,
    patch: {
      status: string;
      inputChecksum?: string;
      resultChecksum?: string;
      durationMs?: number;
      slotCount?: number;
      eligibleRecipeCount?: number;
      comparisonCount?: number;
      resultJson?: unknown;
      errorCode?: string;
      errorSummary?: string;
    },
  ) {
    await this.db.query(
      `UPDATE "RecipeCoverageAnalysisRun"
       SET status = $2,
           "inputChecksum" = COALESCE($3, "inputChecksum"),
           "resultChecksum" = COALESCE($4, "resultChecksum"),
           "completedAt" = now(),
           "durationMs" = COALESCE($5, "durationMs"),
           "slotCount" = COALESCE($6, "slotCount"),
           "eligibleRecipeCount" = COALESCE($7, "eligibleRecipeCount"),
           "comparisonCount" = COALESCE($8, "comparisonCount"),
           "resultJson" = COALESCE($9::jsonb, "resultJson"),
           "errorCode" = $10,
           "errorSummary" = $11
       WHERE id = $1`,
      [
        runId,
        patch.status,
        patch.inputChecksum ?? null,
        patch.resultChecksum ?? null,
        patch.durationMs ?? null,
        patch.slotCount ?? null,
        patch.eligibleRecipeCount ?? null,
        patch.comparisonCount ?? null,
        patch.resultJson ? JSON.stringify(patch.resultJson) : null,
        patch.errorCode ?? null,
        patch.errorSummary ?? null,
      ],
    );
  }
}

type EligibleVersion = {
  recipeId: string;
  recipeKey: string | null;
  versionId: string;
  servings: number;
  calories: number;
  proteinG: number;
  fatG: number;
  dishType: string | null;
  primaryProductId: string | null;
  ingredientProductIds: string[];
  ingredients: Array<{ productId: string | null; amount: number; unit: string }>;
  dietaryTags: string[];
  compositionKnown: boolean;
  equipment: string[];
  cookingMethod: string | null;
  totalMinutes: number | null;
  fingerprintHash: string | null;
};
