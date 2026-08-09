import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import type { SourceRecipeCandidatePayload } from '../domain/recipe-source-adapter.contract';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';
import { RecipeExternalSourceService } from './recipe-external-source.service';
import {
  RECIPE_RESEARCH_NORMALIZATION_VERSION,
  assertResearchDecisionAllowed,
  assertResearchIdempotencyKey,
  computeCompleteness,
  mapIngredients,
  normalizeFoodText,
  payloadByteLength,
  sanitizeManualPayload,
  stableJsonChecksum,
  type ProductAliasCandidate,
  type RecipeResearchOperation,
  type ReviewFlag,
  type SourceIngredientLike,
} from '../domain/recipe-research.policy';

type SourceRow = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  adapterType: string;
  rightsStatus: string;
  collectionMode: string;
  parserVersion: string;
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  requestTimeoutMs: number;
  enabled: boolean;
  healthStatus: string;
  lastSuccessfulCheckAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewExpiresAt: Date | null;
  policyReason: string | null;
  dataClass: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class RecipeResearchService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RecipeExternalSourceService) private readonly sources: RecipeExternalSourceService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
  ) {}

  async listRequests(limit = 30) {
    const rows = await this.db.query(
      `SELECT r.*, d.recommendation, s.name AS "slotName"
       FROM "RecipeResearchRequest" r
       LEFT JOIN "RecipeSearchDecision" d ON d.id = r."searchDecisionId"
       LEFT JOIN "RecipeCoverageSlot" s ON s.id = r."coverageSlotId"
       ORDER BY r."createdAt" DESC
       LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 30, 1), 100)],
    );
    return { items: rows.rows };
  }

  async createRequest(input: {
    searchDecisionId?: string | null;
    reason: string;
    idempotencyKey: string;
    actorUserId: string;
    actorRole: string;
    manual?: boolean;
  }) {
    this.assertStaff(input.actorRole);
    const idempotencyKey = assertResearchIdempotencyKey(input.idempotencyKey);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_RESEARCH_REASON_REQUIRED');

    return this.db.withTransaction(async (query) => {
      await query(`SELECT pg_advisory_xact_lock(hashtext('recipe-research-request'), hashtext($1))`, [
        idempotencyKey,
      ]);
      const replay = await query(`SELECT * FROM "RecipeResearchRequest" WHERE "idempotencyKey" = $1`, [
        idempotencyKey,
      ]);
      if (replay.rows[0]) return { ...replay.rows[0], idempotentReplay: true };

      let decision: Record<string, unknown> | null = null;
      if (input.searchDecisionId) {
        const decisions = await query<{
          id: string;
          searchRunId: string;
          coverageSlotId: string | null;
          matrixVersion: string;
          recommendation: string;
          catalogStateChecksum: string;
          expiresAt: Date;
          usedAt: Date | null;
          invalidatedAt: Date | null;
        }>(`SELECT * FROM "RecipeSearchDecision" WHERE id = $1 FOR UPDATE`, [input.searchDecisionId]);
        const row = decisions.rows[0];
        if (!row) throw new Error('RECIPE_RESEARCH_DECISION_NOT_FOUND');
        assertResearchDecisionAllowed(row.recommendation);
        if (row.invalidatedAt) throw new Error('RECIPE_RESEARCH_DECISION_INVALIDATED');
        if (row.expiresAt.getTime() < Date.now()) throw new Error('RECIPE_RESEARCH_DECISION_EXPIRED');
        if (row.usedAt) throw new Error('RECIPE_RESEARCH_DECISION_ALREADY_USED');
        const catalogStateChecksum = await this.computeCatalogStateChecksum(row.matrixVersion, query);
        if (catalogStateChecksum !== row.catalogStateChecksum) {
          throw new Error('RECIPE_RESEARCH_DECISION_CATALOG_STALE');
        }
        decision = row;
      } else if (!input.manual) {
        throw new Error('RECIPE_RESEARCH_DECISION_REQUIRED');
      }

      const inserted = await query(
        `INSERT INTO "RecipeResearchRequest" (
           "searchDecisionId", "coverageSlotId", "requestType", status, reason,
           "idempotencyKey", "requestedBy", "inputSnapshotJson"
         ) VALUES ($1,$2,$3,'READY',$4,$5,$6,$7)
         RETURNING *`,
        [
          input.searchDecisionId ?? null,
          (decision?.coverageSlotId as string | null | undefined) ?? null,
          input.manual ? 'MANUAL_EDITORIAL_RESEARCH' : 'SEARCH_DECISION_RESEARCH',
          reason,
          idempotencyKey,
          input.actorUserId,
          JSON.stringify({ decision, manual: Boolean(input.manual) }),
        ],
      );
      if (input.searchDecisionId) {
        await query(`UPDATE "RecipeSearchDecision" SET "usedAt" = now() WHERE id = $1`, [
          input.searchDecisionId,
        ]);
      }
      await this.auditSafe(input.actorUserId, 'recipe.research.request_created', 'RecipeResearchRequest', inserted.rows[0]!.id, {
        searchDecisionId: input.searchDecisionId ?? null,
        manual: Boolean(input.manual),
      });
      return inserted.rows[0];
    });
  }

  async getRequest(id: string) {
    const row = await this.db.query(`SELECT * FROM "RecipeResearchRequest" WHERE id = $1`, [id]);
    if (!row.rows[0]) throw new Error('RECIPE_RESEARCH_REQUEST_NOT_FOUND');
    return row.rows[0];
  }

  async cancelRequest(input: { id: string; actorUserId: string; actorRole: string; reason: string }) {
    this.assertStaff(input.actorRole);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_RESEARCH_CANCEL_REASON_REQUIRED');
    const updated = await this.db.query(
      `UPDATE "RecipeResearchRequest"
       SET status = 'CANCELLED', "cancelledBy" = $2, "cancelReason" = $3, "cancelledAt" = now(), "updatedAt" = now()
       WHERE id = $1 AND status NOT IN ('COMPLETED','CANCELLED')
       RETURNING *`,
      [input.id, input.actorUserId, reason],
    );
    if (!updated.rows[0]) throw new Error('RECIPE_RESEARCH_CANCEL_NOT_ALLOWED');
    await this.auditSafe(input.actorUserId, 'recipe.research.request_cancelled', 'RecipeResearchRequest', input.id, { reason });
    return updated.rows[0];
  }

  async runRequest(input: {
    requestId: string;
    sourceId?: string | null;
    externalId?: string | null;
    operation?: RecipeResearchOperation;
    manualPayload?: Record<string, unknown> | null;
    actorUserId: string;
    actorRole: string;
    idempotencyKey: string;
  }) {
    this.assertStaff(input.actorRole);
    const request = await this.getRequest(input.requestId);
    if (!['READY', 'FAILED', 'BLOCKED', 'COMPLETED'].includes(String(request.status))) {
      throw new Error('RECIPE_RESEARCH_REQUEST_NOT_RUNNABLE');
    }
    const idempotencyKey = assertResearchIdempotencyKey(input.idempotencyKey);
    const operation: RecipeResearchOperation = input.manualPayload ? 'MANUAL_ENTRY' : input.operation ?? 'FETCH_CANDIDATE';
    const source = input.sourceId ? await this.requireSource(input.sourceId) : null;
    const correlationId = randomUUID();
    const run = await this.createRun({
      requestId: input.requestId,
      source,
      operation,
      actorUserId: input.actorUserId,
      correlationId,
      idempotencyKey,
      inputJson: { externalId: input.externalId ?? null, manual: Boolean(input.manualPayload) },
    });
    if (run.idempotentReplay) return run;

    try {
      await this.db.query(`UPDATE "RecipeResearchRun" SET status = 'RUNNING', "startedAt" = now() WHERE id = $1`, [
        run.id,
      ]);
      await this.db.query(`UPDATE "RecipeResearchRequest" SET status = 'RUNNING', "updatedAt" = now() WHERE id = $1`, [
        input.requestId,
      ]);

      const payload = input.manualPayload
        ? (sanitizeManualPayload(input.manualPayload) as SourceRecipeCandidatePayload)
        : await this.fetchViaTestAdapter({ source, externalId: input.externalId, actorUserId: input.actorUserId });
      const candidate = await this.captureCandidate({
        requestId: input.requestId,
        runId: run.id,
        sourceId: source?.id ?? null,
        payload,
        retentionClass: source?.dataClass === 'PRODUCTION' ? 'METADATA_ONLY' : 'TEST_FIXTURE',
      });
      await this.db.query(
        `UPDATE "RecipeResearchRun"
         SET status = 'SUCCEEDED', "completedAt" = now(),
             "durationMs" = GREATEST(1, EXTRACT(MILLISECONDS FROM (now() - COALESCE("startedAt", now())))::int),
             "resultJson" = $2
         WHERE id = $1`,
        [run.id, JSON.stringify({ candidateId: candidate.id, rawSnapshotId: candidate.rawSnapshotId, networkCalls: 0 })],
      );
      await this.db.query(
        `UPDATE "RecipeResearchRequest" SET status = 'COMPLETED', "updatedAt" = now() WHERE id = $1`,
        [input.requestId],
      );
      await this.auditSafe(input.actorUserId, 'recipe.research.candidate_captured', 'RecipeSourceCandidate', candidate.id, {
        requestId: input.requestId,
        sourceId: source?.id ?? null,
        networkCalls: 0,
      });
      return { runId: run.id, candidate };
    } catch (error) {
      const code = error instanceof RecipeSourceAdapterError ? error.code : error instanceof Error ? error.message : 'RECIPE_RESEARCH_RUN_FAILED';
      await this.db.query(
        `UPDATE "RecipeResearchRun"
         SET status = $2, "completedAt" = now(), "errorCode" = $3, "errorSummary" = $4
         WHERE id = $1`,
        [run.id, code.includes('BLOCK') || code.includes('RIGHTS') ? 'BLOCKED' : 'FAILED', code.slice(0, 120), String(code).slice(0, 400)],
      );
      await this.db.query(`UPDATE "RecipeResearchRequest" SET status = $2, "updatedAt" = now() WHERE id = $1`, [
        input.requestId,
        code.includes('BLOCK') || code.includes('RIGHTS') ? 'BLOCKED' : 'FAILED',
      ]);
      throw error;
    }
  }

  async listRuns(requestId: string) {
    const rows = await this.db.query(
      `SELECT * FROM "RecipeResearchRun" WHERE "requestId" = $1 ORDER BY "createdAt" DESC`,
      [requestId],
    );
    return { items: rows.rows };
  }

  async listCandidates(requestId?: string) {
    const rows = await this.db.query(
      requestId
        ? `SELECT * FROM "RecipeSourceCandidate" WHERE "requestId" = $1 ORDER BY "createdAt" DESC`
        : `SELECT * FROM "RecipeSourceCandidate" ORDER BY "createdAt" DESC LIMIT 100`,
      requestId ? [requestId] : [],
    );
    return { items: rows.rows };
  }

  async getCandidate(candidateId: string) {
    const candidate = await this.db.query(`SELECT * FROM "RecipeSourceCandidate" WHERE id = $1`, [candidateId]);
    if (!candidate.rows[0]) throw new Error('RECIPE_RESEARCH_CANDIDATE_NOT_FOUND');
    const normalized = await this.db.query(
      `SELECT * FROM "RecipeNormalizedCandidate" WHERE "candidateId" = $1 ORDER BY version DESC`,
      [candidateId],
    );
    const review = await this.db.query(
      `SELECT * FROM "RecipeCandidateReviewItem" WHERE "candidateId" = $1 ORDER BY status ASC, "createdAt" ASC`,
      [candidateId],
    );
    return { ...candidate.rows[0], normalized: normalized.rows, reviewItems: review.rows };
  }

  async normalizeCandidate(input: { candidateId: string; actorUserId: string; actorRole: string }) {
    this.assertStaff(input.actorRole);
    const candidateRows = await this.db.query<{
      id: string;
      rawSnapshotId: string;
      sourcePayloadChecksum: string;
    }>(`SELECT id, "rawSnapshotId", "sourcePayloadChecksum" FROM "RecipeSourceCandidate" WHERE id = $1`, [
      input.candidateId,
    ]);
    const candidate = candidateRows.rows[0];
    if (!candidate) throw new Error('RECIPE_RESEARCH_CANDIDATE_NOT_FOUND');
    const snap = await this.db.query<{ inlinePayloadJson: SourceRecipeCandidatePayload | null }>(
      `SELECT "inlinePayloadJson" FROM "RecipeSourceRawSnapshot" WHERE id = $1`,
      [candidate.rawSnapshotId],
    );
    const payload = snap.rows[0]?.inlinePayloadJson;
    if (!payload) throw new Error('RECIPE_RESEARCH_RAW_PAYLOAD_NOT_AVAILABLE');
    const aliases = await this.loadProductAliases();
    const ingredients = Array.isArray(payload.ingredients) ? (payload.ingredients as SourceIngredientLike[]) : [];
    const mapped = mapIngredients(ingredients, aliases);
    const completenessScore = computeCompleteness({
      title: payload.title,
      ingredients,
      steps: Array.isArray(payload.steps) ? payload.steps : [],
      servings: payload.servings,
      preparationTime: payload.preparationTime,
      cookingTime: payload.cookingTime,
    });
    const flags: ReviewFlag[] = [...mapped.flags, { type: 'SOURCE_NUTRITION_UNTRUSTED', severity: 'INFO' }];
    if (completenessScore < 0.75) flags.push({ type: 'LOW_COMPLETENESS', severity: 'WARNING' });
    const versionRows = await this.db.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0)::int + 1 AS version FROM "RecipeNormalizedCandidate" WHERE "candidateId" = $1`,
      [input.candidateId],
    );
    const version = versionRows.rows[0]?.version ?? 1;
    const normalizedJson = {
      title: payload.title,
      description: payload.description ?? null,
      servings: payload.servings ?? null,
      preparationTime: payload.preparationTime ?? null,
      cookingTime: payload.cookingTime ?? null,
      ingredients: mapped.mappings,
      steps: payload.steps ?? [],
      sourceNutrition: payload.sourceNutrition ?? null,
      nutritionPolicy: 'SOURCE_NUTRITION_UNTRUSTED_DO_NOT_USE_FOR_CANONICAL',
      createsRecipe: false,
      createsRecipeVersion: false,
      createsProducts: false,
    };
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO "RecipeNormalizedCandidate" (
         "candidateId", version, "normalizationVersion", status, "normalizedJson",
         "ingredientMappingsJson", "reviewFlagsJson", "completenessScore",
         "nutritionTrustLevel", "sourcePayloadChecksum", "createdBy"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UNTRUSTED_SOURCE',$9,$10)
       RETURNING id`,
      [
        input.candidateId,
        version,
        RECIPE_RESEARCH_NORMALIZATION_VERSION,
        flags.some((f) => f.severity === 'BLOCKER') ? 'NEEDS_REVIEW' : 'NORMALIZED',
        JSON.stringify(normalizedJson),
        JSON.stringify(mapped.mappings),
        JSON.stringify(flags),
        completenessScore,
        candidate.sourcePayloadChecksum,
        input.actorUserId,
      ],
    );
    await this.db.query(`DELETE FROM "RecipeCandidateReviewItem" WHERE "candidateId" = $1 AND status = 'OPEN'`, [
      input.candidateId,
    ]);
    for (const flag of flags) {
      await this.db.query(
        `INSERT INTO "RecipeCandidateReviewItem" (
           "candidateId", "normalizedCandidateId", type, status, severity,
           "ingredientIndex", "sourceValue", "suggestionJson"
         ) VALUES ($1,$2,$3,'OPEN',$4,$5,$6,$7)`,
        [
          input.candidateId,
          inserted.rows[0]!.id,
          flag.type,
          flag.severity,
          flag.ingredientIndex ?? null,
          flag.sourceValue ?? null,
          JSON.stringify(flag.suggestion ?? {}),
        ],
      );
    }
    await this.db.query(
      `UPDATE "RecipeSourceCandidate"
       SET status = $2, "reviewStatus" = $3, "normalizedCandidateId" = $4, "updatedAt" = now()
       WHERE id = $1`,
      [
        input.candidateId,
        flags.some((f) => f.severity === 'BLOCKER') ? 'NEEDS_REVIEW' : 'NORMALIZED',
        flags.some((f) => f.severity === 'BLOCKER') ? 'NEEDS_MANUAL_REVIEW' : 'READY_FOR_REVIEW',
        inserted.rows[0]!.id,
      ],
    );
    await this.auditSafe(input.actorUserId, 'recipe.research.candidate_normalized', 'RecipeSourceCandidate', input.candidateId, {
      normalizedCandidateId: inserted.rows[0]!.id,
      reviewItemCount: flags.length,
    });
    return this.getCandidate(input.candidateId);
  }

  async updateCandidateStatus(input: {
    candidateId: string;
    actorUserId: string;
    actorRole: string;
    status: 'REJECTED' | 'ARCHIVED';
    reason: string;
  }) {
    this.assertStaff(input.actorRole);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_RESEARCH_STATUS_REASON_REQUIRED');
    const updated = await this.db.query(
      `UPDATE "RecipeSourceCandidate"
       SET status = $2, "reviewStatus" = $3, "updatedAt" = now()
       WHERE id = $1 AND status NOT IN ('REJECTED','ARCHIVED')
       RETURNING *`,
      [input.candidateId, input.status, input.status],
    );
    if (!updated.rows[0]) throw new Error('RECIPE_RESEARCH_CANDIDATE_STATUS_NOT_ALLOWED');
    await this.auditSafe(input.actorUserId, `recipe.research.candidate_${input.status.toLowerCase()}`, 'RecipeSourceCandidate', input.candidateId, { reason });
    return updated.rows[0];
  }

  async resolveReviewItem(input: {
    reviewItemId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    dismiss?: boolean;
    productId?: string | null;
  }) {
    this.assertStaff(input.actorRole);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_RESEARCH_REVIEW_REASON_REQUIRED');
    const updated = await this.db.query<{
      id: string;
      candidateId: string;
      type: string;
      sourceValue: string | null;
      status: string;
    }>(
      `UPDATE "RecipeCandidateReviewItem"
       SET status = $2, reason = $3, "resolvedBy" = $4, "resolvedAt" = now(),
           "suggestionJson" = CASE
             WHEN $5::uuid IS NULL THEN "suggestionJson"
             ELSE COALESCE("suggestionJson", '{}'::jsonb) || jsonb_build_object('confirmedProductId', $5::text)
           END
       WHERE id = $1 AND status = 'OPEN'
       RETURNING *`,
      [
        input.reviewItemId,
        input.dismiss ? 'DISMISSED' : 'RESOLVED',
        reason,
        input.actorUserId,
        input.productId ?? null,
      ],
    );
    const row = updated.rows[0];
    if (!row) throw new Error('RECIPE_RESEARCH_REVIEW_ITEM_NOT_OPEN');

    if (!input.dismiss && input.productId && row.sourceValue) {
      const alias = String(row.sourceValue).trim();
      const normalizedAlias = normalizeFoodText(alias);
      if (alias && normalizedAlias) {
        await this.db.query(
          `INSERT INTO "ProductAlias" ("productId", alias, "normalizedAlias", source, confidence, status)
           VALUES ($1, $2, $3, 'MANUAL', 1.0, 'ACTIVE')
           ON CONFLICT DO NOTHING`,
          [input.productId, alias, normalizedAlias],
        );
      }
    }

    await this.auditSafe(input.actorUserId, 'recipe.research.review_item_resolved', 'RecipeCandidateReviewItem', input.reviewItemId, {
      reason,
      dismiss: Boolean(input.dismiss),
      productId: input.productId ?? null,
    });

    // Re-normalize to produce a new immutable version after confirmed mapping.
    if (!input.dismiss && input.productId) {
      await this.normalizeCandidate({
        candidateId: row.candidateId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      });
    }
    return this.db.query(`SELECT * FROM "RecipeCandidateReviewItem" WHERE id = $1`, [input.reviewItemId]).then((r) => r.rows[0]);
  }

  async getRawSnapshot(input: { candidateId: string; actorRole: string }) {
    if (String(input.actorRole).toUpperCase() !== 'OWNER') throw new ForbiddenException('OWNER_ACCESS_FORBIDDEN');
    const rows = await this.db.query(
      `SELECT s.id, s."sourceId", s."externalId", s."sourceUrl", s."parserVersion",
              s."payloadChecksum", s."payloadBytes", s."inlinePayloadJson",
              s."retentionClass", s."deletionStatus", s."redactionStatus",
              s."fetchedAt", s."expiresAt", s."deletedAt"
       FROM "RecipeSourceCandidate" c
       JOIN "RecipeSourceRawSnapshot" s ON s.id = c."rawSnapshotId"
       WHERE c.id = $1`,
      [input.candidateId],
    );
    if (!rows.rows[0]) throw new Error('RECIPE_RESEARCH_RAW_NOT_FOUND');
    return rows.rows[0];
  }

  async runRetentionJob(input: { actorUserId?: string | null }) {
    const updated = await this.db.query<{ id: string }>(
      `UPDATE "RecipeSourceRawSnapshot"
       SET "inlinePayloadJson" = NULL,
           "deletionStatus" = CASE WHEN "retentionClass" = 'METADATA_ONLY' THEN 'RETAINED_METADATA' ELSE 'DELETED' END,
           "redactionStatus" = CASE WHEN "retentionClass" = 'METADATA_ONLY' THEN 'REDACTED' ELSE 'DELETED' END,
           "deletedAt" = now()
       WHERE "deletionStatus" = 'ACTIVE'
         AND "expiresAt" IS NOT NULL
         AND "expiresAt" <= now()
       RETURNING id`,
    );
    if (updated.rows.length) {
      await this.auditSafe(input.actorUserId ?? null, 'recipe.research.raw_retention_applied', 'RecipeSourceRawSnapshot', null, {
        count: updated.rows.length,
      });
    }
    return { redacted: updated.rows.length };
  }

  private async fetchViaTestAdapter(input: {
    source: SourceRow | null;
    externalId?: string | null;
    actorUserId: string;
  }): Promise<SourceRecipeCandidatePayload> {
    if (!input.source) throw new Error('RECIPE_RESEARCH_SOURCE_REQUIRED');
    if (
      input.source.adapterType !== 'TEST_DETERMINISTIC' &&
      input.source.adapterType !== 'FOOD_RU' &&
      input.source.adapterType !== 'IAMCOOK' &&
      input.source.adapterType !== 'RUSSIANFOOD'
    ) {
      throw new Error('RECIPE_RESEARCH_TEST_ADAPTER_ONLY');
    }
    // PRODUCTION rows never run fixture or live HTTP from research staging.
    const resolved = this.sources.resolveFixtureExecutableAdapter(input.source, input.actorUserId);
    const externalId =
      input.externalId ??
      (input.source.adapterType === 'TEST_DETERMINISTIC'
        ? 'test-card-1'
        : 'synthetic-chicken-buckwheat');
    return resolved.adapter.fetchCandidate(externalId, resolved.context);
  }

  private async createRun(input: {
    requestId: string;
    source: SourceRow | null;
    operation: RecipeResearchOperation;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
    inputJson: Record<string, unknown>;
  }) {
    const existing = await this.db.query(`SELECT * FROM "RecipeResearchRun" WHERE "idempotencyKey" = $1`, [
      input.idempotencyKey,
    ]);
    if (existing.rows[0]) return { ...existing.rows[0], idempotentReplay: true };
    const inserted = await this.db.query(
      `INSERT INTO "RecipeResearchRun" (
         "requestId", "sourceId", operation, status, "correlationId", "idempotencyKey",
         "adapterType", "parserVersion", "inputJson", "createdBy"
       ) VALUES ($1,$2,$3,'QUEUED',$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.requestId,
        input.source?.id ?? null,
        input.operation,
        input.correlationId,
        input.idempotencyKey,
        input.source?.adapterType ?? null,
        input.source?.parserVersion ?? 'manual-entry/v1',
        JSON.stringify(input.inputJson),
        input.actorUserId,
      ],
    );
    return inserted.rows[0];
  }

  private async captureCandidate(input: {
    requestId: string;
    runId: string;
    sourceId: string | null;
    payload: SourceRecipeCandidatePayload;
    retentionClass: 'TEST_FIXTURE' | 'LIMITED_RESEARCH' | 'METADATA_ONLY';
  }) {
    const checksum = stableJsonChecksum(input.payload);
    const bytes = payloadByteLength(input.payload);
    const snapshot = await this.db.query<{ id: string }>(
      `INSERT INTO "RecipeSourceRawSnapshot" (
         "runId", "sourceId", "externalId", "sourceUrl", "parserVersion",
         "payloadKind", "payloadChecksum", "payloadBytes", "inlinePayloadJson",
         "retentionClass", "expiresAt"
       ) VALUES ($1,$2,$3,$4,$5,'CANDIDATE_JSON',$6,$7,$8,$9, now() + interval '7 days')
       RETURNING id`,
      [
        input.runId,
        input.sourceId,
        input.payload.externalId,
        input.payload.sourceUrl ?? null,
        input.payload.parserVersion,
        checksum,
        bytes,
        JSON.stringify(input.payload),
        input.retentionClass,
      ],
    );
    const candidate = await this.db.query<{ id: string; rawSnapshotId: string }>(
      `INSERT INTO "RecipeSourceCandidate" (
         "requestId", "runId", "sourceId", "rawSnapshotId", "externalId",
         "sourceUrl", title, status, "parserVersion", "sourcePayloadChecksum"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'RAW_CAPTURED',$8,$9)
       ON CONFLICT ((COALESCE("sourceId", '00000000-0000-0000-0000-000000000000'::uuid)), "externalId", "parserVersion")
       DO UPDATE SET
         "requestId" = EXCLUDED."requestId",
         "runId" = EXCLUDED."runId",
         "lastSeenAt" = now(),
         "updatedAt" = now(),
         "rawSnapshotId" = EXCLUDED."rawSnapshotId",
         "sourcePayloadChecksum" = EXCLUDED."sourcePayloadChecksum"
       RETURNING id, "rawSnapshotId" AS "rawSnapshotId"`,
      [
        input.requestId,
        input.runId,
        input.sourceId,
        snapshot.rows[0]!.id,
        input.payload.externalId,
        input.payload.sourceUrl ?? null,
        input.payload.title,
        input.payload.parserVersion,
        checksum,
      ],
    );
    return candidate.rows[0]!;
  }

  private async requireSource(id: string): Promise<SourceRow> {
    const rows = await this.db.query<SourceRow>(`SELECT * FROM "RecipeExternalSource" WHERE id = $1 LIMIT 1`, [id]);
    const row = rows.rows[0];
    if (!row) throw new Error('RECIPE_RESEARCH_SOURCE_NOT_FOUND');
    return row;
  }

  private async loadProductAliases(): Promise<ProductAliasCandidate[]> {
    const rows = await this.db.query<ProductAliasCandidate>(
      `SELECT p.id AS "productId",
              p."canonicalName",
              p.name,
              COALESCE(a.alias, p."canonicalName") AS alias,
              COALESCE(a."normalizedAlias", a.alias, p."canonicalName") AS "normalizedAlias",
              COALESCE(a.confidence, 1.0)::float AS confidence
       FROM "Product" p
       LEFT JOIN "ProductAlias" a ON a."productId" = p.id AND a.status = 'ACTIVE'
       WHERE p.status = 'ACTIVE'
       LIMIT 5000`,
    );
    return rows.rows;
  }

  private async computeCatalogStateChecksum(
    matrixVersion: string,
    query: SqlQuery = (text, values = []) => this.db.query(text, values),
  ): Promise<string> {
    const versions = await query<{
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
    const slots = await query<{ id: string; slotKey: string; status: string; published: number }>(
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

  private assertStaff(role: string) {
    const r = String(role ?? '').toUpperCase();
    if (r !== 'OWNER' && r !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  private async auditSafe(
    actorUserId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ) {
    await this.audit?.appendEvent({
      actorUserId: actorUserId ?? null,
      action,
      entityType,
      entityId: entityId ?? undefined,
      metadata,
    });
  }
}
