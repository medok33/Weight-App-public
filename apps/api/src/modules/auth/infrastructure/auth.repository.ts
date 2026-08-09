import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { SESSION_POLICY } from '../domain/auth.policy';
import {
  AUTH_ABUSE_POLICY,
  blockedUntilToRetryAfterSeconds,
  type AuthBlockDecision,
  type AuthThrottleAction,
  type AuthThrottleSubjectType,
} from '../domain/auth-abuse.policy';
import type { RequestUser } from '../domain/request-user.types';

export type SessionRecord = {
  userId: string;
  role: string;
  email: string | null;
  username: string | null;
  mfaVerifiedAt: Date | null;
  recentOwnerReauthAt: Date | null;
};

export type OwnerMfaCredentialRecord = {
  id: string;
  userId: string;
  encryptedSecret: unknown;
  confirmedAt: Date;
};

export type MfaPreAuthChallengeRecord = {
  id: string;
  userId: string;
  accountHash: string;
  sourceIpHash: string;
  accountIpHash: string;
};

@Injectable()
export class AuthRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string | null } | null> {
    const result = await this.db.query<{ id: string; email: string | null }>(
      'SELECT id, email FROM "User" WHERE lower(email) = lower($1)',
      [email.trim()],
    );
    return result.rows[0] ?? null;
  }

  async findCredential(identifier: string): Promise<{ userId: string; credentialHash: string; status: string } | null> {
    const subject = identifier.trim();
    if (!subject) return null;
    const result = await this.db.query<{ userId: string; credentialHash: string; status: string }>(
      `SELECT ai."userId", ai."credentialHash", COALESCE(u.status, 'ACTIVE') AS status
       FROM "AuthIdentity" ai
       JOIN "User" u ON u.id = ai."userId"
       WHERE ai.provider = 'email'
         AND ai."credentialHash" IS NOT NULL
         AND (
           lower(ai."providerSubject") = lower($1)
           OR lower(COALESCE(u.username, '')) = lower($1)
           OR lower(COALESCE(u.email, '')) = lower($1)
         )
       LIMIT 1`,
      [subject],
    );
    const row = result.rows[0];
    if (!row?.credentialHash) return null;
    return row;
  }

  async findCredentialByUserId(userId: string): Promise<{ userId: string; credentialHash: string; status: string } | null> {
    const result = await this.db.query<{ userId: string; credentialHash: string; status: string }>(
      `SELECT ai."userId", ai."credentialHash", COALESCE(u.status, 'ACTIVE') AS status
       FROM "AuthIdentity" ai
       JOIN "User" u ON u.id = ai."userId"
       WHERE ai.provider = 'email'
         AND ai."credentialHash" IS NOT NULL
         AND ai."userId" = $1
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row?.credentialHash) return null;
    return row;
  }

  async evaluateAuthBlock(input: {
    accountHash: string;
    ipHash: string;
    accountIpHash: string;
    action?: AuthThrottleAction;
  }): Promise<AuthBlockDecision> {
    const action = input.action ?? 'login';
    const result = await this.db.query<{ reason: string; blockedUntil: Date }>(
      `WITH candidates AS (
         SELECT 'account_lockout'::text AS reason, "lockedUntil" AS "blockedUntil"
         FROM "AuthAccountLockout"
         WHERE "accountHash" = $1 AND "lockedUntil" > CURRENT_TIMESTAMP
         UNION ALL
         SELECT
           CASE "subjectType"
             WHEN 'account' THEN 'account_throttle'
             WHEN 'ip' THEN 'ip_throttle'
             ELSE 'account_ip_throttle'
           END AS reason,
           "blockedUntil"
         FROM "AuthThrottleBucket"
         WHERE "action" = $4
           AND "blockedUntil" > CURRENT_TIMESTAMP
           AND (
             ("subjectType" = 'account' AND "subjectHash" = $1)
             OR ("subjectType" = 'ip' AND "subjectHash" = $2)
             OR ("subjectType" = 'account_ip' AND "subjectHash" = $3)
           )
       )
       SELECT reason, "blockedUntil"
       FROM candidates
       ORDER BY "blockedUntil" DESC
       LIMIT 1`,
      [input.accountHash, input.ipHash, input.accountIpHash, action],
    );
    const row = result.rows[0];
    if (!row) return { blocked: false };
    return {
      blocked: true,
      reason: row.reason as NonNullable<AuthBlockDecision['reason']>,
      retryAfterSeconds: blockedUntilToRetryAfterSeconds(row.blockedUntil),
    };
  }

  async evaluateMfaBlock(input: {
    challengeHash: string;
    accountHash: string;
    ipHash: string;
    accountIpHash: string;
  }): Promise<AuthBlockDecision> {
    const result = await this.db.query<{ reason: string; blockedUntil: Date }>(
      `SELECT
         CASE "subjectType"
           WHEN 'challenge' THEN 'challenge_throttle'
           WHEN 'account' THEN 'account_throttle'
           WHEN 'ip' THEN 'ip_throttle'
           ELSE 'account_ip_throttle'
         END AS reason,
         "blockedUntil"
       FROM "AuthThrottleBucket"
       WHERE "action" = 'mfa_challenge'
         AND "blockedUntil" > CURRENT_TIMESTAMP
         AND (
           ("subjectType" = 'challenge' AND "subjectHash" = $1)
           OR ("subjectType" = 'account' AND "subjectHash" = $2)
           OR ("subjectType" = 'ip' AND "subjectHash" = $3)
           OR ("subjectType" = 'account_ip' AND "subjectHash" = $4)
         )
       ORDER BY "blockedUntil" DESC
       LIMIT 1`,
      [input.challengeHash, input.accountHash, input.ipHash, input.accountIpHash],
    );
    const row = result.rows[0];
    if (!row) return { blocked: false };
    return {
      blocked: true,
      reason: row.reason as NonNullable<AuthBlockDecision['reason']>,
      retryAfterSeconds: blockedUntilToRetryAfterSeconds(row.blockedUntil),
    };
  }

  async recordLoginFailure(input: {
    accountHash: string;
    ipHash: string;
    accountIpHash: string;
    userId?: string | null;
  }): Promise<AuthBlockDecision & { accountFailures: number; ipFailures: number; accountIpFailures: number }> {
    return this.db.withTransaction(async (query) => {
      const account = await this.upsertThrottleBucket(query, {
        action: 'login',
        subjectType: 'account',
        subjectHash: input.accountHash,
        windowSeconds: AUTH_ABUSE_POLICY.loginWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.loginAccountMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.loginLockoutSeconds,
      });
      const ip = await this.upsertThrottleBucket(query, {
        action: 'login',
        subjectType: 'ip',
        subjectHash: input.ipHash,
        windowSeconds: AUTH_ABUSE_POLICY.loginWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.loginIpMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.loginWindowSeconds,
      });
      const accountIp = await this.upsertThrottleBucket(query, {
        action: 'login',
        subjectType: 'account_ip',
        subjectHash: input.accountIpHash,
        windowSeconds: AUTH_ABUSE_POLICY.loginWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.loginAccountIpMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.loginWindowSeconds,
      });
      const lockout = await this.upsertAccountLockout(query, input.accountHash);

      if (lockout.justLocked) {
        await this.appendAuditEventWithQuery(query, {
          actorUserId: input.userId ?? null,
          action: 'auth.account.locked',
          entityType: input.userId ? 'User' : null,
          entityId: input.userId ?? null,
          metadata: {
            subject: 'account_hash',
            reason: 'repeated_failures',
            failureBand: failureBand(lockout.failureCount),
            lockoutSeconds: AUTH_ABUSE_POLICY.loginLockoutSeconds,
          },
        });
      }
      if (ip.justBlocked) {
        await this.appendAuditEventWithQuery(query, {
          actorUserId: null,
          action: 'auth.ip.throttled',
          metadata: {
            subject: 'ip_hash',
            failureBand: failureBand(ip.failureCount),
            windowSeconds: AUTH_ABUSE_POLICY.loginWindowSeconds,
          },
        });
      }
      if (account.failureCount === AUTH_ABUSE_POLICY.highRiskFailureCount) {
        await this.appendAuditEventWithQuery(query, {
          actorUserId: input.userId ?? null,
          action: 'auth.failure.high_risk',
          entityType: input.userId ? 'User' : null,
          entityId: input.userId ?? null,
          metadata: {
            subject: 'account_hash',
            failureBand: failureBand(account.failureCount),
            hasKnownAccount: Boolean(input.userId),
          },
        });
      }

      const blocks: Array<{ reason: NonNullable<AuthBlockDecision['reason']>; blockedUntil: Date | null }> = [
        { reason: 'account_lockout' as const, blockedUntil: lockout.lockedUntil },
        { reason: 'account_throttle' as const, blockedUntil: account.blockedUntil },
        { reason: 'ip_throttle' as const, blockedUntil: ip.blockedUntil },
        { reason: 'account_ip_throttle' as const, blockedUntil: accountIp.blockedUntil },
      ].filter((row) => Boolean(row.blockedUntil && row.blockedUntil.getTime() > Date.now()));
      blocks.sort((a, b) => b.blockedUntil!.getTime() - a.blockedUntil!.getTime());
      const block = blocks[0];
      return {
        blocked: Boolean(block),
        reason: block?.reason,
        retryAfterSeconds: block?.blockedUntil ? blockedUntilToRetryAfterSeconds(block.blockedUntil) : undefined,
        accountFailures: account.failureCount,
        ipFailures: ip.failureCount,
        accountIpFailures: accountIp.failureCount,
      };
    });
  }

  async recordRegistrationAttempt(input: {
    accountHash: string;
    ipHash: string;
  }): Promise<AuthBlockDecision> {
    return this.db.withTransaction(async (query) => {
      const account = await this.upsertThrottleBucket(query, {
        action: 'register',
        subjectType: 'account',
        subjectHash: input.accountHash,
        windowSeconds: AUTH_ABUSE_POLICY.registerWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.registerAccountMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.registerWindowSeconds,
      });
      const ip = await this.upsertThrottleBucket(query, {
        action: 'register',
        subjectType: 'ip',
        subjectHash: input.ipHash,
        windowSeconds: AUTH_ABUSE_POLICY.registerWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.registerIpMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.registerWindowSeconds,
      });
      if (ip.justBlocked) {
        await this.appendAuditEventWithQuery(query, {
          actorUserId: null,
          action: 'auth.registration.ip_throttled',
          metadata: { subject: 'ip_hash', failureBand: failureBand(ip.failureCount) },
        });
      }
      const block = [account, ip]
        .filter((row) => row.blockedUntil && row.blockedUntil.getTime() > Date.now())
        .sort((a, b) => b.blockedUntil!.getTime() - a.blockedUntil!.getTime())[0];
      return block
        ? {
            blocked: true,
            reason: block.subjectType === 'ip' ? 'ip_throttle' : 'account_throttle',
            retryAfterSeconds: blockedUntilToRetryAfterSeconds(block.blockedUntil!),
          }
        : { blocked: false };
    });
  }

  async recordMfaFailure(input: {
    challengeHash: string;
    accountHash: string;
    ipHash: string;
    accountIpHash: string;
    userId?: string | null;
  }): Promise<AuthBlockDecision> {
    return this.db.withTransaction(async (query) => {
      const challenge = await this.upsertThrottleBucket(query, {
        action: 'mfa_challenge',
        subjectType: 'challenge',
        subjectHash: input.challengeHash,
        windowSeconds: AUTH_ABUSE_POLICY.mfaWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.mfaChallengeMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.mfaBlockSeconds,
      });
      const account = await this.upsertThrottleBucket(query, {
        action: 'mfa_challenge',
        subjectType: 'account',
        subjectHash: input.accountHash,
        windowSeconds: AUTH_ABUSE_POLICY.mfaWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.mfaAccountMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.mfaBlockSeconds,
      });
      const ip = await this.upsertThrottleBucket(query, {
        action: 'mfa_challenge',
        subjectType: 'ip',
        subjectHash: input.ipHash,
        windowSeconds: AUTH_ABUSE_POLICY.mfaWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.mfaIpMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.mfaBlockSeconds,
      });
      const accountIp = await this.upsertThrottleBucket(query, {
        action: 'mfa_challenge',
        subjectType: 'account_ip',
        subjectHash: input.accountIpHash,
        windowSeconds: AUTH_ABUSE_POLICY.mfaWindowSeconds,
        maxFailures: AUTH_ABUSE_POLICY.mfaAccountIpMaxFailures,
        blockSeconds: AUTH_ABUSE_POLICY.mfaBlockSeconds,
      });
      if (challenge.justBlocked || account.justBlocked || ip.justBlocked || accountIp.justBlocked) {
        await this.appendAuditEventWithQuery(query, {
          actorUserId: input.userId ?? null,
          action: 'auth.mfa.throttled',
          entityType: input.userId ? 'User' : null,
          entityId: input.userId ?? null,
          metadata: { subject: 'mfa_hash', failureBand: failureBand(Math.max(challenge.failureCount, account.failureCount, ip.failureCount, accountIp.failureCount)) },
        });
      }
      const block = ([
        { reason: 'challenge_throttle' as const, blockedUntil: challenge.blockedUntil },
        { reason: 'account_throttle' as const, blockedUntil: account.blockedUntil },
        { reason: 'ip_throttle' as const, blockedUntil: ip.blockedUntil },
        { reason: 'account_ip_throttle' as const, blockedUntil: accountIp.blockedUntil },
      ] as Array<{ reason: NonNullable<AuthBlockDecision['reason']>; blockedUntil: Date | null }>)
        .filter((row) => Boolean(row.blockedUntil && row.blockedUntil.getTime() > Date.now()))
        .sort((a, b) => b.blockedUntil!.getTime() - a.blockedUntil!.getTime())[0];
      return block?.blockedUntil ? { blocked: true, reason: block.reason, retryAfterSeconds: blockedUntilToRetryAfterSeconds(block.blockedUntil) } : { blocked: false };
    });
  }

  async clearSuccessfulMfa(input: { challengeHash: string; accountHash: string; accountIpHash: string }): Promise<void> {
    await this.db.query(
      `UPDATE "AuthThrottleBucket"
       SET "failureCount" = 0,
           "blockedUntil" = NULL,
           "successClearedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "action" = 'mfa_challenge'
         AND (("subjectType" = 'challenge' AND "subjectHash" = $1)
           OR ("subjectType" = 'account' AND "subjectHash" = $2)
           OR ("subjectType" = 'account_ip' AND "subjectHash" = $3))`,
      [input.challengeHash, input.accountHash, input.accountIpHash],
    );
  }

  async clearSuccessfulLogin(input: { accountHash: string; accountIpHash: string; userId: string }): Promise<void> {
    await this.db.withTransaction(async (query) => {
      await query(
        `UPDATE "AuthThrottleBucket"
         SET "failureCount" = 0,
             "blockedUntil" = NULL,
             "successClearedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "action" = 'login'
           AND (("subjectType" = 'account' AND "subjectHash" = $1)
             OR ("subjectType" = 'account_ip' AND "subjectHash" = $2))`,
        [input.accountHash, input.accountIpHash],
      );
      const recovered = await query<{ wasLocked: boolean }>(
        `WITH before AS (
           SELECT ("lockedUntil" IS NOT NULL AND "lockedUntil" > CURRENT_TIMESTAMP) AS "wasLocked"
           FROM "AuthAccountLockout"
           WHERE "accountHash" = $1
         ),
         updated AS (
           UPDATE "AuthAccountLockout"
           SET "failureCount" = 0,
               "lockedUntil" = NULL,
               "recoveredAt" = CURRENT_TIMESTAMP,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "accountHash" = $1
           RETURNING 1
         )
         SELECT COALESCE((SELECT "wasLocked" FROM before), false) AS "wasLocked"`,
        [input.accountHash],
      );
      if (recovered.rows[0]?.wasLocked) {
        await this.appendAuditEventWithQuery(query, {
          actorUserId: input.userId,
          action: 'auth.account.recovered',
          entityType: 'User',
          entityId: input.userId,
          metadata: { recovery: 'successful_login' },
        });
      }
    });
  }

  async hasVerifiedOwnerMfa(userId: string): Promise<boolean> {
    const result = await this.db.query<{ verified: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "OwnerMfaCredential"
         WHERE "userId" = $1 AND status = 'ACTIVE' AND "disabledAt" IS NULL
       ) AS verified`,
      [userId],
    );
    return result.rows[0]?.verified === true;
  }

  async countOwners(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "User"
       WHERE "accountRole" = 'OWNER' AND COALESCE(status, 'ACTIVE') = 'ACTIVE'`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async setAccountRole(actorUserId: string, targetUserId: string, nextRole: string): Promise<void> {
    const normalized = String(nextRole ?? '').toUpperCase();
    if (!['USER', 'ADMIN', 'OWNER'].includes(normalized)) throw new Error('ROLE_INVALID');
    if (normalized === 'OWNER') throw new Error('OWNER_ASSIGN_FORBIDDEN');

    const target = await this.db.query<{ accountRole: string; status: string }>(
      `SELECT COALESCE("accountRole", 'USER') AS "accountRole", COALESCE(status, 'ACTIVE') AS status
       FROM "User" WHERE id = $1`,
      [targetUserId],
    );
    const row = target.rows[0];
    if (!row) throw new Error('USER_NOT_FOUND');

    if (row.accountRole === 'OWNER' && normalized !== 'OWNER') {
      if ((await this.countOwners()) <= 1) throw new Error('LAST_OWNER_PROTECTED');
    }

    await this.db.query(
      `UPDATE "User" SET "accountRole" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [targetUserId, normalized],
    );
    await this.writeAuditLog({
      ownerUserId: actorUserId,
      targetUserId,
      action: 'owner.role.updated',
      entityType: 'User',
      entityId: targetUserId,
      metadata: { from: row.accountRole, to: normalized },
    });
  }

  async deactivateUser(actorUserId: string, targetUserId: string): Promise<void> {
    const target = await this.db.query<{ accountRole: string }>(
      `SELECT COALESCE("accountRole", 'USER') AS "accountRole" FROM "User" WHERE id = $1`,
      [targetUserId],
    );
    const role = target.rows[0]?.accountRole;
    if (!role) throw new Error('USER_NOT_FOUND');
    if (role === 'OWNER' && (await this.countOwners()) <= 1) throw new Error('LAST_OWNER_PROTECTED');

    await this.db.query(
      `UPDATE "User" SET status = 'INACTIVE', "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [targetUserId],
    );
    await this.db.query(
      `UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP
       WHERE "userId" = $1 AND "revokedAt" IS NULL`,
      [targetUserId],
    );
    await this.writeAuditLog({
      ownerUserId: actorUserId,
      targetUserId,
      action: 'owner.user.deactivated',
      entityType: 'User',
      entityId: targetUserId,
    });
  }

  async revokeOtherSessions(userId: string, keepRawToken?: string): Promise<void> {
    const keepHash = keepRawToken ? this.hashToken(keepRawToken) : null;
    await this.db.query(
      `UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP
       WHERE "userId" = $1 AND "revokedAt" IS NULL
         AND ($2::text IS NULL OR "tokenHash" <> $2)`,
      [userId, keepHash],
    );
  }

  async writeAuditLog(input: {
    ownerUserId: string;
    targetUserId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO "AuditLog"
         ("ownerUserId", "targetUserId", action, "entityType", "entityId", "requestId", metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.ownerUserId,
        input.targetUserId ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.requestId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    await this.db.query(
      `INSERT INTO "OwnerAuditEvent" ("userId", action, metadata)
       VALUES ($1, $2, $3::jsonb)`,
      [input.ownerUserId, input.action, JSON.stringify({ ...input.metadata, targetUserId: input.targetUserId })],
    );
  }

  async createRegisteredUser(email: string, passwordHash: string): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `WITH new_user AS (
         INSERT INTO "User" (email) VALUES ($1) RETURNING id
       ),
       identity AS (
         INSERT INTO "AuthIdentity" ("userId", provider, "providerSubject", "credentialHash")
         SELECT id, 'email', $1, $2 FROM new_user
         RETURNING "userId"
       ),
       subscription AS (
         INSERT INTO "UserSubscription" ("userId", tier, status)
         SELECT "userId", 'FREE', 'active' FROM identity
         RETURNING "userId"
       )
       SELECT id FROM new_user`,
      [email.trim().toLowerCase(), passwordHash],
    );
    const userId = result.rows[0]?.id;
    if (!userId) throw new Error('USER_CREATE_FAILED');
    return userId;
  }

  async ensureFreeSubscription(userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO "UserSubscription" ("userId", tier, status)
       VALUES ($1, 'FREE', 'active')
       ON CONFLICT ("userId") DO NOTHING`,
      [userId],
    );
  }

  async createSession(userId: string, role = 'USER', mfaVerifiedAt?: Date | null): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_POLICY.ttlSeconds * 1000);
    await this.db.query(
      `INSERT INTO "Session" ("userId", "tokenHash", "expiresAt", role, "mfaVerifiedAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, expiresAt.toISOString(), role, mfaVerifiedAt?.toISOString() ?? null],
    );
    return { rawToken, expiresAt };
  }

  async revokeSession(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.db.query(
      `UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP
       WHERE "tokenHash" = $1 AND "revokedAt" IS NULL`,
      [tokenHash],
    );
  }

  async resolveSession(rawToken: string): Promise<SessionRecord | null> {
    const tokenHash = this.hashToken(rawToken);
    const result = await this.db.query<{ userId: string; role: string; email: string | null; username: string | null; mfaVerifiedAt: Date | null; recentOwnerReauthAt: Date | null }>(
      `SELECT s."userId", s.role, u.email, u.username, s."mfaVerifiedAt", s."recentOwnerReauthAt"
       FROM "Session" s
       JOIN "User" u ON u.id = s."userId"
       WHERE s."tokenHash" = $1
         AND s."revokedAt" IS NULL
         AND s."expiresAt" > CURRENT_TIMESTAMP`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { userId: row.userId, role: row.role, email: row.email, username: row.username, mfaVerifiedAt: row.mfaVerifiedAt, recentOwnerReauthAt: row.recentOwnerReauthAt };
  }

  async getUserById(userId: string): Promise<RequestUser | null> {
    const result = await this.db.query<{ id: string; email: string | null; username: string | null; accountRole: string | null }>(
      `SELECT id, email, username, COALESCE("accountRole", 'USER') AS "accountRole" FROM "User" WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, email: row.email, username: row.username, role: row.accountRole ?? 'USER' };
  }

  async getAccountRole(userId: string): Promise<string> {
    const result = await this.db.query<{ accountRole: string | null }>(
      `SELECT COALESCE("accountRole", 'USER') AS "accountRole" FROM "User" WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.accountRole ?? 'USER';
  }

  async ensureOwnerMfa(userId: string): Promise<void> {
    void userId;
  }

  async upsertOwnerAccount(login: string, passwordHash: string): Promise<string> {
    const subject = login.trim();
    const existing = await this.findCredential(subject);
    if (existing) {
      await this.db.query(
        `UPDATE "AuthIdentity" SET "credentialHash" = $2 WHERE "userId" = $1 AND provider = 'email'`,
        [existing.userId, passwordHash],
      );
      await this.db.query(
        `UPDATE "User" SET email = $2, "accountRole" = 'OWNER', "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
        [existing.userId, subject],
      );
      await this.setSubscriptionTier(existing.userId, 'PREMIUM');
      return existing.userId;
    }

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO "User" (email, "accountRole") VALUES ($1, 'OWNER') RETURNING id`,
      [subject],
    );
    const userId = result.rows[0]?.id;
    if (!userId) throw new Error('USER_CREATE_FAILED');
    await this.db.query(
      `INSERT INTO "AuthIdentity" ("userId", provider, "providerSubject", "credentialHash")
       VALUES ($1, 'email', $2, $3)`,
      [userId, subject, passwordHash],
    );
    await this.setSubscriptionTier(userId, 'PREMIUM');
    return userId;
  }

  async createMfaPreAuthChallenge(input: {
    userId: string;
    accountHash: string;
    sourceIpHash: string;
    accountIpHash: string;
    expiresAt: Date;
  }): Promise<{ rawChallenge: string; id: string; expiresAt: Date }> {
    const rawChallenge = randomBytes(32).toString('base64url');
    const challengeHash = this.hashToken(rawChallenge);
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO "MfaPreAuthChallenge"
         ("userId", "challengeHash", "accountHash", "sourceIpHash", "accountIpHash", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [input.userId, challengeHash, input.accountHash, input.sourceIpHash, input.accountIpHash, input.expiresAt.toISOString()],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('MFA_CHALLENGE_CREATE_FAILED');
    return { rawChallenge, id, expiresAt: input.expiresAt };
  }

  async consumeMfaPreAuthChallenge(rawChallenge: string): Promise<MfaPreAuthChallengeRecord | null> {
    const challengeHash = this.hashToken(rawChallenge);
    return this.db.withTransaction(async (query) => {
      const result = await query<MfaPreAuthChallengeRecord>(
        `UPDATE "MfaPreAuthChallenge"
         SET "consumedAt" = CURRENT_TIMESTAMP
         WHERE "challengeHash" = $1
           AND "consumedAt" IS NULL
           AND "expiresAt" > CURRENT_TIMESTAMP
         RETURNING id, "userId", "accountHash", "sourceIpHash", "accountIpHash"`,
        [challengeHash],
      );
      return result.rows[0] ?? null;
    });
  }

  async getActiveOwnerMfaCredential(userId: string): Promise<OwnerMfaCredentialRecord | null> {
    const result = await this.db.query<OwnerMfaCredentialRecord>(
      `SELECT id, "userId", "encryptedSecret", "confirmedAt"
       FROM "OwnerMfaCredential"
       WHERE "userId" = $1 AND status = 'ACTIVE' AND "disabledAt" IS NULL
       ORDER BY "confirmedAt" DESC
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async createOwnerMfaEnrollmentDraft(userId: string, encryptedSecret: unknown, expiresAt: Date): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO "OwnerMfaEnrollmentDraft" ("userId", "encryptedSecret", "expiresAt")
       VALUES ($1, $2::jsonb, $3)
       RETURNING id`,
      [userId, JSON.stringify(encryptedSecret), expiresAt.toISOString()],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('MFA_ENROLLMENT_CREATE_FAILED');
    return id;
  }

  async getOwnerMfaEnrollmentDraftSecret(userId: string, draftId: string): Promise<unknown | null> {
    const result = await this.db.query<{ encryptedSecret: unknown }>(
      `SELECT "encryptedSecret" FROM "OwnerMfaEnrollmentDraft"
       WHERE id = $1 AND "userId" = $2 AND "confirmedAt" IS NULL AND "cancelledAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP`,
      [draftId, userId],
    );
    return result.rows[0]?.encryptedSecret ?? null;
  }

  async confirmOwnerMfaEnrollmentDraft(input: {
    draftId: string;
    userId: string;
    recoveryCodeHashes: string[];
  }): Promise<{ credentialId: string; encryptedSecret: unknown } | null> {
    return this.db.withTransaction(async (query) => {
      const draft = await query<{ encryptedSecret: unknown }>(
        `UPDATE "OwnerMfaEnrollmentDraft"
         SET "confirmedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND "userId" = $2 AND "confirmedAt" IS NULL AND "cancelledAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP
         RETURNING "encryptedSecret"`,
        [input.draftId, input.userId],
      );
      const encryptedSecret = draft.rows[0]?.encryptedSecret;
      if (!encryptedSecret) return null;
      const credential = await query<{ id: string }>(
        `INSERT INTO "OwnerMfaCredential" ("userId", "encryptedSecret", "confirmedAt")
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         RETURNING id`,
        [input.userId, JSON.stringify(encryptedSecret)],
      );
      const credentialId = credential.rows[0]?.id;
      if (!credentialId) throw new Error('MFA_CREDENTIAL_CREATE_FAILED');
      for (const codeHash of input.recoveryCodeHashes) {
        await query(
          `INSERT INTO "OwnerMfaRecoveryCode" ("userId", "credentialId", "codeHash")
           VALUES ($1, $2, $3)`,
          [input.userId, credentialId, codeHash],
        );
      }
      return { credentialId, encryptedSecret };
    });
  }

  async cancelOwnerMfaEnrollmentDraft(userId: string, draftId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE "OwnerMfaEnrollmentDraft"
       SET "cancelledAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "userId" = $2 AND "confirmedAt" IS NULL AND "cancelledAt" IS NULL`,
      [draftId, userId],
    );
    return Number(result.rowCount ?? 0) > 0;
  }

  async consumeRecoveryCode(userId: string, credentialId: string, codeHash: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE "OwnerMfaRecoveryCode"
       SET "usedAt" = CURRENT_TIMESTAMP
       WHERE "userId" = $1 AND "credentialId" = $2 AND "codeHash" = $3 AND "usedAt" IS NULL`,
      [userId, credentialId, codeHash],
    );
    return Number(result.rowCount ?? 0) === 1;
  }

  async replaceRecoveryCodes(userId: string, credentialId: string, codeHashes: string[]): Promise<void> {
    await this.db.withTransaction(async (query) => {
      await query(`DELETE FROM "OwnerMfaRecoveryCode" WHERE "userId" = $1 AND "credentialId" = $2`, [userId, credentialId]);
      for (const codeHash of codeHashes) {
        await query(
          `INSERT INTO "OwnerMfaRecoveryCode" ("userId", "credentialId", "codeHash")
           VALUES ($1, $2, $3)`,
          [userId, credentialId, codeHash],
        );
      }
    });
  }

  async recordTotpReplayStep(userId: string, timeStep: bigint): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO "OwnerMfaReplayState" ("userId", "timeStep")
       VALUES ($1, $2)
       ON CONFLICT ("userId", "timeStep") DO NOTHING`,
      [userId, timeStep.toString()],
    );
    return Number(result.rowCount ?? 0) === 1;
  }

  async updateSessionRecentReauth(rawToken: string, when = new Date()): Promise<void> {
    await this.db.query(
      `UPDATE "Session"
       SET "recentOwnerReauthAt" = $2
       WHERE "tokenHash" = $1 AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP`,
      [this.hashToken(rawToken), when.toISOString()],
    );
  }

  /** Marks the current session as MFA-complete without changing the account role/permission set. */
  async markSessionMfaVerified(rawToken: string, when = new Date()): Promise<void> {
    const result = await this.db.query(
      `UPDATE "Session"
       SET "mfaVerifiedAt" = $2
       WHERE "tokenHash" = $1 AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP`,
      [this.hashToken(rawToken), when.toISOString()],
    );
    if (Number(result.rowCount ?? 0) !== 1) throw new Error('SESSION_NOT_FOUND');
  }

  async revokeUserSessions(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP
       WHERE "userId" = $1 AND "revokedAt" IS NULL`,
      [userId],
    );
  }

  async appendAuditEvent(input: {
    actorUserId: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.appendAuditEventWithQuery(this.db.query.bind(this.db), input);
  }

  async isAnonymousUser(userId: string): Promise<boolean> {
    const result = await this.db.query<{ ok: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM "AuthIdentity" WHERE "userId" = $1
       ) AND EXISTS (
         SELECT 1 FROM "User" WHERE id = $1 AND email IS NULL
       ) AS ok`,
      [userId],
    );
    return result.rows[0]?.ok === true;
  }

  async wasMigrated(anonymousUserId: string): Promise<boolean> {
    const result = await this.db.query<{ ok: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM "AnonymousMigration" WHERE "anonymousUserId" = $1) AS ok',
      [anonymousUserId],
    );
    return result.rows[0]?.ok === true;
  }

  async migrateAnonymousData(anonymousUserId: string, targetUserId: string): Promise<void> {
    if (anonymousUserId === targetUserId) return;
    if (await this.wasMigrated(anonymousUserId)) throw new Error('ANONYMOUS_ALREADY_MIGRATED');
    if (!(await this.isAnonymousUser(anonymousUserId))) throw new Error('ANONYMOUS_INVALID');

    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `UPDATE "UserProfile" SET "userId" = $2
         WHERE "userId" = $1
           AND NOT EXISTS (SELECT 1 FROM "UserProfile" WHERE "userId" = $2)`,
        [anonymousUserId, targetUserId],
      );
      await this.db.query('DELETE FROM "UserProfile" WHERE "userId" = $1', [anonymousUserId]);
      await this.db.query('UPDATE "ShoppingList" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query('UPDATE "AIConversation" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query('UPDATE "AIUsageLog" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query('UPDATE "AIMessageFeedback" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query('UPDATE "ProgressEntry" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query('UPDATE "MealCompletion" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query('UPDATE "Entitlement" SET "userId" = $2 WHERE "userId" = $1', [anonymousUserId, targetUserId]);
      await this.db.query(
        `INSERT INTO "AnonymousMigration" ("anonymousUserId", "targetUserId") VALUES ($1, $2)`,
        [anonymousUserId, targetUserId],
      );
      await this.db.query('DELETE FROM "User" WHERE id = $1', [anonymousUserId]);
      await this.db.query('COMMIT');
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }
  }

  async getSubscription(userId: string): Promise<{ tier: 'FREE' | 'PREMIUM'; status: string } | null> {
    const result = await this.db.query<{ tier: 'FREE' | 'PREMIUM'; status: string }>(
      `SELECT tier, status FROM "UserSubscription"
       WHERE "userId" = $1
         AND status = 'active'
         AND "startsAt" <= CURRENT_TIMESTAMP
         AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async setSubscriptionTier(targetUserId: string, tier: 'FREE' | 'PREMIUM'): Promise<void> {
    await this.db.query(
      `INSERT INTO "UserSubscription" ("userId", tier, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT ("userId") DO UPDATE
       SET tier = EXCLUDED.tier, status = 'active', "updatedAt" = CURRENT_TIMESTAMP`,
      [targetUserId, tier],
    );
  }

  private async upsertThrottleBucket(
    query: SqlQuery,
    input: {
      action: AuthThrottleAction;
      subjectType: AuthThrottleSubjectType;
      subjectHash: string;
      windowSeconds: number;
      maxFailures: number;
      blockSeconds: number;
    },
  ): Promise<{ subjectType: AuthThrottleSubjectType; failureCount: number; blockedUntil: Date | null; justBlocked: boolean }> {
    const result = await query<{ failureCount: number; blockedUntil: Date | null; justBlocked: boolean }>(
      `WITH upserted AS (
         INSERT INTO "AuthThrottleBucket"
           ("action", "subjectType", "subjectHash", "windowStartedAt", "failureCount", "blockedUntil", "lastFailureAt")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 1, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT ("action", "subjectType", "subjectHash") DO UPDATE
         SET "failureCount" =
               CASE
                 WHEN "AuthThrottleBucket"."windowStartedAt" < CURRENT_TIMESTAMP - ($4::int * INTERVAL '1 second') THEN 1
                 ELSE "AuthThrottleBucket"."failureCount" + 1
               END,
             "windowStartedAt" =
               CASE
                 WHEN "AuthThrottleBucket"."windowStartedAt" < CURRENT_TIMESTAMP - ($4::int * INTERVAL '1 second') THEN CURRENT_TIMESTAMP
                 ELSE "AuthThrottleBucket"."windowStartedAt"
               END,
             "blockedUntil" =
               CASE
                 WHEN "AuthThrottleBucket"."blockedUntil" IS NOT NULL
                   AND "AuthThrottleBucket"."blockedUntil" > CURRENT_TIMESTAMP
                   THEN "AuthThrottleBucket"."blockedUntil"
                 WHEN (
                   CASE
                     WHEN "AuthThrottleBucket"."windowStartedAt" < CURRENT_TIMESTAMP - ($4::int * INTERVAL '1 second') THEN 1
                     ELSE "AuthThrottleBucket"."failureCount" + 1
                   END
                 ) >= $5::int
                   THEN CURRENT_TIMESTAMP + ($6::int * INTERVAL '1 second')
                 ELSE NULL
               END,
             "lastFailureAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
         RETURNING
           "failureCount",
           "blockedUntil",
           ("blockedUntil" IS NOT NULL AND "blockedUntil" > CURRENT_TIMESTAMP) AS "isBlocked"
       )
       SELECT
         "failureCount",
         "blockedUntil",
         ("isBlocked" AND "failureCount" = $5::int) AS "justBlocked"
       FROM upserted`,
      [input.action, input.subjectType, input.subjectHash, input.windowSeconds, input.maxFailures, input.blockSeconds],
    );
    const row = result.rows[0];
    return {
      subjectType: input.subjectType,
      failureCount: Number(row?.failureCount ?? 1),
      blockedUntil: row?.blockedUntil ?? null,
      justBlocked: row?.justBlocked === true,
    };
  }

  private async upsertAccountLockout(
    query: SqlQuery,
    accountHash: string,
  ): Promise<{ failureCount: number; lockedUntil: Date | null; justLocked: boolean }> {
    const result = await query<{ failureCount: number; lockedUntil: Date | null; justLocked: boolean }>(
      `WITH upserted AS (
         INSERT INTO "AuthAccountLockout" ("accountHash", "failureCount", "lockedUntil", "lastFailureAt")
         VALUES ($1, 1, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT ("accountHash") DO UPDATE
         SET "failureCount" =
               CASE
                 WHEN "AuthAccountLockout"."lockedUntil" IS NOT NULL
                   AND "AuthAccountLockout"."lockedUntil" <= CURRENT_TIMESTAMP THEN 1
                 ELSE "AuthAccountLockout"."failureCount" + 1
               END,
             "lockedUntil" =
               CASE
                 WHEN "AuthAccountLockout"."lockedUntil" IS NOT NULL
                   AND "AuthAccountLockout"."lockedUntil" > CURRENT_TIMESTAMP
                   THEN "AuthAccountLockout"."lockedUntil"
                 WHEN (
                   CASE
                     WHEN "AuthAccountLockout"."lockedUntil" IS NOT NULL
                       AND "AuthAccountLockout"."lockedUntil" <= CURRENT_TIMESTAMP THEN 1
                     ELSE "AuthAccountLockout"."failureCount" + 1
                   END
                 ) >= $2::int
                   THEN CURRENT_TIMESTAMP + ($3::int * INTERVAL '1 second')
                 ELSE NULL
               END,
             "lastFailureAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
         RETURNING
           "failureCount",
           "lockedUntil",
           ("lockedUntil" IS NOT NULL AND "lockedUntil" > CURRENT_TIMESTAMP) AS "isLocked"
       )
       SELECT
         "failureCount",
         "lockedUntil",
         ("isLocked" AND "failureCount" = $2::int) AS "justLocked"
       FROM upserted`,
      [accountHash, AUTH_ABUSE_POLICY.loginAccountMaxFailures, AUTH_ABUSE_POLICY.loginLockoutSeconds],
    );
    const row = result.rows[0];
    return {
      failureCount: Number(row?.failureCount ?? 1),
      lockedUntil: row?.lockedUntil ?? null,
      justLocked: row?.justLocked === true,
    };
  }

  private appendAuditEventWithQuery(
    query: SqlQuery,
    input: {
      actorUserId: string | null;
      action: string;
      entityType?: string | null;
      entityId?: string | null;
      requestId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    return query(
      `INSERT INTO "AuditEvent" ("actorUserId", action, "entityType", "entityId", "requestId", metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.actorUserId,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.requestId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}

function failureBand(count: number): string {
  if (count >= 20) return '20+';
  if (count >= 10) return '10-19';
  if (count >= 5) return '5-9';
  return '1-4';
}
