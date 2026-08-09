import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { AuthService } from './auth.service';
import { AuthRepository } from '../infrastructure/auth.repository';
import { AUTH_REGISTRATION_MODE, normalizeIdentityEmail } from '../domain/identity-normalizer';
import { buildSessionCookie } from '../domain/session-cookie';
import { SESSION_POLICY } from '../domain/auth.policy';
import type { RequestUser } from '../domain/request-user.types';
import { authAbuseHash, normalizeClientAddress, AuthAbuseBlockedError } from '../domain/auth-abuse.policy';

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;
const RECOVERY_TTL = 60 * 60 * 1000;
const REAUTH_TTL = 5 * 60 * 1000;

export interface AuthDeliveryPort { deliverInvite(email: string, token: string): Promise<{ delivered: boolean; proofType?: string }>; deliverRecovery(email: string, token: string): Promise<{ delivered: boolean; proofType?: string }>; }
@Injectable()
export class TestAuthDelivery implements AuthDeliveryPort {
  readonly issued = new Map<string, { kind: string; token: string }>();
  async deliverInvite(email: string, token: string): Promise<{ delivered: boolean; proofType?: string }> { this.issued.set(`invite:${email}`, { kind: 'invite', token }); return { delivered: false }; }
  async deliverRecovery(email: string, token: string): Promise<{ delivered: boolean; proofType?: string }> { this.issued.set(`recovery:${email}`, { kind: 'recovery', token }); return { delivered: false }; }
}

@Injectable()
export class Auth01aService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(AuthService) private readonly auth: AuthService, @Inject(AuthRepository) private readonly repository: AuthRepository, @Inject(TestAuthDelivery) private readonly delivery: TestAuthDelivery) {}
  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private token() { return randomBytes(32).toString('base64url'); }
  private owner(user: RequestUser) { if (!user?.id || String(user.role).toUpperCase() !== 'OWNER') throw new Error('OWNER_ACCESS_FORBIDDEN'); }
  private async audit(q: SqlQuery, actor: string, action: string, id: string, metadata: Record<string, unknown> = {}) { await q(`INSERT INTO "AuditEvent" ("actorUserId",action,"entityType","entityId",metadata) VALUES ($1,$2,'Auth',$3,$4::jsonb)`, [actor, action, id, JSON.stringify(metadata)]); }

  async register(emailInput: unknown, password: unknown, inviteInput?: unknown, ip?: string, anonymousUserId?: string) {
    const email = normalizeIdentityEmail(emailInput); if (typeof password !== 'string') throw new Error('PASSWORD_POLICY_VIOLATION');
    const registrationBlock = await this.repository.recordRegistrationAttempt({ accountHash: authAbuseHash(`account:${email}`), ipHash: authAbuseHash(`ip:${normalizeClientAddress(ip)}`) });
    if (registrationBlock.blocked) throw new AuthAbuseBlockedError(registrationBlock.reason ?? 'ip_throttle', registrationBlock.retryAfterSeconds ?? 1);
    const inviteToken = typeof inviteInput === 'string' ? inviteInput : undefined;
    if (AUTH_REGISTRATION_MODE() === 'INVITE_ONLY' && !inviteToken) throw new Error('INVITE_REQUIRED');
    const passwordHash = this.auth.hashPassword(password);
    const userId = await this.db.withTransaction(async (q) => {
      let invite: { id: string; deliveryProvenAt: Date | null } | undefined;
      if (inviteToken) {
        const found = await q<{ id: string; emailNormalized: string; deliveryProvenAt: Date | null }>(`SELECT id,"emailNormalized","deliveryProvenAt" FROM "BetaInvite" WHERE "tokenHash"=$1 AND "redeemedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP FOR UPDATE`, [this.hash(inviteToken)]);
        if (!found.rows[0] || found.rows[0].emailNormalized !== email) throw new Error('INVITE_INVALID'); invite = found.rows[0];
      }
      const duplicate = await q<{ id: string }>('SELECT id FROM "User" WHERE lower(email)=$1 FOR SHARE', [email]); if (duplicate.rows[0]) throw new Error('EMAIL_ALREADY_EXISTS');
      const created = await q<{ id: string }>(`INSERT INTO "User" (email,"accountRole") VALUES ($1,'USER') RETURNING id`, [email]); const id = created.rows[0]?.id; if (!id) throw new Error('USER_CREATE_FAILED');
      await q(`INSERT INTO "AuthIdentity" ("userId",provider,"providerSubject","credentialHash") VALUES ($1,'email',$2,$3)`, [id, email, passwordHash]);
      await q(`INSERT INTO "UserSubscription" ("userId",tier,status) VALUES ($1,'FREE','active') ON CONFLICT ("userId") DO NOTHING`, [id]);
      if (invite) { const consumed = await q(`UPDATE "BetaInvite" SET "redeemedAt"=CURRENT_TIMESTAMP WHERE id=$1 AND "redeemedAt" IS NULL RETURNING id`, [invite.id]); if (!consumed.rowCount) throw new Error('INVITE_INVALID'); if (invite.deliveryProvenAt) await q(`UPDATE "User" SET "emailOwnershipProvenAt"=CURRENT_TIMESTAMP,"emailOwnershipProofType"='INVITE_REDEMPTION' WHERE id=$1`, [id]); await this.audit(q, id, 'auth.invite.redeemed', invite.id); }
      await this.audit(q, id, 'auth.registration.completed', id, { inviteBound: Boolean(invite) }); return id;
    });
    if (anonymousUserId) {
      if (!(await this.repository.isAnonymousUser(anonymousUserId))) throw new Error('ANONYMOUS_INVALID');
      if (await this.repository.wasMigrated(anonymousUserId)) throw new Error('ANONYMOUS_ALREADY_MIGRATED');
      await this.repository.migrateAnonymousData(anonymousUserId, userId);
    }
    const session = await this.repository.createSession(userId, 'USER'); return { user: await this.repository.getUserById(userId), cookies: [buildSessionCookie(session.rawToken, SESSION_POLICY.ttlSeconds)] };
  }

  async createInvite(actor: RequestUser, emailInput: unknown, expiresInput?: unknown) { this.owner(actor); const email = normalizeIdentityEmail(emailInput); const raw = this.token(); const expires = expiresInput ? new Date(String(expiresInput)) : new Date(Date.now() + INVITE_TTL); if (!Number.isFinite(expires.getTime()) || expires <= new Date()) throw new Error('INVITE_EXPIRY_INVALID'); const row = await this.db.withTransaction(async (q) => { await q(`UPDATE "BetaInvite" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "emailNormalized"=$1 AND "redeemedAt" IS NULL AND "revokedAt" IS NULL`, [email]); const result = await q<{ id: string }>(`INSERT INTO "BetaInvite" ("emailNormalized","tokenHash","expiresAt","createdByUserId") VALUES ($1,$2,$3,$4) RETURNING id`, [email, this.hash(raw), expires.toISOString(), actor.id]); const id = result.rows[0]!.id; await this.audit(q, actor.id, 'auth.invite.created', id, { emailNormalized: email }); return id; }); const delivery = await this.delivery.deliverInvite(email, raw); return { id: row, expiresAt: expires.toISOString(), delivery: delivery.delivered ? delivery.proofType ?? 'DELIVERED' : 'RECOVERY_UNAVAILABLE' }; }

  async resendInvite(actor: RequestUser, id: string) { this.owner(actor); const raw = this.token(); const value = await this.db.withTransaction(async (q) => { const old = await q<{ emailNormalized: string }>(`SELECT "emailNormalized" FROM "BetaInvite" WHERE id=$1 AND "redeemedAt" IS NULL AND "revokedAt" IS NULL FOR UPDATE`, [id]); if (!old.rows[0]) throw new Error('INVITE_INVALID'); const expires = new Date(Date.now() + INVITE_TTL); await q(`UPDATE "BetaInvite" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=$1`, [id]); const next = await q<{ id: string }>(`INSERT INTO "BetaInvite" ("emailNormalized","tokenHash","expiresAt","createdByUserId") VALUES ($1,$2,$3,$4) RETURNING id`, [old.rows[0].emailNormalized, this.hash(raw), expires.toISOString(), actor.id]); await q(`UPDATE "BetaInvite" SET "replacedByInviteId"=$1 WHERE id=$2`, [next.rows[0]!.id, id]); await this.audit(q, actor.id, 'auth.invite.resent', next.rows[0]!.id, { replacedInviteId: id }); return { id: next.rows[0]!.id, email: old.rows[0].emailNormalized, expires }; }); const delivery = await this.delivery.deliverInvite(value.email, raw); return { id: value.id, expiresAt: value.expires.toISOString(), delivery: delivery.delivered ? delivery.proofType ?? 'DELIVERED' : 'RECOVERY_UNAVAILABLE' }; }
  async revokeInvite(actor: RequestUser, id: string) { this.owner(actor); const result = await this.db.query(`UPDATE "BetaInvite" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE id=$1 AND "redeemedAt" IS NULL RETURNING id`, [id]); if (result.rowCount) await this.repository.appendAuditEvent({ actorUserId: actor.id, action: 'auth.invite.revoked', entityType: 'BetaInvite', entityId: id, metadata: {} }); return { ok: true }; }

  async requestRecovery(emailInput: unknown, ip?: string) { const email = normalizeIdentityEmail(emailInput); const accountHash = authAbuseHash(`account:${email}`); const ipHash = authAbuseHash(`ip:${normalizeClientAddress(ip)}`); const block = await this.repository.evaluateAuthBlock({ accountHash, ipHash, accountIpHash: authAbuseHash(`account_ip:${email}:${normalizeClientAddress(ip)}`), action: 'password_reset' }); if (block.blocked) throw new AuthAbuseBlockedError(block.reason ?? 'ip_throttle', block.retryAfterSeconds ?? 1); const account = await this.db.query<{ id: string; email: string }>(`SELECT id,email FROM "User" WHERE lower(email)=$1 AND status='ACTIVE'`, [email]); if (!account.rows[0]) { await this.db.query(`INSERT INTO "AuditEvent" ("actorUserId",action,"entityType",metadata) VALUES (NULL,'auth.recovery.unavailable','Auth',$1::jsonb)`, [JSON.stringify({ reason: 'NO_ACCOUNT_OR_DELIVERY' })]); return { ok: true, delivery: 'RECOVERY_UNAVAILABLE' }; } const raw = this.token(); const expires = new Date(Date.now() + RECOVERY_TTL); await this.db.withTransaction(async (q) => { await q(`UPDATE "PasswordRecoveryToken" SET "replacedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "redeemedAt" IS NULL AND "replacedAt" IS NULL`, [account.rows[0]!.id]); await q(`INSERT INTO "PasswordRecoveryToken" ("userId","tokenHash","expiresAt") VALUES ($1,$2,$3)`, [account.rows[0]!.id, this.hash(raw), expires.toISOString()]); await this.audit(q, account.rows[0]!.id, 'auth.recovery.requested', account.rows[0]!.id); }); const delivery = await this.delivery.deliverRecovery(email, raw); if (!delivery.delivered) await this.repository.appendAuditEvent({ actorUserId: account.rows[0]!.id, action: 'auth.recovery.unavailable', entityType: 'Auth', entityId: account.rows[0]!.id, metadata: { reason: 'DELIVERY_NOT_CONFIGURED' } }); return { ok: true, delivery: delivery.delivered ? delivery.proofType ?? 'DELIVERED' : 'RECOVERY_UNAVAILABLE' }; }
  async redeemRecovery(token: unknown, password: unknown) { if (typeof token !== 'string' || typeof password !== 'string') throw new Error('RECOVERY_INVALID'); const passwordHash = this.auth.hashPassword(password); return this.db.withTransaction(async (q) => { const row = await q<{ id: string; userId: string; deliveryProvenAt: Date | null }>(`SELECT id,"userId","deliveryProvenAt" FROM "PasswordRecoveryToken" WHERE "tokenHash"=$1 AND "redeemedAt" IS NULL AND "replacedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP FOR UPDATE`, [this.hash(token)]); if (!row.rows[0]) throw new Error('RECOVERY_INVALID'); const consumed = await q(`UPDATE "PasswordRecoveryToken" SET "redeemedAt"=CURRENT_TIMESTAMP WHERE id=$1 AND "redeemedAt" IS NULL RETURNING id`, [row.rows[0].id]); if (!consumed.rowCount) throw new Error('RECOVERY_INVALID'); await q(`UPDATE "AuthIdentity" SET "credentialHash"=$1 WHERE "userId"=$2 AND provider='email'`, [passwordHash, row.rows[0].userId]); await q(`UPDATE "Session" SET "revokedAt"=CURRENT_TIMESTAMP,"recentOwnerReauthAt"=NULL WHERE "userId"=$1 AND "revokedAt" IS NULL`, [row.rows[0].userId]); if (row.rows[0].deliveryProvenAt) await q(`UPDATE "User" SET "emailOwnershipProvenAt"=CURRENT_TIMESTAMP,"emailOwnershipProofType"='RECOVERY_REDEMPTION' WHERE id=$1`, [row.rows[0].userId]); await this.audit(q, row.rows[0].userId, 'auth.recovery.redeemed', row.rows[0].id); return { ok: true }; }); }
  async reauth(actor: RequestUser, rawToken: string | undefined, password: string) { if (!rawToken || !(await this.authenticatedPassword(actor.id, password))) throw new Error('REAUTH_FAILED'); const when = new Date(); await this.repository.updateSessionRecentReauth(rawToken, when, actor.id); await this.repository.appendAuditEvent({ actorUserId: actor.id, action: 'auth.reauth.success', entityType: 'Session', metadata: {} }); return { ok: true, recentReauthAt: when.toISOString(), expiresAt: new Date(when.getTime() + REAUTH_TTL).toISOString() }; }
  private async authenticatedPassword(userId: string, password: string) { const credential = await this.repository.findCredentialByUserId(userId); return Boolean(credential && this.auth.verifyPassword(password, credential.credentialHash)); }
}
