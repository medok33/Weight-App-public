import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import { ShoppingListService } from '../../shopping-list/application/shopping-list.service';
import {
  hashConfirmRequest,
  hashSnapshot,
  issueConfirmationToken,
  validateIdempotencyKey,
  verifyConfirmationToken,
} from '../domain/revision-confirmation.token';
import { assertConfirmedForPersist, validatePreviewRequest, validateRevision } from '../domain/revision-engine.policy';
import { assertPlanKind, buildMealProposal, buildWorkoutProposal } from '../domain/revision-proposal.policy';
import type {
  ConfirmRevisionInput,
  ConfirmRevisionResult,
  PlanKind,
  PlanRevision,
  RevisionChangedItem,
  RevisionPreview,
  RevisionRequest,
  RevisionResult,
  RevisionSnapshot,
} from '../domain/revision-engine.types';
import { isUniqueViolation, RevisionEngineRepository } from '../infrastructure/revision-engine.repository';

export type StructuredRevisionPreviewInput = {
  reason: string;
  operation: Record<string, unknown>;
  days: {
    dayIndex: number;
    meals: {
      name: string;
      recipeId?: string;
      mealType?: string;
      plannedTime?: string;
      portionGrams?: number;
      mealItemId?: string;
    }[];
  }[];
  summary: string;
  changedItems: RevisionChangedItem[];
  warnings: string[];
};

@Injectable()
export class RevisionEngineService {
  constructor(
    @Inject(RevisionEngineRepository) private readonly repository: RevisionEngineRepository,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(ShoppingListService) private readonly shopping?: ShoppingListService,
  ) {}

  /**
   * Legacy gate: pending preview stays in-memory/UI; confirmed persists.
   */
  async revise(request: RevisionRequest): Promise<RevisionResult | PlanRevision> {
    const validation = validateRevision(request);
    if (validation.status !== 'confirmed') return validation;
    return this.persistConfirmed(request);
  }

  async createRevision(request: RevisionRequest): Promise<PlanRevision> {
    validateRevision(request);
    assertConfirmedForPersist(request);
    return this.persistConfirmed(request);
  }

  async preview(userId: string, planId: string, planKindInput: string, reason: string): Promise<RevisionPreview> {
    const planKind = assertPlanKind(planKindInput);
    validatePreviewRequest({ planId, planKind, reason });
    await this.emit('plan_revision_preview_requested', userId, planId, { planKind });

    try {
      const built = await this.buildProposal(userId, planId, planKind, reason.trim());
      const confirmationToken = issueConfirmationToken({
        userId,
        planId,
        planKind,
        sourceVersion: built.currentVersion,
        reason: reason.trim(),
        snapshotHash: hashSnapshot(built.proposedSnapshot),
      });
      const preview: RevisionPreview = {
        planId,
        planKind,
        currentVersion: built.currentVersion,
        proposedVersion: built.currentVersion + 1,
        reason: reason.trim(),
        summary: built.summary,
        changedItems: built.changedItems,
        warnings: built.warnings,
        validationStatus: built.changedItems.length ? 'ok' : 'warning',
        confirmationToken,
        proposedSnapshot: built.proposedSnapshot,
      };
      await this.emit('plan_revision_preview_succeeded', userId, planId, {
        planKind,
        changeCount: built.changedItems.length,
      });
      return preview;
    } catch (error) {
      await this.emit('plan_revision_preview_failed', userId, planId, {
        planKind,
        code: error instanceof Error ? error.message : 'REVISION_PREVIEW_FAILED',
      });
      throw error;
    }
  }

  /**
   * Structured meal substitution preview (STEP_093).
   * Confirm still goes through the same token + idempotency path.
   */
  async previewStructured(userId: string, planId: string, input: StructuredRevisionPreviewInput): Promise<RevisionPreview> {
    validatePreviewRequest({ planId, planKind: 'meal', reason: input.reason });
    const source = await this.repository.loadMealPlan(userId, planId);
    if (!source) throw new Error('REVISION_PLAN_FORBIDDEN');

    const proposedSnapshot: RevisionSnapshot = {
      kind: 'meal',
      sourcePlanId: planId,
      sourceVersion: source.version,
      reason: input.reason,
      operation: input.operation,
      days: input.days,
    };

    const confirmationToken = issueConfirmationToken({
      userId,
      planId,
      planKind: 'meal',
      sourceVersion: source.version,
      reason: input.reason,
      snapshotHash: hashSnapshot(proposedSnapshot),
      operationJson: JSON.stringify({
        operation: input.operation,
        days: input.days,
        summary: input.summary,
        changedItems: input.changedItems,
        warnings: input.warnings,
      }),
    });

    await this.emit('plan_revision_preview_succeeded', userId, planId, {
      planKind: 'meal',
      changeCount: input.changedItems.length,
      structured: true,
    });

    return {
      planId,
      planKind: 'meal',
      currentVersion: source.version,
      proposedVersion: source.version + 1,
      reason: input.reason,
      summary: input.summary,
      changedItems: input.changedItems,
      warnings: input.warnings,
      validationStatus: input.changedItems.length ? 'ok' : 'warning',
      confirmationToken,
      proposedSnapshot,
    };
  }

  async confirm(input: ConfirmRevisionInput): Promise<ConfirmRevisionResult> {
    const planKind = assertPlanKind(input.planKind);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const requestHash = hashConfirmRequest({
      planId: input.planId,
      planKind,
      confirmationToken: input.confirmationToken,
    });

    try {
      const result = await this.repository.withTransaction(async (query) => {
        await query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          input.userId,
          `idempotency:${idempotencyKey}`,
        ]);

        const existing = await this.repository.findByIdempotencyInTransaction(query, input.userId, idempotencyKey);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          await this.emit('plan_revision_idempotent_replay', input.userId, existing.planId, { planKind });
          const activePlanId = String(existing.snapshot.activePlanId ?? existing.planId);
          const activeVersion = Number(existing.snapshot.activeVersion ?? existing.version);
          return {
            revision: existing,
            activePlanId,
            activeVersion,
            idempotentReplay: true,
          };
        }

        const token = verifyConfirmationToken(input.confirmationToken, {
          userId: input.userId,
          planId: input.planId,
          planKind,
        });

        // Immutable plan rows keep a fixed version; staleness is "active lineage moved on".
        const active = await this.repository.findActivePlanMeta(query, input.userId, planKind);
        if (!active || active.id !== input.planId || active.version !== token.sourceVersion) {
          throw new Error('REVISION_PREVIEW_STALE');
        }

        const built = token.operationJson
          ? this.buildStructuredFromToken(token.reason, token.operationJson, input.planId, token.sourceVersion)
          : await this.buildProposal(input.userId, input.planId, planKind, token.reason);
        if (built.currentVersion !== token.sourceVersion) throw new Error('REVISION_PREVIEW_STALE');
        if (hashSnapshot(built.proposedSnapshot) !== token.snapshotHash) throw new Error('REVISION_SNAPSHOT_MISMATCH');

        // Candidate must still resolve for structured substitutions
        const operation = built.proposedSnapshot.operation as { targetRecipeId?: string | null; candidateId?: string } | undefined;
        if (operation?.targetRecipeId && typeof operation.targetRecipeId === 'string') {
          const exists = await query<{ ok: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM "Recipe" WHERE id = $1) AS ok`,
            [operation.targetRecipeId],
          );
          if (!exists.rows[0]?.ok) throw new Error('REVISION_CANDIDATE_UNAVAILABLE');
        }

        const nextPlanVersion = await this.repository.nextPlanVersion(query, input.userId, planKind);
        let activePlanId: string;
        if (planKind === 'meal') {
          const days =
            (built.proposedSnapshot.days as {
              dayIndex: number;
              meals: {
                name: string;
                recipeId?: string;
                recipeVersionId?: string;
                mealType?: string;
                plannedTime?: string;
                portionGrams?: number;
                customizationSnapshotJson?: unknown;
                contentProvenance?: string;
              }[];
            }[]) ?? [];
          activePlanId = await this.repository.applyMealSnapshot(query, input.userId, nextPlanVersion, days);
        } else {
          const days =
            (built.proposedSnapshot.days as {
              dayIndex: number;
              exercises: { name: string; riskLevel: string }[];
            }[]) ?? [];
          activePlanId = await this.repository.applyWorkoutSnapshot(query, input.userId, nextPlanVersion, days);
        }

        const snapshot: RevisionSnapshot = {
          ...built.proposedSnapshot,
          activePlanId,
          activeVersion: nextPlanVersion,
          sourcePlanId: input.planId,
        };

        const revision = await this.repository.createInTransaction(query, {
          userId: input.userId,
          planId: input.planId,
          planKind,
          version: 0,
          reason: token.reason,
          status: 'confirmed',
          snapshot,
          idempotencyKey,
          requestHash,
        });

        // STEP_093 consistency model A: shopping rebuild is part of the same transaction.
        if (token.operationJson && planKind === 'meal') {
          if (!this.shopping) throw new Error('SHOPPING_DEPENDENCY_MISSING');
          await this.shopping.rebuildFromPlanId(
            input.userId,
            activePlanId,
            nextPlanVersion,
            query,
          );
        }

        await this.emit('plan_revision_confirmed', input.userId, revision.id, {
          planKind,
          activeVersion: nextPlanVersion,
          structured: Boolean(token.operationJson),
        });
        if (token.operationJson) {
          await this.emit('substitution_confirmed', input.userId, revision.id, {
            planKind,
            activeVersion: nextPlanVersion,
          });
        }

        return {
          revision,
          activePlanId,
          activeVersion: nextPlanVersion,
          idempotentReplay: false,
        };
      });

      return {
        revision: result.revision,
        activePlanId: result.activePlanId,
        activeVersion: result.activeVersion,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.repository.findByIdempotency(input.userId, idempotencyKey);
        if (raced && raced.requestHash === requestHash) {
          await this.emit('plan_revision_idempotent_replay', input.userId, raced.planId, { planKind });
          return {
            revision: raced,
            activePlanId: String(raced.snapshot.activePlanId ?? raced.planId),
            activeVersion: Number(raced.snapshot.activeVersion ?? raced.version),
            idempotentReplay: true,
          };
        }
        if (raced) throw new Error('IDEMPOTENCY_KEY_REUSED');
        throw new Error('REVISION_VERSION_CONFLICT');
      }
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
        await this.emit('plan_revision_conflict', input.userId, input.planId, { planKind, code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      throw error;
    }
  }

  async cancelPreview(userId: string, planId: string, planKind: PlanKind): Promise<{ cancelled: true }> {
    await this.emit('plan_revision_cancelled', userId, planId, { planKind });
    return { cancelled: true };
  }

  findRevision(userId: string, revisionId: string) {
    return this.repository.findById(userId, revisionId);
  }

  listRevisions(userId: string, planId: string, planKind: PlanKind) {
    return this.repository.listByPlan(userId, planId, planKind);
  }

  findLatestRevision(userId: string, planId: string, planKind: PlanKind) {
    return this.repository.findLatestByPlan(userId, planId, planKind);
  }

  private buildStructuredFromToken(
    reason: string,
    operationJson: string,
    planId: string,
    sourceVersion: number,
  ): {
    currentVersion: number;
    proposedSnapshot: RevisionSnapshot;
    summary: string;
    changedItems: RevisionChangedItem[];
    warnings: string[];
  } {
    let payload: {
      operation: Record<string, unknown>;
      days: StructuredRevisionPreviewInput['days'];
      summary: string;
      changedItems: RevisionChangedItem[];
      warnings: string[];
    };
    try {
      payload = JSON.parse(operationJson) as typeof payload;
    } catch {
      throw new Error('REVISION_TOKEN_INVALID');
    }
    if (!payload?.days || !Array.isArray(payload.days)) throw new Error('REVISION_TOKEN_INVALID');
    return {
      currentVersion: sourceVersion,
      proposedSnapshot: {
        kind: 'meal',
        sourcePlanId: planId,
        sourceVersion,
        reason,
        operation: payload.operation,
        days: payload.days,
      },
      summary: payload.summary ?? 'Substitution',
      changedItems: payload.changedItems ?? [],
      warnings: payload.warnings ?? [],
    };
  }

  private async buildProposal(userId: string, planId: string, planKind: PlanKind, reason: string) {
    if (planKind === 'meal') {
      const source = await this.repository.loadMealPlan(userId, planId);
      if (!source) throw new Error('REVISION_PLAN_FORBIDDEN');
      const proposal = buildMealProposal(source, reason);
      return { ...proposal, currentVersion: source.version, proposedSnapshot: proposal.snapshot };
    }
    const source = await this.repository.loadWorkoutPlan(userId, planId);
    if (!source) throw new Error('REVISION_PLAN_FORBIDDEN');
    const proposal = buildWorkoutProposal(source, reason);
    return { ...proposal, currentVersion: source.version, proposedSnapshot: proposal.snapshot };
  }

  private persistConfirmed(request: RevisionRequest): Promise<PlanRevision> {
    return this.repository.create({
      userId: request.userId,
      planId: request.planId,
      planKind: request.planKind,
      version: 0,
      reason: request.reason,
      status: 'confirmed',
      snapshot: request.snapshot,
    });
  }

  private async emit(action: string, userId: string, entityId: string, metadata: Record<string, unknown>) {
    if (!this.audit) return;
    try {
      await this.audit.appendEvent({
        actorUserId: userId,
        action,
        entityType: 'PlanRevision',
        entityId,
        metadata,
      });
    } catch {
      // analytics must not break revise flow
    }
  }
}
