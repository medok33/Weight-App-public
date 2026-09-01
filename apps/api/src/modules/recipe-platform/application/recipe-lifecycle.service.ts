import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  assertLifecycleTransition,
  canPublishLifecycle,
  isUsableForNewPlans,
  SUSPEND_FALLBACK_POLICY,
  type RecipeLifecycleStatus,
  type RecipeValidationStatus,
} from '../domain/recipe-lifecycle.policy';
import { RecipeCoverageAnalyzer } from './recipe-coverage-analyzer.service';

@Injectable()
export class RecipeLifecycleService {
  readonly suspendFallbackPolicy = SUSPEND_FALLBACK_POLICY;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(RecipeCoverageAnalyzer) private readonly coverageAnalyzer?: RecipeCoverageAnalyzer,
  ) {}

  private async markCoverageDirty(reason: string, recipeVersionId: string) {
    await this.coverageAnalyzer?.markDirty({
      reasons: [reason],
      recipeVersionIds: [recipeVersionId],
    });
  }

  async getLifecycle(recipeVersionId: string) {
    const row = await this.db.query(
      `SELECT l.*, v."recipeId", v."versionNumber", v.checksum, r."currentVersionId"
       FROM "RecipeVersionLifecycle" l
       JOIN "RecipeVersion" v ON v.id = l."recipeVersionId"
       JOIN "Recipe" r ON r.id = v."recipeId"
       WHERE l."recipeVersionId" = $1`,
      [recipeVersionId],
    );
    return row.rows[0] ?? null;
  }

  async listEvents(recipeVersionId: string) {
    const rows = await this.db.query(
      `SELECT * FROM "RecipeVersionLifecycleEvent"
       WHERE "recipeVersionId" = $1
       ORDER BY "createdAt" ASC`,
      [recipeVersionId],
    );
    return rows.rows;
  }

  async ensureLifecycleRow(
    recipeVersionId: string,
    status: RecipeLifecycleStatus,
    validation: RecipeValidationStatus,
    actorId: string | null,
    query: SqlQuery,
    reasonCode = 'LIFECYCLE_INIT',
  ) {
    await query(
      `INSERT INTO "RecipeVersionLifecycle" (
         "recipeVersionId", "lifecycleStatus", "validationStatus", "revision",
         "changedAt", "changedBy", "reasonCode"
       ) VALUES ($1,$2,$3,1,now(),$4,$5)
       ON CONFLICT ("recipeVersionId") DO NOTHING`,
      [recipeVersionId, status, validation, actorId, reasonCode],
    );
  }

  /**
   * Usable for new Meal Plans: PUBLISHED + VALID + matches Recipe.currentVersionId.
   * No fallback to SUPERSEDED/SUSPENDED/latest versionNumber.
   */
  async resolveUsableVersionId(recipeId: string, query?: SqlQuery): Promise<string | null> {
    const q = query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    const row = await q<{
      currentVersionId: string | null;
      lifecycleStatus: string | null;
      validationStatus: string | null;
    }>(
      `SELECT r."currentVersionId", l."lifecycleStatus", l."validationStatus"
       FROM "Recipe" r
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = r."currentVersionId"
       WHERE r.id = $1
       LIMIT 1`,
      [recipeId],
    );
    const current = row.rows[0];
    if (
      isUsableForNewPlans({
        lifecycleStatus: current?.lifecycleStatus,
        validationStatus: current?.validationStatus,
        currentVersionId: current?.currentVersionId,
        recipeVersionId: current?.currentVersionId,
      })
    ) {
      return current!.currentVersionId;
    }
    return null;
  }

  async transition(input: {
    recipeId: string;
    versionId: string;
    toStatus: RecipeLifecycleStatus;
    actorUserId: string;
    actorRole: string;
    reasonCode?: string;
    reasonText?: string;
    requestId?: string;
    validationTo?: RecipeValidationStatus;
  }) {
    this.assertStaff(input.actorRole);
    if (['SUSPENDED', 'ARCHIVED', 'REJECTED'].includes(input.toStatus) && !String(input.reasonCode ?? '').trim()) {
      throw new Error('RECIPE_LIFECYCLE_REASON_REQUIRED');
    }

    return this.db.withTransaction(async (query) => {
      await this.lockRecipe(input.recipeId, query);
      const life = await this.lockLifecycle(input.versionId, input.recipeId, query);
      assertLifecycleTransition(life.lifecycleStatus as RecipeLifecycleStatus, input.toStatus);

      if (input.toStatus === 'PUBLISHED') {
        return this.publishInTx({
          recipeId: input.recipeId,
          versionId: input.versionId,
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode ?? 'PUBLISH',
          reasonText: input.reasonText,
          requestId: input.requestId,
          query,
          from: life,
        });
      }

      if (input.toStatus === 'SUSPENDED' && life.lifecycleStatus === 'PUBLISHED') {
        return this.suspendCurrentInTx({
          recipeId: input.recipeId,
          versionId: input.versionId,
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode!,
          reasonText: input.reasonText,
          requestId: input.requestId,
          query,
          from: life,
        });
      }

      const validationTo = input.validationTo ?? (life.validationStatus as RecipeValidationStatus);
      await this.writeTransition({
        query,
        versionId: input.versionId,
        from: life,
        toStatus: input.toStatus,
        validationTo,
        actorId: input.actorUserId,
        reasonCode: input.reasonCode ?? null,
        reasonText: input.reasonText ?? null,
        requestId: input.requestId ?? null,
      });

      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: `recipe.version.lifecycle.${input.toStatus.toLowerCase()}`,
        entityType: 'RecipeVersion',
        entityId: input.versionId,
        metadata: {
          recipeId: input.recipeId,
          from: life.lifecycleStatus,
          to: input.toStatus,
          reasonCode: input.reasonCode ?? null,
        },
      });

      const result = await this.getLifecycle(input.versionId);
      if (input.toStatus === 'SUSPENDED') await this.markCoverageDirty('RECIPE_VERSION_SUSPENDED', input.versionId);
      if (input.toStatus === 'ARCHIVED') await this.markCoverageDirty('RECIPE_VERSION_ARCHIVED', input.versionId);
      if (input.toStatus === 'SUPERSEDED') await this.markCoverageDirty('RECIPE_VERSION_SUPERSEDED', input.versionId);
      return result;
    });
  }

  async submitForReview(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonText?: string;
  }) {
    // Snapshot already exists; ensure IN_REVIEW.
    this.assertStaff(input.actorRole);
    return this.db.withTransaction(async (query) => {
      await this.lockRecipe(input.recipeId, query);
      await this.ensureLifecycleRow(input.versionId, 'IN_REVIEW', 'VALID', input.actorUserId, query, 'SUBMIT');
      const life = await this.lockLifecycle(input.versionId, input.recipeId, query);
      if (life.lifecycleStatus === 'IN_REVIEW') return life;
      throw new Error('RECIPE_LIFECYCLE_TRANSITION_INVALID');
    });
  }

  async approve(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonText?: string;
  }) {
    return this.transition({
      ...input,
      toStatus: 'APPROVED',
      reasonCode: 'APPROVE',
      reasonText: input.reasonText,
    });
  }

  async reject(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonCode: string;
    reasonText?: string;
  }) {
    return this.transition({
      ...input,
      toStatus: 'REJECTED',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });
  }

  async publish(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonText?: string;
    requestId?: string;
  }) {
    return this.transition({
      ...input,
      toStatus: 'PUBLISHED',
      reasonCode: 'PUBLISH',
      reasonText: input.reasonText,
      requestId: input.requestId,
    });
  }

  async suspend(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonCode: string;
    reasonText?: string;
  }) {
    return this.transition({
      ...input,
      toStatus: 'SUSPENDED',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });
  }

  async archive(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonCode: string;
    reasonText?: string;
  }) {
    return this.transition({
      ...input,
      toStatus: 'ARCHIVED',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });
  }

  async restore(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    reasonCode: string;
    reasonText?: string;
  }) {
    return this.transition({
      ...input,
      toStatus: 'PUBLISHED',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });
  }

  async setValidationStatus(input: {
    recipeVersionId: string;
    validationStatus: RecipeValidationStatus;
    actorUserId?: string | null;
    reasonCode: string;
    query?: SqlQuery;
  }) {
    const run = input.query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    const existing = await run<{
      lifecycleStatus: string;
      validationStatus: string;
      revision: number;
    }>(
      `SELECT "lifecycleStatus", "validationStatus", revision
       FROM "RecipeVersionLifecycle" WHERE "recipeVersionId" = $1 FOR UPDATE`,
      [input.recipeVersionId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('RECIPE_LIFECYCLE_NOT_FOUND');
    if (row.validationStatus === input.validationStatus) return row;

    await run(
      `UPDATE "RecipeVersionLifecycle"
       SET "validationStatus" = $2,
           revision = revision + 1,
           "changedAt" = now(),
           "changedBy" = $3,
           "reasonCode" = $4
       WHERE "recipeVersionId" = $1`,
      [input.recipeVersionId, input.validationStatus, input.actorUserId ?? null, input.reasonCode],
    );
    await run(
      `INSERT INTO "RecipeVersionLifecycleEvent" (
         "recipeVersionId", "fromStatus", "toStatus", "validationFrom", "validationTo",
         "actorId", "reasonCode"
       ) VALUES ($1,$2,$2,$3,$4,$5,$6)`,
      [
        input.recipeVersionId,
        row.lifecycleStatus,
        row.validationStatus,
        input.validationStatus,
        input.actorUserId ?? null,
        input.reasonCode,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId ?? null,
      action: 'recipe.version.validation_changed',
      entityType: 'RecipeVersion',
      entityId: input.recipeVersionId,
      metadata: {
        from: row.validationStatus,
        to: input.validationStatus,
        reasonCode: input.reasonCode,
      },
    });
    const dirtyReason =
      input.validationStatus === 'VALID'
        ? 'VALIDATION_VALID'
        : input.validationStatus === 'NEEDS_REVALIDATION'
          ? 'VALIDATION_NEEDS_REVALIDATION'
          : input.validationStatus === 'BLOCKED'
            ? 'VALIDATION_BLOCKED'
            : null;
    if (dirtyReason) await this.markCoverageDirty(dirtyReason, input.recipeVersionId);
    return { ...row, validationStatus: input.validationStatus };
  }

  private async publishInTx(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    reasonCode: string;
    reasonText?: string;
    requestId?: string;
    query: SqlQuery;
    from: {
      lifecycleStatus: string;
      validationStatus: string;
      revision: number;
    };
  }) {
    canPublishLifecycle({
      lifecycleStatus: input.from.lifecycleStatus as RecipeLifecycleStatus,
      validationStatus: input.from.validationStatus as RecipeValidationStatus,
    });
    if (
      input.from.lifecycleStatus === 'APPROVED' &&
      input.from.validationStatus !== 'VALID'
    ) {
      throw new Error('RECIPE_LIFECYCLE_PUBLISH_NOT_VALID');
    }

    const recipe = await input.query<{ currentVersionId: string | null }>(
      `SELECT "currentVersionId" FROM "Recipe" WHERE id = $1 FOR UPDATE`,
      [input.recipeId],
    );
    const previousId = recipe.rows[0]?.currentVersionId ?? null;

    if (previousId && previousId !== input.versionId) {
      const prevLife = await input.query<{ lifecycleStatus: string; validationStatus: string; revision: number }>(
        `SELECT "lifecycleStatus", "validationStatus", revision
         FROM "RecipeVersionLifecycle" WHERE "recipeVersionId" = $1 FOR UPDATE`,
        [previousId],
      );
      if (prevLife.rows[0]?.lifecycleStatus === 'PUBLISHED') {
        await this.writeTransition({
          query: input.query,
          versionId: previousId,
          from: prevLife.rows[0]!,
          toStatus: 'SUPERSEDED',
          validationTo: prevLife.rows[0]!.validationStatus as RecipeValidationStatus,
          actorId: input.actorUserId,
          reasonCode: 'SUPERSEDED_BY_PUBLISH',
          reasonText: `Superseded by ${input.versionId}`,
          requestId: input.requestId ?? null,
        });
        await this.audit?.appendEvent({
          actorUserId: input.actorUserId,
          action: 'recipe.version.lifecycle.superseded',
          entityType: 'RecipeVersion',
          entityId: previousId,
          metadata: { recipeId: input.recipeId, replacedBy: input.versionId },
        });
      }
    }

    // Safety: never leave a second PUBLISHED lifecycle for the same Recipe.
    const stray = await input.query<{ recipeVersionId: string; validationStatus: string; revision: number }>(
      `SELECT l."recipeVersionId", l."validationStatus", l.revision
       FROM "RecipeVersionLifecycle" l
       JOIN "RecipeVersion" v ON v.id = l."recipeVersionId"
       WHERE v."recipeId" = $1
         AND l."recipeVersionId" <> $2
         AND l."lifecycleStatus" = 'PUBLISHED'
       FOR UPDATE`,
      [input.recipeId, input.versionId],
    );
    for (const row of stray.rows) {
      await this.writeTransition({
        query: input.query,
        versionId: row.recipeVersionId,
        from: {
          lifecycleStatus: 'PUBLISHED',
          validationStatus: row.validationStatus,
          revision: row.revision,
        },
        toStatus: 'SUPERSEDED',
        validationTo: row.validationStatus as RecipeValidationStatus,
        actorId: input.actorUserId,
        reasonCode: 'SUPERSEDED_BY_PUBLISH',
        reasonText: `Superseded by ${input.versionId}`,
        requestId: input.requestId ?? null,
      });
    }

    await this.writeTransition({
      query: input.query,
      versionId: input.versionId,
      from: input.from,
      toStatus: 'PUBLISHED',
      validationTo: 'VALID',
      actorId: input.actorUserId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText ?? null,
      requestId: input.requestId ?? null,
    });

    await input.query(
      `UPDATE "Recipe"
       SET "currentVersionId" = $2,
           "contentRevision" = "contentRevision" + 1
       WHERE id = $1`,
      [input.recipeId, input.versionId],
    );
    // Fill publishedAt only when missing — full row updates trip RECIPE_VERSION_IMMUTABLE.
    // Row status flips to PUBLISHED in the same statement so a staged DRAFT can
    // never end up with lifecycle=PUBLISHED but status=DRAFT (07C2A-R2 defect 2).
    // The guard keeps already-published rows untouched (restore path replays).
    await input.query(
      `UPDATE "RecipeVersion"
       SET "publishedAt" = now(),
           status = 'PUBLISHED',
           "approvedBy" = COALESCE("approvedBy", $2),
           "approvedAt" = COALESCE("approvedAt", now())
       WHERE id = $1
         AND "publishedAt" IS NULL
         AND status <> 'PUBLISHED'`,
      [input.versionId, input.actorUserId],
    );

    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.version.lifecycle.published',
      entityType: 'RecipeVersion',
      entityId: input.versionId,
      metadata: {
        recipeId: input.recipeId,
        previousCurrentVersionId: previousId,
        currentVersionId: input.versionId,
      },
    });
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.current_version_changed',
      entityType: 'Recipe',
      entityId: input.recipeId,
      metadata: { from: previousId, to: input.versionId },
    });

    await this.markCoverageDirty('RECIPE_VERSION_PUBLISHED', input.versionId);
    if (previousId) await this.markCoverageDirty('RECIPE_VERSION_SUPERSEDED', previousId);

    return this.getLifecycle(input.versionId);
  }

  private async suspendCurrentInTx(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    reasonCode: string;
    reasonText?: string;
    requestId?: string;
    query: SqlQuery;
    from: { lifecycleStatus: string; validationStatus: string; revision: number };
  }) {
    await this.writeTransition({
      query: input.query,
      versionId: input.versionId,
      from: input.from,
      toStatus: 'SUSPENDED',
      validationTo: input.from.validationStatus as RecipeValidationStatus,
      actorId: input.actorUserId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText ?? null,
      requestId: input.requestId ?? null,
    });

    // Policy A: last SUPERSEDED + VALID; else NULL.
    const fallback = await input.query<{ id: string }>(
      `SELECT v.id
       FROM "RecipeVersion" v
       JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       WHERE v."recipeId" = $1
         AND v.id <> $2
         AND l."lifecycleStatus" = 'SUPERSEDED'
         AND l."validationStatus" = 'VALID'
       ORDER BY v."versionNumber" DESC
       LIMIT 1`,
      [input.recipeId, input.versionId],
    );
    const nextCurrent = fallback.rows[0]?.id ?? null;

    if (nextCurrent) {
      const life = await input.query<{ lifecycleStatus: string; validationStatus: string; revision: number }>(
        `SELECT "lifecycleStatus", "validationStatus", revision
         FROM "RecipeVersionLifecycle" WHERE "recipeVersionId" = $1 FOR UPDATE`,
        [nextCurrent],
      );
      await this.writeTransition({
        query: input.query,
        versionId: nextCurrent,
        from: life.rows[0]!,
        toStatus: 'PUBLISHED',
        validationTo: 'VALID',
        actorId: input.actorUserId,
        reasonCode: 'SUSPEND_FALLBACK_RESTORE',
        reasonText: `Fallback after suspend ${input.versionId}`,
        requestId: input.requestId ?? null,
      });
    }

    await input.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [
      input.recipeId,
      nextCurrent,
    ]);

    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.version.lifecycle.suspended',
      entityType: 'RecipeVersion',
      entityId: input.versionId,
      metadata: {
        recipeId: input.recipeId,
        fallbackCurrentVersionId: nextCurrent,
        policy: SUSPEND_FALLBACK_POLICY,
      },
    });

    await this.markCoverageDirty('RECIPE_VERSION_SUSPENDED', input.versionId);
    if (nextCurrent) await this.markCoverageDirty('RECIPE_VERSION_PUBLISHED', nextCurrent);

    return this.getLifecycle(input.versionId);
  }

  private async writeTransition(input: {
    query: SqlQuery;
    versionId: string;
    from: { lifecycleStatus: string; validationStatus: string; revision: number };
    toStatus: RecipeLifecycleStatus;
    validationTo: RecipeValidationStatus;
    actorId: string;
    reasonCode: string | null;
    reasonText: string | null;
    requestId: string | null;
  }) {
    await input.query(
      `UPDATE "RecipeVersionLifecycle"
       SET "lifecycleStatus" = $2,
           "validationStatus" = $3,
           revision = revision + 1,
           "changedAt" = now(),
           "changedBy" = $4,
           "reasonCode" = $5,
           "reasonText" = $6
       WHERE "recipeVersionId" = $1`,
      [
        input.versionId,
        input.toStatus,
        input.validationTo,
        input.actorId,
        input.reasonCode,
        input.reasonText,
      ],
    );
    await input.query(
      `INSERT INTO "RecipeVersionLifecycleEvent" (
         "recipeVersionId", "fromStatus", "toStatus", "validationFrom", "validationTo",
         "actorId", "reasonCode", "reasonText", "requestId"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.versionId,
        input.from.lifecycleStatus,
        input.toStatus,
        input.from.validationStatus,
        input.validationTo,
        input.actorId,
        input.reasonCode,
        input.reasonText,
        input.requestId,
      ],
    );
  }

  private async lockRecipe(recipeId: string, query: SqlQuery) {
    await query('SELECT pg_advisory_xact_lock($1)', [
      Number.parseInt(createHash('sha256').update(`lifecycle:${recipeId}`).digest('hex').slice(0, 8), 16),
    ]);
    const locked = await query(`SELECT id FROM "Recipe" WHERE id = $1 FOR UPDATE`, [recipeId]);
    if (!locked.rows[0]) throw new Error('RECIPE_NOT_FOUND');
  }

  private async lockLifecycle(versionId: string, recipeId: string, query: SqlQuery) {
    const version = await query<{ id: string }>(
      `SELECT id FROM "RecipeVersion" WHERE id = $1 AND "recipeId" = $2 FOR UPDATE`,
      [versionId, recipeId],
    );
    if (!version.rows[0]) throw new Error('RECIPE_VERSION_NOT_FOUND');
    await this.ensureLifecycleRow(versionId, 'IN_REVIEW', 'VALID', null, query);
    const life = await query<{
      lifecycleStatus: string;
      validationStatus: string;
      revision: number;
    }>(
      `SELECT "lifecycleStatus", "validationStatus", revision
       FROM "RecipeVersionLifecycle" WHERE "recipeVersionId" = $1 FOR UPDATE`,
      [versionId],
    );
    if (!life.rows[0]) throw new Error('RECIPE_LIFECYCLE_NOT_FOUND');
    return life.rows[0];
  }

  private assertStaff(role: string) {
    const r = String(role ?? '').toUpperCase();
    if (r !== 'OWNER' && r !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }
}
