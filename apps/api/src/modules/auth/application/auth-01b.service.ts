import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type { RequestUser } from '../domain/request-user.types';
import {
  ownershipRegistryEntries,
} from '../domain/ownership-retention-registry';
import { AuthRepository } from '../infrastructure/auth.repository';

const RECENT_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

export type PublicSessionView = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  deviceLabel: string | null;
  current: boolean;
};

@Injectable()
export class Auth01bService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
  ) {}

  async listSessions(user: RequestUser, rawToken?: string): Promise<{ sessions: PublicSessionView[] }> {
    const currentHash = rawToken ? this.repository.hashToken(rawToken) : null;
    const result = await this.db.query<{
      id: string;
      createdAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
      lastSeenAt: Date | null;
      deviceLabel: string | null;
      current: boolean;
    }>(
      `SELECT id, "createdAt", "expiresAt", "revokedAt", "lastSeenAt", "deviceLabel",
              ("tokenHash" = $2) AS current
       FROM "Session"
       WHERE "userId" = $1
       ORDER BY "revokedAt" NULLS FIRST, "lastSeenAt" DESC NULLS LAST, "createdAt" DESC`,
      [user.id, currentHash],
    );
    return {
      sessions: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        deviceLabel: row.deviceLabel,
        current: row.current,
      })),
    };
  }

  async revokeSession(user: RequestUser, sessionId: string): Promise<{ ok: true }> {
    await this.db.query(
      `UPDATE "Session"
       SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP), "recentOwnerReauthAt" = NULL
       WHERE id = $1 AND "userId" = $2`,
      [sessionId, user.id],
    );
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.session.revoked',
      entityType: 'Session',
      entityId: sessionId,
      metadata: {},
    });
    return { ok: true };
  }

  async revokeOtherSessions(user: RequestUser, rawToken?: string): Promise<{ ok: true }> {
    await this.repository.revokeOtherSessions(user.id, rawToken);
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.session.revoked_others',
      entityType: 'Session',
      metadata: {},
    });
    return { ok: true };
  }

  async revokeAllSessions(user: RequestUser): Promise<{ ok: true }> {
    await this.db.query(
      `UPDATE "Session"
       SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP), "recentOwnerReauthAt" = NULL
       WHERE "userId" = $1`,
      [user.id],
    );
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.session.revoked_all',
      entityType: 'Session',
      metadata: {},
    });
    return { ok: true };
  }

  async exportAccount(user: RequestUser): Promise<{ generatedAt: string; registryVersion: 'AUTH-01B'; data: Record<string, unknown> }> {
    this.assertRecentReauth(user);
    const [
      account,
      sessions,
      payments,
      entitlements,
      familyMemberships,
      registry,
    ] = await Promise.all([
      this.db.query(`SELECT id, email, username, "accountRole", status, "createdAt", "updatedAt" FROM "User" WHERE id=$1`, [user.id]),
      this.db.query(`SELECT id, "createdAt", "expiresAt", "revokedAt", "lastSeenAt", "deviceLabel" FROM "Session" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, [user.id]),
      this.db.query(`SELECT id, provider, status, "amountMinor", currency, "createdAt", "updatedAt" FROM "Payment" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, [user.id]),
      this.db.query(`SELECT id, key, status, "startsAt", "endsAt", "createdAt", "updatedAt" FROM "Entitlement" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, [user.id]),
      this.db.query(`SELECT id, "familyId", role, status, "joinedAt", "leftAt" FROM "FamilyMember" WHERE "userId"=$1 ORDER BY "joinedAt" DESC`, [user.id]),
      Promise.resolve(ownershipRegistryEntries().filter(([, entry]) => entry.exportable).map(([model, entry]) => ({ model, retention: entry.retention, deletion: entry.deletion }))),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      registryVersion: 'AUTH-01B',
      data: {
        account: account.rows[0] ?? null,
        sessions: sessions.rows,
        payments: payments.rows,
        entitlements: entitlements.rows,
        familyMemberships: familyMemberships.rows,
        exportInventory: registry,
      },
    };
  }

  async deleteAccount(user: RequestUser, confirmation: unknown): Promise<{ ok: true; deletionRequestId: string; retained: Record<string, unknown> }> {
    this.assertRecentReauth(user);
    if (confirmation !== 'DELETE MY ACCOUNT') throw new Error('DELETE_CONFIRMATION_REQUIRED');
    const result = await this.db.withTransaction(async (query) => {
      const account = await query<{ id: string; email: string | null; username: string | null; accountRole: string; status: string }>(
        `SELECT id, email, username, "accountRole", status FROM "User" WHERE id=$1 FOR UPDATE`,
        [user.id],
      );
      const target = account.rows[0];
      if (!target || target.status !== 'ACTIVE') throw new Error('AUTH_REQUIRED');
      if (String(target.accountRole).toUpperCase() === 'OWNER') {
        const owners = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM "User"
           WHERE id <> $1 AND "accountRole"='OWNER' AND status='ACTIVE'`,
          [user.id],
        );
        if (Number(owners.rows[0]?.count ?? 0) < 1) throw new Error('LAST_OWNER_DELETION_BLOCKED');
      }

      const deletion = await query<{ id: string }>(
        `INSERT INTO "AccountDeletionRequest" ("userId", status, "retentionSummary")
         VALUES ($1, 'PROCESSING', $2::jsonb)
         RETURNING id`,
        [user.id, JSON.stringify({ registryVersion: 'AUTH-01B' })],
      );
      const deletionRequestId = deletion.rows[0]?.id;
      if (!deletionRequestId) throw new Error('ACCOUNT_DELETION_FAILED');

      await this.applyFamilyDeletionRules(query, user.id);
      await this.anonymizeFinancialHistory(query, user.id);
      await this.detachGlobalActorReferences(query, user.id);
      await this.revokeAndAnonymizeInvites(query, user.id, target.email);
      await this.purgeUserOwnedRows(query, user.id);

      await query(
        `UPDATE "User"
         SET email=NULL,
             username=NULL,
             status='DELETED',
             "deletionRequestedAt"=COALESCE("deletionRequestedAt", CURRENT_TIMESTAMP),
             "deletedAt"=CURRENT_TIMESTAMP,
             "updatedAt"=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [user.id],
      );
      await query(
        `UPDATE "AccountDeletionRequest"
         SET status='COMPLETED', "completedAt"=CURRENT_TIMESTAMP,
             "retentionSummary"=$2::jsonb
         WHERE id=$1`,
        [
          deletionRequestId,
          JSON.stringify({
            registryVersion: 'AUTH-01B',
            paymentRetentionDuration: 'FUTURE_POLICY_REQUIRED',
            retainedClasses: ['USER_PERSONAL_ANONYMIZE', 'SECURITY_AUDIT_MINIMAL', 'GLOBAL_NON_USER_DATA'],
          }),
        ],
      );
      await query(
        `INSERT INTO "AuditEvent" ("actorUserId", action, "entityType", "entityId", metadata)
         VALUES (NULL, 'auth.account.deleted', 'User', $1, $2::jsonb)`,
        [user.id, JSON.stringify({ deletionRequestId })],
      );
      return { deletionRequestId };
    });
    return {
      ok: true,
      deletionRequestId: result.deletionRequestId,
      retained: {
        financialRetentionDuration: 'FUTURE_POLICY_REQUIRED',
        registryVersion: 'AUTH-01B',
      },
    };
  }

  private assertRecentReauth(user: RequestUser): void {
    const reauthAt = user.recentOwnerReauthAt;
    if (!reauthAt || Date.now() - new Date(reauthAt).getTime() > RECENT_REAUTH_MAX_AGE_MS) {
      throw new Error('RECENT_REAUTH_REQUIRED');
    }
  }

  private async applyFamilyDeletionRules(query: SqlQuery, userId: string): Promise<void> {
    const memberships = await query<{ familyId: string }>(
      `SELECT "familyId" FROM "FamilyMember" WHERE "userId"=$1 AND status='ACTIVE' FOR UPDATE`,
      [userId],
    );
    for (const row of memberships.rows) {
      const others = await query<{ userId: string }>(
        `SELECT "userId" FROM "FamilyMember"
         WHERE "familyId"=$1 AND "userId" <> $2 AND status='ACTIVE'
         ORDER BY "joinedAt" ASC
         LIMIT 1`,
        [row.familyId, userId],
      );
      const survivorId = others.rows[0]?.userId;
      if (!survivorId) {
        await query(`DELETE FROM "Family" WHERE id=$1`, [row.familyId]);
        continue;
      }
      await query(`UPDATE "Family" SET "ownerUserId"=$2 WHERE id=$1 AND "ownerUserId"=$3`, [row.familyId, survivorId, userId]);
      await query(`UPDATE "FamilyInvitation" SET "invitedByUserId"=NULL WHERE "familyId"=$1 AND "invitedByUserId"=$2`, [row.familyId, userId]);
      await query(`UPDATE "FamilyInvitation" SET "acceptedByUserId"=NULL WHERE "familyId"=$1 AND "acceptedByUserId"=$2`, [row.familyId, userId]);
      await query(`UPDATE "SharedDish" SET "createdByUserId"=NULL WHERE "familyId"=$1 AND "createdByUserId"=$2`, [row.familyId, userId]);
      await query(`UPDATE "FamilyShoppingList" SET "regeneratedByUserId"=NULL WHERE "familyId"=$1 AND "regeneratedByUserId"=$2`, [row.familyId, userId]);
      await query(
        `DELETE FROM "SharedDishPortion" p
         USING "SharedDish" d
         WHERE p."sharedDishId"=d.id AND d."familyId"=$1 AND p."userId"=$2`,
        [row.familyId, userId],
      );
      await query(`DELETE FROM "FamilyMember" WHERE "familyId"=$1 AND "userId"=$2`, [row.familyId, userId]);
    }
  }

  private async anonymizeFinancialHistory(query: SqlQuery, userId: string): Promise<void> {
    await query(
      `UPDATE "Refund" r
       SET "requestedByUserId"=NULL,
           "decidedByUserId"=CASE WHEN "decidedByUserId"=$1 THEN NULL ELSE "decidedByUserId" END,
           "decisionNote"=NULL,
           metadata=jsonb_build_object('auth01b','anonymized_financial_retention')
       FROM "Payment" p
       WHERE r."paymentId"=p.id AND p."userId"=$1`,
      [userId],
    );
    await query(
      `UPDATE "PaymentEvent" pe
       SET payload=jsonb_build_object('auth01b','anonymized_financial_retention')
       FROM "Payment" p
       WHERE pe."paymentId"=p.id AND p."userId"=$1`,
      [userId],
    );
    await query(
      `UPDATE "Entitlement"
       SET status='revoked',
           "endsAt"=COALESCE("endsAt", CURRENT_TIMESTAMP),
           "userId"=NULL,
           metadata=jsonb_build_object('auth01b','revoked_on_account_deletion')
       WHERE "userId"=$1`,
      [userId],
    );
    await query(
      `UPDATE "Payment"
       SET "userId"=NULL,
           metadata=jsonb_build_object('auth01b','anonymized_financial_retention')
       WHERE "userId"=$1`,
      [userId],
    );
  }

  private async detachGlobalActorReferences(query: SqlQuery, userId: string): Promise<void> {
    await query(`UPDATE "AIControl" SET "updatedBy"=NULL WHERE "updatedBy"=$1`, [userId]);
    await query(`UPDATE "FeatureFlag" SET "updatedBy"=NULL WHERE "updatedBy"=$1`, [userId]);
    await query(`UPDATE "OwnerAuditEvent" SET "userId"=NULL WHERE "userId"=$1`, [userId]);
    await query(`UPDATE "AuditEvent" SET "actorUserId"=NULL WHERE "actorUserId"=$1`, [userId]);
  }

  private async revokeAndAnonymizeInvites(query: SqlQuery, userId: string, email: string | null): Promise<void> {
    await query(`UPDATE "BetaInvite" SET "createdByUserId"=NULL WHERE "createdByUserId"=$1`, [userId]);
    if (!email) return;
    const normalizedEmail = email.trim().toLowerCase();
    const anonymizedPrefix = deletedIdentifier('invite-target', userId);
    await query(
      `UPDATE "BetaInvite"
       SET "revokedAt"=COALESCE("revokedAt", CURRENT_TIMESTAMP),
           "emailNormalized"=$2 || ':' || id::text
       WHERE lower("emailNormalized")=$1`,
      [normalizedEmail, anonymizedPrefix],
    );
  }

  private async purgeUserOwnedRows(query: SqlQuery, userId: string): Promise<void> {
    const tables = [
      'PasswordRecoveryToken',
      'OwnerMfaReplayState',
      'MfaPreAuthChallenge',
      'OwnerMfaRecoveryCode',
      'OwnerMfaCredential',
      'OwnerMfaEnrollmentDraft',
      'Session',
      'AuthIdentity',
      'ShareLink',
      'ExportJob',
      'UserSubscription',
      'UserProfile',
      'WorkoutProfile',
      'WorkoutPlanDayOverride',
      'WorkoutAdaptationCommand',
      'WorkoutAdaptation',
      'WorkoutSession',
      'WorkoutPlan',
      'PlanRevision',
      'Plan',
      'MealCompletion',
      'ProgressEntry',
      'ShoppingList',
      'Pantry',
      'NotificationPreference',
      'Notification',
      'EngagementState',
      'IntegrationConnection',
      'HealthPlatformConsent',
      'ActivityProviderConnection',
      'ActivitySyncClient',
      'ActivityDailySnapshot',
      'ActivitySyncOperation',
      'ActivitySyncRateBucket',
      'AIMessageFeedback',
      'AIUsageLog',
      'AIConversation',
      'EligibilityAssessment',
    ];
    for (const table of tables) {
      await query(`DELETE FROM "${table}" WHERE "userId"=$1`, [userId]);
    }
    await query(`DELETE FROM "AnonymousMigration" WHERE "anonymousUserId"=$1 OR "targetUserId"=$1`, [userId]);
  }
}

function deletedIdentifier(kind: string, userId: string): string {
  return `deleted-${kind}-${createHash('sha256').update(userId).digest('hex').slice(0, 20)}`;
}
