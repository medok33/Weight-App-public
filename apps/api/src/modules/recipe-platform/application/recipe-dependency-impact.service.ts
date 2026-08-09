import { Inject, Injectable, Optional } from '@nestjs/common';
import { hasAdminAuthority } from '../../auth/domain/account-role.policy';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  buildRevalidationDedupeKey,
  mapImpactPolicy,
  type RevalidationReasonCode,
} from '../domain/recipe-lifecycle.policy';
import { RecipeLifecycleService } from './recipe-lifecycle.service';
import { RecipeProductDependencyService } from './recipe-product-dependency.service';

@Injectable()
export class RecipeDependencyImpactService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RecipeProductDependencyService) private readonly dependencies: RecipeProductDependencyService,
    @Inject(RecipeLifecycleService) private readonly lifecycle: RecipeLifecycleService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
  ) {}

  async onProductEvent(input: {
    productId: string;
    reasonCode: RevalidationReasonCode;
    sourceEntityType?: string;
    sourceEntityId?: string;
    actorUserId?: string | null;
    query?: SqlQuery;
  }) {
    const run = async (query: SqlQuery) => {
      const policy = mapImpactPolicy(input.reasonCode);
      const versionIds = await this.dependencies.findVersionIdsByProduct(input.productId, query);
      const touched: Array<{ recipeVersionId: string; taskId: string; created: boolean }> = [];

      for (const recipeVersionId of versionIds) {
        const result = await this.upsertTask(
          {
            recipeVersionId,
            productId: input.productId,
            reasonCode: input.reasonCode,
            severity: policy.severity,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId,
            actorUserId: input.actorUserId,
          },
          query,
        );
        await this.lifecycle.setValidationStatus({
          recipeVersionId,
          validationStatus: policy.validationStatus,
          actorUserId: input.actorUserId ?? null,
          reasonCode: input.reasonCode,
          query,
        });
        touched.push(result);
      }
      return { versionCount: versionIds.length, tasks: touched, policy };
    };
    if (input.query) return run(input.query);
    return this.db.withTransaction(run);
  }

  async listTasks(filters: {
    status?: string;
    severity?: string;
    reasonCode?: string;
    productId?: string;
    recipeVersionId?: string;
    limit?: number;
  }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filters.status) push(`t.status = ?`, filters.status);
    if (filters.severity) push(`t.severity = ?`, filters.severity);
    if (filters.reasonCode) push(`t."reasonCode" = ?`, filters.reasonCode);
    if (filters.productId) push(`t."productId" = ?`, filters.productId);
    if (filters.recipeVersionId) push(`t."recipeVersionId" = ?`, filters.recipeVersionId);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(filters.limit ?? 200);
    const rows = await this.db.query(
      `SELECT t.*,
              r.id AS "recipeId",
              r.name AS "recipeName",
              v."versionNumber",
              l."lifecycleStatus",
              l."validationStatus",
              COALESCE(p.name, p."canonicalName") AS "productName",
              EXISTS (
                SELECT 1 FROM "MealItem" mi WHERE mi."recipeVersionId" = t."recipeVersionId" LIMIT 1
              ) AS "usedInHistoricalPlan"
       FROM "RecipeRevalidationTask" t
       JOIN "RecipeVersion" v ON v.id = t."recipeVersionId"
       JOIN "Recipe" r ON r.id = v."recipeId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       JOIN "Product" p ON p.id = t."productId"
       ${where}
       ORDER BY t."lastDetectedAt" DESC
       LIMIT $${values.length}`,
      values,
    );
    return rows.rows;
  }

  async getTask(taskId: string) {
    const row = await this.db.query(
      `SELECT t.*,
              r.id AS "recipeId",
              r.name AS "recipeName",
              v."versionNumber",
              l."lifecycleStatus",
              l."validationStatus",
              COALESCE(p.name, p."canonicalName") AS "productName"
       FROM "RecipeRevalidationTask" t
       JOIN "RecipeVersion" v ON v.id = t."recipeVersionId"
       JOIN "Recipe" r ON r.id = v."recipeId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       JOIN "Product" p ON p.id = t."productId"
       WHERE t.id = $1`,
      [taskId],
    );
    return row.rows[0] ?? null;
  }

  async resolveTask(input: {
    taskId: string;
    actorUserId: string;
    actorRole: string;
    resolutionCode: 'CONFIRM_CURRENT_VERSION' | 'CREATE_CORRECTED_VERSION' | 'SUSPEND_VERSION' | 'ARCHIVE_VERSION' | 'DISMISS';
    resolutionNote: string;
  }) {
    const role = String(input.actorRole ?? '').toUpperCase();
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
    if (!String(input.resolutionNote ?? '').trim()) throw new Error('REVALIDATION_REASON_REQUIRED');

    return this.db.withTransaction(async (query) => {
      const task = await query<{
        id: string;
        recipeVersionId: string;
        productId: string;
        reasonCode: string;
        severity: string;
        status: string;
      }>(
        `SELECT id, "recipeVersionId", "productId", "reasonCode", severity, status
         FROM "RecipeRevalidationTask" WHERE id = $1 FOR UPDATE`,
        [input.taskId],
      );
      const row = task.rows[0];
      if (!row) throw new Error('REVALIDATION_TASK_NOT_FOUND');
      if (row.status !== 'OPEN') throw new Error('REVALIDATION_TASK_NOT_OPEN');

      const policy = mapImpactPolicy(row.reasonCode as RevalidationReasonCode);
      if (input.resolutionCode === 'DISMISS' && (row.severity === 'CRITICAL' || row.severity === 'HIGH')) {
        throw new Error('REVALIDATION_DISMISS_FORBIDDEN');
      }
      if (input.resolutionCode === 'CONFIRM_CURRENT_VERSION' && !policy.allowConfirmCurrent) {
        throw new Error('REVALIDATION_CONFIRM_FORBIDDEN');
      }

      const status = input.resolutionCode === 'DISMISS' ? 'DISMISSED' : 'RESOLVED';
      await query(
        `UPDATE "RecipeRevalidationTask"
         SET status = $2,
             "resolvedAt" = now(),
             "resolvedBy" = $3,
             "resolutionCode" = $4,
             "resolutionNote" = $5
         WHERE id = $1`,
        [input.taskId, status, input.actorUserId, input.resolutionCode, input.resolutionNote],
      );

      if (input.resolutionCode === 'CONFIRM_CURRENT_VERSION') {
        await this.lifecycle.setValidationStatus({
          recipeVersionId: row.recipeVersionId,
          validationStatus: 'VALID',
          actorUserId: input.actorUserId,
          reasonCode: 'CONFIRM_CURRENT_VERSION',
          query,
        });
      }

      // SUSPEND/ARCHIVE/CREATE_CORRECTED are executed via dedicated lifecycle/version endpoints
      // after task resolution to avoid nested transactions.

      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.revalidation.resolved',
        entityType: 'RecipeRevalidationTask',
        entityId: input.taskId,
        metadata: {
          resolutionCode: input.resolutionCode,
          reasonCode: row.reasonCode,
          recipeVersionId: row.recipeVersionId,
        },
      });

      return this.getTask(input.taskId);
    });
  }

  private async upsertTask(
    input: {
      recipeVersionId: string;
      productId: string;
      reasonCode: RevalidationReasonCode;
      severity: string;
      sourceEntityType?: string;
      sourceEntityId?: string;
      actorUserId?: string | null;
    },
    query?: SqlQuery,
  ) {
    const run = query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    const dedupeKey = buildRevalidationDedupeKey(input);
    const existing = await run<{ id: string; occurrenceCount: number }>(
      `SELECT id, "occurrenceCount" FROM "RecipeRevalidationTask"
       WHERE "dedupeKey" = $1 AND status = 'OPEN'
       LIMIT 1
       FOR UPDATE`,
      [dedupeKey],
    );
    if (existing.rows[0]) {
      const updated = await run<{ id: string }>(
        `UPDATE "RecipeRevalidationTask"
         SET "occurrenceCount" = "occurrenceCount" + 1,
             "lastDetectedAt" = now(),
             "sourceEntityType" = COALESCE($2, "sourceEntityType"),
             "sourceEntityId" = COALESCE($3, "sourceEntityId")
         WHERE id = $1
         RETURNING id`,
        [existing.rows[0].id, input.sourceEntityType ?? null, input.sourceEntityId ?? null],
      );
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId ?? null,
        action: 'recipe.revalidation.task_touched',
        entityType: 'RecipeRevalidationTask',
        entityId: updated.rows[0]!.id,
        metadata: { dedupeKey, reasonCode: input.reasonCode },
      });
      return { recipeVersionId: input.recipeVersionId, taskId: updated.rows[0]!.id, created: false };
    }

    const inserted = await run<{ id: string }>(
      `INSERT INTO "RecipeRevalidationTask" (
         "recipeVersionId", "productId", "reasonCode", severity, status,
         "sourceEntityType", "sourceEntityId", "dedupeKey"
       ) VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7)
       ON CONFLICT ("dedupeKey") DO UPDATE
         SET "occurrenceCount" = "RecipeRevalidationTask"."occurrenceCount" + 1,
             "lastDetectedAt" = now(),
             status = CASE
               WHEN "RecipeRevalidationTask".status = 'OPEN' THEN 'OPEN'
               ELSE "RecipeRevalidationTask".status
             END
       RETURNING id`,
      [
        input.recipeVersionId,
        input.productId,
        input.reasonCode,
        input.severity,
        input.sourceEntityType ?? null,
        input.sourceEntityId ?? null,
        dedupeKey,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId ?? null,
      action: 'recipe.revalidation.task_created',
      entityType: 'RecipeRevalidationTask',
      entityId: inserted.rows[0]!.id,
      metadata: { dedupeKey, reasonCode: input.reasonCode, severity: input.severity },
    });
    return { recipeVersionId: input.recipeVersionId, taskId: inserted.rows[0]!.id, created: true };
  }
}
