import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  assertCollectionModeAllowedForRights,
  assertRightsTransition,
  canEnableSource,
  evaluateSourceExecutionEligibility,
  FIXTURE_CAPABLE_ADAPTER_TYPES,
  isRecipeSourceCollectionMode,
  isRecipeSourceRightsStatus,
  listAllowedRightsTransitions,
  minimumEvidenceForRights,
  rightsStatusLabelRu,
  RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
  type RecipeSourceCollectionMode,
  type RecipeSourceEvidenceDecision,
  type RecipeSourceEvidenceType,
  type RecipeSourceRightsStatus,
} from '../domain/recipe-external-source.policy';
import { normalizeAndValidateSourceBaseUrl } from '../domain/recipe-source-network.policy';
import {
  assertNoClientControlledSourceFields,
  RecipeSourceAdapterError,
  type RecipeSourceExecutionContext,
  type RecipeSourceSearchInput,
} from '../domain/recipe-source-adapter.contract';
import { FoodRuSourceAdapter } from './food-ru/food-ru-source.adapter';
import { FOOD_RU_PARSER_VERSION } from './food-ru/food-ru.parser';
import { IamCookSourceAdapter } from './iamcook/iamcook-source.adapter';
import { IAMCOOK_PARSER_VERSION } from './iamcook/iamcook.parser';
import { RussianFoodSourceAdapter } from './russianfood/russianfood-source.adapter';
import { RUSSIANFOOD_PARSER_VERSION } from './russianfood/russianfood.parser';
import { RecipeSourceAdapterRegistry } from './recipe-source-adapter.registry';

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
export class RecipeExternalSourceService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RecipeSourceAdapterRegistry) private readonly adapters: RecipeSourceAdapterRegistry,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
  ) {}

  async listSources(filters?: { rightsStatus?: string; enabled?: boolean; dataClass?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters?.rightsStatus) {
      params.push(filters.rightsStatus);
      where.push(`"rightsStatus" = $${params.length}`);
    }
    if (filters?.enabled != null) {
      params.push(filters.enabled);
      where.push(`enabled = $${params.length}`);
    }
    if (filters?.dataClass) {
      params.push(filters.dataClass);
      where.push(`"dataClass" = $${params.length}`);
    }
    const sql = `SELECT s.*,
        (SELECT COUNT(*)::int FROM "RecipeSourcePolicyEvidence" e WHERE e."sourceId" = s.id) AS "evidenceCount"
      FROM "RecipeExternalSource" s
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.code ASC`;
    const rows = await this.db.query<SourceRow & { evidenceCount: number }>(sql, params);
    return {
      items: rows.rows.map((row) => this.toPublic(row, Number(row.evidenceCount))),
    };
  }

  async getSource(id: string) {
    const row = await this.requireSource(id);
    const evidence = await this.listEvidence(id);
    const eligibility = evaluateSourceExecutionEligibility(row);
    return {
      ...this.toPublic(row, evidence.items.length),
      evidence: evidence.items,
      allowedTransitions: listAllowedRightsTransitions(row.rightsStatus as RecipeSourceRightsStatus),
      execution: eligibility,
      rightsStatusLabelRu: rightsStatusLabelRu(row.rightsStatus),
    };
  }

  async createSource(input: {
    actorUserId: string;
    actorRole: string;
    code: string;
    name: string;
    baseUrl: string;
    adapterType?: string;
    collectionMode?: string;
    dataClass?: string;
    parserVersion?: string;
    rateLimitPerMinute?: number;
    concurrencyLimit?: number;
    requestTimeoutMs?: number;
    rawBody?: Record<string, unknown>;
  }) {
    assertNoClientControlledSourceFields(input.rawBody);
    this.assertStaff(input.actorRole);
    const code = this.normalizeCode(input.code);
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('RECIPE_SOURCE_NAME_REQUIRED');
    const allowHttp = input.dataClass === 'TEST_ONLY' || input.dataClass === 'FIXTURE';
    const base = normalizeAndValidateSourceBaseUrl(input.baseUrl, { allowHttpForTest: allowHttp });
    const adapterType = String(input.adapterType ?? 'NOT_CONFIGURED');
    if (!this.adapters.isAllowlistedType(adapterType)) {
      throw new Error('RECIPE_SOURCE_ADAPTER_TYPE_INVALID');
    }
    const dataClass = String(input.dataClass ?? 'PRODUCTION');
    if (!['PRODUCTION', 'TEST_ONLY', 'FIXTURE'].includes(dataClass)) {
      throw new Error('RECIPE_SOURCE_DATA_CLASS_INVALID');
    }
    if (adapterType === 'TEST_DETERMINISTIC' && dataClass === 'PRODUCTION') {
      throw new Error('RECIPE_SOURCE_TEST_ADAPTER_PRODUCTION_FORBIDDEN');
    }
    if (
      (adapterType === 'FOOD_RU' || adapterType === 'IAMCOOK' || adapterType === 'RUSSIANFOOD') &&
      dataClass === 'PRODUCTION'
    ) {
      // Production seeds stay NOT_CONFIGURED; fixture-bound rows must be TEST_ONLY/FIXTURE.
      throw new Error('RECIPE_SOURCE_FIXTURE_ADAPTER_PRODUCTION_BIND_FORBIDDEN');
    }
    const collectionMode = String(input.collectionMode ?? 'DISABLED');
    if (!isRecipeSourceCollectionMode(collectionMode)) {
      throw new Error('RECIPE_SOURCE_COLLECTION_MODE_INVALID');
    }
    assertCollectionModeAllowedForRights('PENDING_REVIEW', collectionMode as RecipeSourceCollectionMode);

    const defaultParser =
      adapterType === 'TEST_DETERMINISTIC'
        ? 'test-parser/v1'
        : adapterType === 'FOOD_RU'
          ? FOOD_RU_PARSER_VERSION
          : adapterType === 'IAMCOOK'
            ? IAMCOOK_PARSER_VERSION
            : adapterType === 'RUSSIANFOOD'
              ? RUSSIANFOOD_PARSER_VERSION
              : 'none';

    const inserted = await this.db.query<SourceRow>(
      `INSERT INTO "RecipeExternalSource" (
         code, name, "baseUrl", "adapterType", "rightsStatus", "collectionMode",
         "parserVersion", "rateLimitPerMinute", "concurrencyLimit", "requestTimeoutMs",
         enabled, "healthStatus", "dataClass", "policyReason"
       ) VALUES ($1,$2,$3,$4,'PENDING_REVIEW',$5,$6,$7,$8,$9,false,'UNKNOWN',$10,$11)
       RETURNING *`,
      [
        code,
        name,
        base.href,
        adapterType,
        collectionMode,
        String(input.parserVersion ?? defaultParser),
        Number(input.rateLimitPerMinute ?? 0),
        Number(input.concurrencyLimit ?? 0),
        Number(input.requestTimeoutMs ?? 5000),
        dataClass,
        'Created pending review',
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('RECIPE_SOURCE_CREATE_FAILED');
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.registered',
      entityType: 'RecipeExternalSource',
      entityId: row.id,
      metadata: { code: row.code, adapterType: row.adapterType, dataClass: row.dataClass },
    });
    return this.toPublic(row, 0);
  }

  async updateSource(input: {
    id: string;
    actorUserId: string;
    actorRole: string;
    name?: string;
    baseUrl?: string;
    adapterType?: string;
    collectionMode?: string;
    parserVersion?: string;
    rateLimitPerMinute?: number;
    concurrencyLimit?: number;
    requestTimeoutMs?: number;
    policyReason?: string;
    rawBody?: Record<string, unknown>;
  }) {
    assertNoClientControlledSourceFields(input.rawBody);
    this.assertStaff(input.actorRole);
    const current = await this.requireSource(input.id);
    const patch: string[] = [];
    const params: unknown[] = [];

    if (input.name != null) {
      params.push(String(input.name).trim());
      patch.push(`name = $${params.length}`);
    }
    if (input.baseUrl != null) {
      const allowHttp = current.dataClass === 'TEST_ONLY' || current.dataClass === 'FIXTURE';
      const base = normalizeAndValidateSourceBaseUrl(input.baseUrl, { allowHttpForTest: allowHttp });
      params.push(base.href);
      patch.push(`"baseUrl" = $${params.length}`);
    }
    if (input.adapterType != null) {
      const adapterType = String(input.adapterType);
      if (!this.adapters.isAllowlistedType(adapterType)) {
        throw new Error('RECIPE_SOURCE_ADAPTER_TYPE_INVALID');
      }
      if (adapterType === 'TEST_DETERMINISTIC' && current.dataClass === 'PRODUCTION') {
        throw new Error('RECIPE_SOURCE_TEST_ADAPTER_PRODUCTION_FORBIDDEN');
      }
      if (
        (adapterType === 'FOOD_RU' || adapterType === 'IAMCOOK' || adapterType === 'RUSSIANFOOD') &&
        current.dataClass === 'PRODUCTION'
      ) {
        throw new Error('RECIPE_SOURCE_FIXTURE_ADAPTER_PRODUCTION_BIND_FORBIDDEN');
      }
      params.push(adapterType);
      patch.push(`"adapterType" = $${params.length}`);
      if (input.parserVersion == null) {
        const autoParser =
          adapterType === 'FOOD_RU'
            ? FOOD_RU_PARSER_VERSION
            : adapterType === 'IAMCOOK'
              ? IAMCOOK_PARSER_VERSION
              : adapterType === 'RUSSIANFOOD'
                ? RUSSIANFOOD_PARSER_VERSION
                : null;
        if (autoParser) {
          params.push(autoParser);
          patch.push(`"parserVersion" = $${params.length}`);
        }
      }
    }
    if (input.collectionMode != null) {
      if (!isRecipeSourceCollectionMode(input.collectionMode)) {
        throw new Error('RECIPE_SOURCE_COLLECTION_MODE_INVALID');
      }
      assertCollectionModeAllowedForRights(
        current.rightsStatus as RecipeSourceRightsStatus,
        input.collectionMode as RecipeSourceCollectionMode,
      );
      params.push(input.collectionMode);
      patch.push(`"collectionMode" = $${params.length}`);
    }
    if (input.parserVersion != null) {
      params.push(String(input.parserVersion));
      patch.push(`"parserVersion" = $${params.length}`);
    }
    if (input.rateLimitPerMinute != null) {
      params.push(Number(input.rateLimitPerMinute));
      patch.push(`"rateLimitPerMinute" = $${params.length}`);
    }
    if (input.concurrencyLimit != null) {
      params.push(Number(input.concurrencyLimit));
      patch.push(`"concurrencyLimit" = $${params.length}`);
    }
    if (input.requestTimeoutMs != null) {
      params.push(Number(input.requestTimeoutMs));
      patch.push(`"requestTimeoutMs" = $${params.length}`);
    }
    if (input.policyReason != null) {
      params.push(String(input.policyReason));
      patch.push(`"policyReason" = $${params.length}`);
    }
    if (!patch.length) return this.getSource(input.id);

    params.push(input.id);
    const updated = await this.db.query<SourceRow>(
      `UPDATE "RecipeExternalSource"
       SET ${patch.join(', ')}, "updatedAt" = now()
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );
    const row = updated.rows[0];
    if (!row) throw new Error('RECIPE_SOURCE_NOT_FOUND');
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.updated',
      entityType: 'RecipeExternalSource',
      entityId: row.id,
      metadata: { fields: patch.map((p) => p.split('=')[0]?.trim()) },
    });
    return this.getSource(row.id);
  }

  async listEvidence(sourceId: string) {
    await this.requireSource(sourceId);
    const rows = await this.db.query(
      `SELECT id, "sourceId", "evidenceType", "referenceUrl", "documentReference",
              "reviewedBy", "reviewedAt", "validFrom", "validUntil", decision, notes,
              checksum, "attachmentRef", "createdAt"
       FROM "RecipeSourcePolicyEvidence"
       WHERE "sourceId" = $1
       ORDER BY "createdAt" DESC`,
      [sourceId],
    );
    return {
      items: rows.rows.map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        evidenceType: e.evidenceType,
        referenceUrl: e.referenceUrl,
        documentReference: e.documentReference,
        reviewedBy: e.reviewedBy,
        reviewedAt: e.reviewedAt,
        validFrom: e.validFrom,
        validUntil: e.validUntil,
        decision: e.decision,
        notes: e.notes,
        checksum: e.checksum,
        // Never expose attachment binary; only opaque ref if present
        hasAttachment: Boolean(e.attachmentRef),
        createdAt: e.createdAt,
      })),
    };
  }

  async addEvidence(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
    evidenceType: string;
    decision: string;
    referenceUrl?: string | null;
    documentReference?: string | null;
    notes?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
    checksum?: string | null;
    rawBody?: Record<string, unknown>;
  }) {
    assertNoClientControlledSourceFields(input.rawBody);
    this.assertStaff(input.actorRole);
    await this.requireSource(input.sourceId);
    const evidenceType = String(input.evidenceType) as RecipeSourceEvidenceType;
    const decision = String(input.decision) as RecipeSourceEvidenceDecision;
    const allowedTypes = [
      'CONTRACT',
      'LICENSE',
      'TERMS_REVIEW',
      'EMAIL_PERMISSION',
      'PUBLICATION_POLICY',
      'OWNER_DECISION',
      'REFUSAL',
      'LEGAL_REVIEW',
    ];
    if (!allowedTypes.includes(evidenceType)) throw new Error('RECIPE_SOURCE_EVIDENCE_TYPE_INVALID');
    if (!['ALLOW', 'DENY', 'CONDITIONAL', 'REVIEW_REQUIRED'].includes(decision)) {
      throw new Error('RECIPE_SOURCE_EVIDENCE_DECISION_INVALID');
    }
    const inserted = await this.db.query(
      `INSERT INTO "RecipeSourcePolicyEvidence" (
         "sourceId", "evidenceType", "referenceUrl", "documentReference",
         "reviewedBy", "reviewedAt", "validFrom", "validUntil", decision, notes, checksum
       ) VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.sourceId,
        evidenceType,
        input.referenceUrl ?? null,
        input.documentReference ?? null,
        input.actorUserId,
        input.validFrom ? new Date(input.validFrom) : null,
        input.validUntil ? new Date(input.validUntil) : null,
        decision,
        input.notes ?? null,
        input.checksum ?? null,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.evidence_added',
      entityType: 'RecipeSourcePolicyEvidence',
      entityId: String(inserted.rows[0]?.id),
      metadata: { sourceId: input.sourceId, evidenceType, decision },
    });
    return this.listEvidence(input.sourceId);
  }

  async reviewSource(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
    toStatus: string;
    reason: string;
    reviewExpiresAt?: string | null;
    collectionMode?: string;
    rawBody?: Record<string, unknown>;
  }) {
    assertNoClientControlledSourceFields(input.rawBody);
    this.assertOwner(input.actorRole);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_SOURCE_REVIEW_REASON_REQUIRED');
    if (!isRecipeSourceRightsStatus(input.toStatus)) {
      throw new Error('RECIPE_SOURCE_RIGHTS_STATUS_INVALID');
    }
    const current = await this.requireSource(input.sourceId);
    const from = current.rightsStatus as RecipeSourceRightsStatus;
    const to = input.toStatus as RecipeSourceRightsStatus;
    assertRightsTransition(from, to);

    if (to === 'DISABLED_BY_TERMS' || to === 'DISABLED_BY_REFUSAL' || from === 'DISABLED_BY_TERMS' || from === 'DISABLED_BY_REFUSAL') {
      // restore or enter disabled requires OWNER (already) + evidence
    }
    if (
      (from === 'DISABLED_BY_TERMS' || from === 'DISABLED_BY_REFUSAL') &&
      to !== from
    ) {
      await this.assertHasRequiredEvidence(input.sourceId, to);
    } else if (['ACTIVE_LICENSED', 'PUBLIC_RESEARCH_ALLOWED', 'MANUAL_RESEARCH_ONLY'].includes(to)) {
      await this.assertHasRequiredEvidence(input.sourceId, to);
    }

    let collectionMode = current.collectionMode as RecipeSourceCollectionMode;
    if (input.collectionMode) {
      if (!isRecipeSourceCollectionMode(input.collectionMode)) {
        throw new Error('RECIPE_SOURCE_COLLECTION_MODE_INVALID');
      }
      collectionMode = input.collectionMode as RecipeSourceCollectionMode;
    }
    assertCollectionModeAllowedForRights(to, collectionMode);

    const enableable = canEnableSource({
      rightsStatus: to,
      collectionMode,
      adapterType: current.adapterType,
      reviewExpiresAt: input.reviewExpiresAt ?? current.reviewExpiresAt,
    });
    const enabled = current.enabled && enableable.ok ? true : false;

    const updated = await this.db.query<SourceRow>(
      `UPDATE "RecipeExternalSource"
       SET "rightsStatus" = $2,
           "collectionMode" = $3,
           "policyReason" = $4,
           "reviewedBy" = $5,
           "reviewedAt" = now(),
           "reviewExpiresAt" = $6,
           enabled = $7,
           "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [
        input.sourceId,
        to,
        collectionMode,
        reason,
        input.actorUserId,
        input.reviewExpiresAt ? new Date(input.reviewExpiresAt) : null,
        enabled,
      ],
    );
    const row = updated.rows[0]!;
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.rights_reviewed',
      entityType: 'RecipeExternalSource',
      entityId: row.id,
      metadata: { from, to, reason, enabled },
    });
    if (to === 'DISABLED_BY_TERMS') {
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.disabled_by_terms',
        entityType: 'RecipeExternalSource',
        entityId: row.id,
        metadata: { reason },
      });
    }
    if (to === 'DISABLED_BY_REFUSAL') {
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.disabled_by_refusal',
        entityType: 'RecipeExternalSource',
        entityId: row.id,
        metadata: { reason },
      });
    }
    if (to === 'SUSPENDED') {
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.suspended',
        entityType: 'RecipeExternalSource',
        entityId: row.id,
        metadata: { reason },
      });
    }
    return this.getSource(row.id);
  }

  async enableSource(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    rawBody?: Record<string, unknown>;
  }) {
    assertNoClientControlledSourceFields(input.rawBody);
    this.assertOwner(input.actorRole);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_SOURCE_ENABLE_REASON_REQUIRED');
    const current = await this.requireSource(input.sourceId);
    const gate = canEnableSource({
      rightsStatus: current.rightsStatus as RecipeSourceRightsStatus,
      collectionMode: current.collectionMode as RecipeSourceCollectionMode,
      adapterType: current.adapterType,
      reviewExpiresAt: current.reviewExpiresAt,
    });
    if (!gate.ok) {
      throw new Error(`RECIPE_SOURCE_ENABLE_BLOCKED:${gate.reason}`);
    }
    const updated = await this.db.query<SourceRow>(
      `UPDATE "RecipeExternalSource"
       SET enabled = true, "policyReason" = $2, "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [input.sourceId, reason],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.enabled',
      entityType: 'RecipeExternalSource',
      entityId: input.sourceId,
      metadata: { reason },
    });
    return this.getSource(updated.rows[0]!.id);
  }

  async disableSource(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    rawBody?: Record<string, unknown>;
  }) {
    assertNoClientControlledSourceFields(input.rawBody);
    this.assertStaff(input.actorRole);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new Error('RECIPE_SOURCE_DISABLE_REASON_REQUIRED');
    await this.requireSource(input.sourceId);
    await this.db.query(
      `UPDATE "RecipeExternalSource"
       SET enabled = false, "policyReason" = $2, "updatedAt" = now()
       WHERE id = $1`,
      [input.sourceId, reason],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.suspended',
      entityType: 'RecipeExternalSource',
      entityId: input.sourceId,
      metadata: { reason, enabled: false },
    });
    return this.getSource(input.sourceId);
  }

  /**
   * Configuration / test-adapter health check only — never hits production domains.
   */
  async configurationHealthCheck(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
  }) {
    this.assertStaff(input.actorRole);
    const source = await this.requireSource(input.sourceId);
    const eligibility = evaluateSourceExecutionEligibility(source);

    if (source.adapterType === 'NOT_CONFIGURED') {
      await this.db.query(
        `UPDATE "RecipeExternalSource"
         SET "healthStatus" = 'CONFIGURATION_ERROR',
             "lastFailureAt" = now(),
             "failureCount" = "failureCount" + 1,
             "lastErrorCode" = 'CONFIGURATION_ERROR',
             "lastErrorMessage" = $2,
             "updatedAt" = now()
         WHERE id = $1`,
        [source.id, 'Adapter not configured'],
      );
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.adapter_config_validated',
        entityType: 'RecipeExternalSource',
        entityId: source.id,
        metadata: { ok: false, reason: 'NOT_CONFIGURED' },
      });
      return {
        ok: false,
        status: 'CONFIGURATION_ERROR',
        details: 'Adapter not configured',
        eligibility,
        networkCalls: 0,
      };
    }

    if (!this.adapters.has(source.adapterType)) {
      await this.db.query(
        `UPDATE "RecipeExternalSource"
         SET "healthStatus" = 'CONFIGURATION_ERROR',
             "lastFailureAt" = now(),
             "failureCount" = "failureCount" + 1,
             "lastErrorCode" = 'CONTRACT_MISMATCH',
             "lastErrorMessage" = $2,
             "updatedAt" = now()
         WHERE id = $1`,
        [source.id, 'Unknown adapter type'],
      );
      return {
        ok: false,
        status: 'CONFIGURATION_ERROR',
        details: 'Unknown adapter type',
        eligibility,
        networkCalls: 0,
      };
    }

    if (source.adapterType === 'TEST_DETERMINISTIC') {
      if (source.dataClass === 'PRODUCTION') {
        return {
          ok: false,
          status: 'CONFIGURATION_ERROR',
          details: 'Test adapter cannot bind PRODUCTION source',
          eligibility,
          networkCalls: 0,
          pilotReadiness: this.buildPilotReadiness(source),
        };
      }
      const adapter = this.adapters.getOrThrow('TEST_DETERMINISTIC');
      const ctx = this.buildContext(source, input.actorUserId, true);
      const result = await adapter.healthCheck?.(ctx);
      await this.db.query(
        `UPDATE "RecipeExternalSource"
         SET "healthStatus" = 'HEALTHY',
             "lastSuccessfulCheckAt" = now(),
             "lastErrorCode" = NULL,
             "lastErrorMessage" = NULL,
             "updatedAt" = now()
         WHERE id = $1`,
        [source.id],
      );
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.adapter_config_validated',
        entityType: 'RecipeExternalSource',
        entityId: source.id,
        metadata: { ok: true, adapterType: source.adapterType, networkCalls: 0 },
      });
      return { ...result, eligibility, networkCalls: 0, pilotReadiness: this.buildPilotReadiness(source) };
    }

    if (
      source.adapterType === 'FOOD_RU' ||
      source.adapterType === 'IAMCOOK' ||
      source.adapterType === 'RUSSIANFOOD' ||
      source.code === 'food_ru' ||
      source.code === 'iamcook' ||
      source.code === 'russianfood'
    ) {
      const readiness = this.buildPilotReadiness(source);
      const bound =
        (source.adapterType === 'FOOD_RU' ||
          source.adapterType === 'IAMCOOK' ||
          source.adapterType === 'RUSSIANFOOD') &&
        source.dataClass !== 'PRODUCTION';
      if (!bound) {
        await this.db.query(
          `UPDATE "RecipeExternalSource"
           SET "healthStatus" = 'UNKNOWN',
               "lastErrorCode" = 'LIVE_EXECUTION_DISABLED',
               "lastErrorMessage" = $2,
               "updatedAt" = now()
           WHERE id = $1`,
          [source.id, 'Live HTTP policy-blocked; fixture mode not bound on PRODUCTION row'],
        );
        await this.audit?.appendEvent({
          actorUserId: input.actorUserId,
          action: 'recipe.source.adapter_config_validated',
          entityType: 'RecipeExternalSource',
          entityId: source.id,
          metadata: {
            ok: true,
            adapterType: source.adapterType,
            liveExecutionStatus: 'POLICY_BLOCKED',
            networkCalls: 0,
          },
        });
        return {
          ok: true,
          status: 'UNKNOWN',
          details: `${source.code} adapter implemented; live execution POLICY_BLOCKED; networkCalls=0`,
          eligibility,
          networkCalls: 0,
          pilotReadiness: readiness,
        };
      }
      const adapter = this.adapters.getOrThrow(source.adapterType);
      const ctx = this.buildContext(source, input.actorUserId, true);
      const result = await adapter.healthCheck?.(ctx);
      const parserVersion =
        source.adapterType === 'FOOD_RU'
          ? FOOD_RU_PARSER_VERSION
          : source.adapterType === 'IAMCOOK'
            ? IAMCOOK_PARSER_VERSION
            : RUSSIANFOOD_PARSER_VERSION;
      await this.db.query(
        `UPDATE "RecipeExternalSource"
         SET "healthStatus" = 'HEALTHY',
             "lastSuccessfulCheckAt" = now(),
             "lastErrorCode" = NULL,
             "lastErrorMessage" = NULL,
             "parserVersion" = $2,
             "updatedAt" = now()
         WHERE id = $1`,
        [source.id, parserVersion],
      );
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.adapter_config_validated',
        entityType: 'RecipeExternalSource',
        entityId: source.id,
        metadata: {
          ok: true,
          adapterType: source.adapterType,
          mode: 'FIXTURE',
          liveExecutionStatus: 'POLICY_BLOCKED',
          networkCalls: 0,
        },
      });
      return {
        ...result,
        eligibility,
        networkCalls: 0,
        pilotReadiness: { ...readiness, lastFixtureRunAt: new Date().toISOString() },
      };
    }

    await this.db.query(
      `UPDATE "RecipeExternalSource"
       SET "healthStatus" = 'UNKNOWN', "updatedAt" = now()
       WHERE id = $1`,
      [source.id],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.adapter_config_validated',
      entityType: 'RecipeExternalSource',
      entityId: source.id,
      metadata: { ok: true, adapterType: source.adapterType, networkCalls: 0 },
    });
    return {
      ok: true,
      status: 'UNKNOWN',
      details: 'Configuration validated; no network call performed',
      eligibility,
      networkCalls: 0,
      pilotReadiness: this.buildPilotReadiness(source),
    };
  }

  /**
   * Resolve adapter only after execution policy — used by STEP_215/216 orchestrators.
   * Live FOOD_RU resolves to adapter with testMode=false (transport LIVE_DISABLED).
   */
  resolveExecutableAdapter(source: SourceRow, actorUserId: string | null) {
    const eligibility = evaluateSourceExecutionEligibility(source);
    if (!eligibility.automatedAllowed) {
      void this.audit?.appendEvent({
        actorUserId: actorUserId ?? 'system',
        action: 'recipe.source.execution_blocked',
        entityType: 'RecipeExternalSource',
        entityId: source.id,
        metadata: { eligibility: eligibility.eligibility, reason: eligibility.reason },
      });
      throw new RecipeSourceAdapterError({
        code:
          eligibility.eligibility === 'RATE_LIMIT_BLOCKED'
            ? 'RATE_LIMITED'
            : eligibility.eligibility === 'RIGHTS_BLOCKED' ||
                eligibility.eligibility === 'TEMPORARILY_SUSPENDED'
              ? 'RIGHTS_BLOCKED'
              : 'SOURCE_DISABLED',
        sourceCode: source.code,
        operation: 'resolve',
        retryable: false,
        safeMessage: eligibility.reason,
        correlationId: randomUUID(),
        parserVersion: source.parserVersion,
      });
    }
    const adapter = this.adapters.getOrThrow(source.adapterType);
    const fixtureCapable =
      (FIXTURE_CAPABLE_ADAPTER_TYPES as readonly string[]).includes(source.adapterType) &&
      (source.adapterType === 'TEST_DETERMINISTIC' || source.dataClass !== 'PRODUCTION');
    return {
      adapter,
      context: this.buildContext(source, actorUserId, fixtureCapable),
      eligibility,
    };
  }

  /**
   * Fixture-only resolve — never opens live sockets. Requires TEST_ONLY/FIXTURE dataClass.
   */
  resolveFixtureExecutableAdapter(source: SourceRow, actorUserId: string | null) {
    if (source.dataClass === 'PRODUCTION') {
      void this.audit?.appendEvent({
        actorUserId: actorUserId ?? 'system',
        action: 'recipe.source.execution_blocked',
        entityType: 'RecipeExternalSource',
        entityId: source.id,
        metadata: { reason: 'LIVE_EXECUTION_DISABLED', networkCalls: 0 },
      });
      throw new RecipeSourceAdapterError({
        code: 'LIVE_EXECUTION_DISABLED',
        sourceCode: source.code,
        operation: 'resolveFixture',
        retryable: false,
        safeMessage: 'Live Food.ru HTTP is policy-blocked; use TEST_ONLY fixture source',
        correlationId: randomUUID(),
        parserVersion: source.parserVersion,
      });
    }
    if (!(FIXTURE_CAPABLE_ADAPTER_TYPES as readonly string[]).includes(source.adapterType)) {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: source.code,
        operation: 'resolveFixture',
        retryable: false,
        safeMessage: 'Fixture adapter type not configured',
        correlationId: randomUUID(),
        parserVersion: source.parserVersion,
      });
    }
    const adapter = this.adapters.getOrThrow(source.adapterType);
    return {
      adapter,
      context: this.buildContext(source, actorUserId, true),
      networkCalls: 0 as const,
    };
  }

  async runTestSearch(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
    search: RecipeSourceSearchInput;
  }) {
    this.assertStaff(input.actorRole);
    const source = await this.requireSource(input.sourceId);
    if (
      !(FIXTURE_CAPABLE_ADAPTER_TYPES as readonly string[]).includes(source.adapterType) ||
      source.dataClass === 'PRODUCTION'
    ) {
      throw new Error('RECIPE_SOURCE_TEST_ADAPTER_ONLY');
    }
    if (
      source.rightsStatus !== 'ACTIVE_LICENSED' &&
      source.rightsStatus !== 'PUBLIC_RESEARCH_ALLOWED'
    ) {
      throw new Error('RECIPE_SOURCE_TEST_RUN_RIGHTS_REQUIRED');
    }
    const { adapter, context } = this.resolveFixtureExecutableAdapter(source, input.actorUserId);
    const cards = await adapter.searchByProducts(input.search, context);
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.source.fixture_search',
      entityType: 'RecipeExternalSource',
      entityId: source.id,
      metadata: {
        adapterType: source.adapterType,
        cardCount: cards.length,
        networkCalls: 0,
        liveExecutionStatus:
          source.adapterType === 'TEST_DETERMINISTIC' ? 'N/A' : 'POLICY_BLOCKED',
      },
    });
    return {
      cards,
      networkCalls: 0,
      parserVersion: adapter.parserVersion,
      contractVersion: adapter.contractVersion,
      liveExecutionStatus:
        source.adapterType === 'TEST_DETERMINISTIC' ? 'N/A' : 'POLICY_BLOCKED',
    };
  }

  async runLiveBlockedProbe(input: {
    sourceId: string;
    actorUserId: string;
    actorRole: string;
    externalId?: string;
  }) {
    this.assertStaff(input.actorRole);
    const source = await this.requireSource(input.sourceId);
    const adapterType =
      source.adapterType === 'FOOD_RU' ||
      source.adapterType === 'IAMCOOK' ||
      source.adapterType === 'RUSSIANFOOD'
        ? source.adapterType
        : source.code === 'food_ru'
          ? 'FOOD_RU'
          : source.code === 'iamcook'
            ? 'IAMCOOK'
            : source.code === 'russianfood'
              ? 'RUSSIANFOOD'
              : null;
    if (!adapterType) {
      throw new Error('RECIPE_SOURCE_FIXTURE_ADAPTER_ONLY');
    }
    const adapter = this.adapters.getOrThrow(adapterType);
    const code =
      adapterType === 'FOOD_RU'
        ? 'food_ru'
        : adapterType === 'IAMCOOK'
          ? 'iamcook'
          : 'russianfood';
    const context = this.buildContext(
      { ...source, adapterType, code },
      input.actorUserId,
      false,
    );
    try {
      await adapter.fetchCandidate(input.externalId ?? 'synthetic-chicken-buckwheat', context);
      throw new Error('RECIPE_SOURCE_LIVE_PROBE_UNEXPECTED_SUCCESS');
    } catch (error) {
      if (!(error instanceof RecipeSourceAdapterError) || error.code !== 'LIVE_EXECUTION_DISABLED') {
        throw error;
      }
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.source.live_execution_blocked',
        entityType: 'RecipeExternalSource',
        entityId: source.id,
        metadata: { code: error.code, networkCalls: 0 },
      });
      return {
        blocked: true,
        code: error.code,
        networkCalls: 0,
        liveExecutionStatus: 'POLICY_BLOCKED' as const,
        message: error.safeMessage,
      };
    }
  }

  private buildContext(
    source: SourceRow,
    actorUserId: string | null,
    testMode: boolean,
  ): RecipeSourceExecutionContext {
    let hostname = 'fixtures.local';
    try {
      hostname = new URL(source.baseUrl).hostname;
    } catch {
      // keep default for test
    }
    return {
      sourceId: source.id,
      sourceCode: source.code,
      adapterType: source.adapterType,
      parserVersion: source.parserVersion,
      collectionMode: source.collectionMode,
      correlationId: randomUUID(),
      actorUserId,
      allowlistedHostnames: [hostname],
      requestTimeoutMs: source.requestTimeoutMs,
      rateLimitPerMinute: source.rateLimitPerMinute,
      testMode,
    };
  }

  private buildPilotReadiness(row: SourceRow) {
    const fixtureAdapterType =
      row.adapterType === 'FOOD_RU' ||
      row.adapterType === 'IAMCOOK' ||
      row.adapterType === 'RUSSIANFOOD'
        ? row.adapterType
        : row.code === 'food_ru'
          ? 'FOOD_RU'
          : row.code === 'iamcook'
            ? 'IAMCOOK'
            : row.code === 'russianfood'
              ? 'RUSSIANFOOD'
              : null;

    if (fixtureAdapterType) {
      type PilotBase = {
        sourceCode: string;
        implementationStatus: string;
        liveExecutionStatus: string;
        fixtureMode: string;
        parserVersion: string | null;
        contractVersion: string;
        lastLiveRunAt: string | null;
        lastFixtureRunAt: string | null;
        networkCalls: number;
        publicationRights: string;
        imageReuseRights: string;
        circuitState: string;
        continuousLiveCollectionAllowed?: boolean;
        controlledPilotAllowed?: boolean;
      };
      let base: PilotBase | null = null;
      if (this.adapters.has(fixtureAdapterType)) {
        const adapter = this.adapters.getOrThrow(fixtureAdapterType) as
          | FoodRuSourceAdapter
          | IamCookSourceAdapter
          | RussianFoodSourceAdapter;
        if ('getPilotReadiness' in adapter) base = adapter.getPilotReadiness();
      }
      const fallbackCode =
        fixtureAdapterType === 'FOOD_RU'
          ? 'food_ru'
          : fixtureAdapterType === 'IAMCOOK'
            ? 'iamcook'
            : 'russianfood';
      const resolved = base ?? {
        sourceCode: fallbackCode,
        implementationStatus: 'NOT_CONFIGURED' as const,
        liveExecutionStatus: 'POLICY_BLOCKED' as const,
        fixtureMode: 'UNAVAILABLE' as const,
        parserVersion: null,
        contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
        lastLiveRunAt: null,
        lastFixtureRunAt: null,
        networkCalls: 0,
        publicationRights: 'NOT_CONFIRMED' as const,
        imageReuseRights: 'NOT_CONFIRMED' as const,
        circuitState: 'CLOSED' as const,
        continuousLiveCollectionAllowed: false,
        controlledPilotAllowed: false,
      };
      return {
        ...resolved,
        dbAdapterType: row.adapterType,
        enabled: row.enabled,
        rightsStatus: row.rightsStatus,
        collectionMode: row.collectionMode,
        dataClass: row.dataClass,
        retentionClass: row.dataClass === 'PRODUCTION' ? 'METADATA_ONLY' : 'TEST_FIXTURE',
        lastSafeErrorCode: row.lastErrorCode,
        consecutiveFailures: row.failureCount,
        lastSuccessfulRunAt: row.lastSuccessfulCheckAt,
        lastFailedRunAt: row.lastFailureAt,
        circuitState: row.healthStatus === 'CIRCUIT_OPEN' ? 'OPEN' : 'CLOSED',
        continuousLiveCollectionAllowed: false,
        controlledPilotAllowed: false,
        publicationRights: 'NOT_CONFIRMED',
        imageReuseRights: 'NOT_CONFIRMED',
      };
    }
    return {
      implementationStatus: row.adapterType === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'REGISTERED',
      liveExecutionStatus: 'DISABLED',
      fixtureMode: row.adapterType === 'TEST_DETERMINISTIC' ? 'AVAILABLE' : 'UNAVAILABLE',
      parserVersion: row.parserVersion,
      contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
      networkCalls: 0,
      dbAdapterType: row.adapterType,
      enabled: row.enabled,
    };
  }

  private async assertHasRequiredEvidence(sourceId: string, target: RecipeSourceRightsStatus) {
    const needed = minimumEvidenceForRights(target);
    if (!needed.length) return;
    const rows = await this.db.query<{ evidenceType: string }>(
      `SELECT "evidenceType" FROM "RecipeSourcePolicyEvidence"
       WHERE "sourceId" = $1 AND decision IN ('ALLOW', 'CONDITIONAL')`,
      [sourceId],
    );
    const have = new Set(rows.rows.map((r) => r.evidenceType));
    const ok = needed.some((t) => have.has(t));
    if (!ok) throw new Error('RECIPE_SOURCE_EVIDENCE_REQUIRED');
  }

  private async requireSource(id: string): Promise<SourceRow> {
    const rows = await this.db.query<SourceRow>(
      `SELECT * FROM "RecipeExternalSource" WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = rows.rows[0];
    if (!row) throw new Error('RECIPE_SOURCE_NOT_FOUND');
    return row;
  }

  private toPublic(row: SourceRow, evidenceCount: number) {
    const eligibility = evaluateSourceExecutionEligibility(row);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      baseUrl: row.baseUrl,
      adapterType: row.adapterType,
      rightsStatus: row.rightsStatus,
      rightsStatusLabelRu: rightsStatusLabelRu(row.rightsStatus),
      collectionMode: row.collectionMode,
      parserVersion: row.parserVersion,
      contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
      rateLimitPerMinute: row.rateLimitPerMinute,
      concurrencyLimit: row.concurrencyLimit,
      requestTimeoutMs: row.requestTimeoutMs,
      enabled: row.enabled,
      healthStatus: row.healthStatus,
      lastSuccessfulCheckAt: row.lastSuccessfulCheckAt,
      lastFailureAt: row.lastFailureAt,
      failureCount: row.failureCount,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewExpiresAt: row.reviewExpiresAt,
      policyReason: row.policyReason,
      dataClass: row.dataClass,
      evidenceCount,
      execution: eligibility,
      blockingReason: eligibility.automatedAllowed ? null : eligibility.reason,
      pilotReadiness: this.buildPilotReadiness(row),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private normalizeCode(code: string): string {
    const normalized = String(code ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!normalized || normalized.length > 64) throw new Error('RECIPE_SOURCE_CODE_INVALID');
    return normalized;
  }

  private assertStaff(role: string) {
    const r = String(role ?? '').toUpperCase();
    if (r !== 'OWNER' && r !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  private assertOwner(role: string) {
    if (String(role ?? '').toUpperCase() !== 'OWNER') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }
}
