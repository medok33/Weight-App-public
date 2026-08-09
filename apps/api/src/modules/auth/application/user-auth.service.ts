import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRepository } from '../infrastructure/auth.repository';
import { SESSION_POLICY } from '../domain/auth.policy';
import {
  buildSessionCookie,
  clearLegacyOwnerSessionCookie,
  clearLegacyUserSessionCookie,
  clearSessionCookie,
} from '../domain/session-cookie';
import {
  AuthAbuseBlockedError,
  authAbuseHash,
  normalizeAuthIdentifier,
  normalizeClientAddress,
} from '../domain/auth-abuse.policy';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  loadMfaEncryptionKey,
  OWNER_MFA_POLICY,
  provisioningUri,
  recoveryCodeHash,
  verifyTotpCode,
} from '../domain/owner-mfa.crypto';
import { hasAdminAuthority } from '../domain/account-role.policy';
import type { RequestUser } from '../domain/request-user.types';
import { normalizeIdentityEmail } from '../domain/identity-normalizer';

@Injectable()
export class UserAuthService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
  ) {
    loadMfaEncryptionKey();
  }

  async register(email: string, password: string, anonymousUserId?: string, ip?: string) {
    const normalizedEmail = normalizeIdentityEmail(email);
    const accountHash = authAbuseHash(`account:${normalizedEmail}`);
    const ipHash = authAbuseHash(`ip:${normalizeClientAddress(ip)}`);
    const registrationBlock = await this.repository.recordRegistrationAttempt({ accountHash, ipHash });
    if (registrationBlock.blocked) {
      throw new AuthAbuseBlockedError(registrationBlock.reason ?? 'account_throttle', registrationBlock.retryAfterSeconds ?? 1);
    }
    if (await this.repository.findUserByEmail(normalizedEmail)) throw new Error('EMAIL_ALREADY_EXISTS');
    // Clients cannot self-assign OWNER/ADMIN via register body — role is always USER.
    const passwordHash = this.auth.hashPassword(password);
    const userId = await this.repository.createRegisteredUser(normalizedEmail, passwordHash);
    await this.maybeMigrate(anonymousUserId, userId);

    const session = await this.repository.createSession(userId, 'USER');
    return {
      user: await this.repository.getUserById(userId),
      cookies: [buildSessionCookie(session.rawToken, SESSION_POLICY.ttlSeconds)],
    };
  }

  async login(identifier: string, password: string, anonymousUserId?: string, ip?: string) {
    const normalizedIdentifier = normalizeAuthIdentifier(identifier);
    const normalizedIp = normalizeClientAddress(ip);
    const accountHash = authAbuseHash(`account:${normalizedIdentifier}`);
    const ipHash = authAbuseHash(`ip:${normalizedIp}`);
    const accountIpHash = authAbuseHash(`account_ip:${normalizedIdentifier}:${normalizedIp}`);

    const existingBlock = await this.repository.evaluateAuthBlock({ accountHash, ipHash, accountIpHash });
    if (existingBlock.blocked) {
      throw new AuthAbuseBlockedError(existingBlock.reason ?? 'account_throttle', existingBlock.retryAfterSeconds ?? 1);
    }

    const credential = await this.repository.findCredential(identifier);
    if (!credential || !this.auth.verifyPassword(password, credential.credentialHash)) {
      const block = await this.repository.recordLoginFailure({
        accountHash,
        ipHash,
        accountIpHash,
        userId: credential?.userId ?? null,
      });
      if (block.blocked) throw new AuthAbuseBlockedError(block.reason ?? 'account_throttle', block.retryAfterSeconds ?? 1);
      throw new Error('INVALID_CREDENTIALS');
    }
    if (String(credential.status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      const block = await this.repository.recordLoginFailure({
        accountHash,
        ipHash,
        accountIpHash,
        userId: credential.userId,
      });
      if (block.blocked) throw new AuthAbuseBlockedError(block.reason ?? 'account_throttle', block.retryAfterSeconds ?? 1);
      throw new Error('INVALID_CREDENTIALS');
    }

    await this.repository.clearSuccessfulLogin({ accountHash, accountIpHash, userId: credential.userId });

    const role = await this.repository.getAccountRole(credential.userId);
    if (hasAdminAuthority(role)) {
      await this.repository.setSubscriptionTier(credential.userId, 'PREMIUM');
    } else {
      await this.repository.ensureFreeSubscription(credential.userId);
    }
    await this.maybeMigrate(anonymousUserId, credential.userId);

    // Product policy: OWNER password login creates a full session immediately.
    // TOTP/QR MFA must not block login. Critical actions use recent password reauth only.
    const session = await this.repository.createSession(credential.userId, role);
    if (role === 'OWNER') {
      await this.repository.appendAuditEvent({
        actorUserId: credential.userId,
        action: 'auth.owner.login.completed',
        entityType: 'User',
        entityId: credential.userId,
        metadata: { mfaRequired: false },
      });
    }
    return {
      user: await this.repository.getUserById(credential.userId),
      cookies: [buildSessionCookie(session.rawToken, SESSION_POLICY.ttlSeconds)],
    };
  }

  async verifyOwnerMfaChallenge(challengeId: string, code: string, ip?: string) {
    const challengeHash = this.repository.hashToken(challengeId);
    const normalizedIp = normalizeClientAddress(ip);
    const challenge = await this.repository.consumeMfaPreAuthChallenge(challengeId);
    if (!challenge) throw new Error('MFA_CHALLENGE_EXPIRED');

    const block = await this.repository.evaluateMfaBlock({
      challengeHash,
      accountHash: challenge.accountHash,
      ipHash: authAbuseHash(`ip:${normalizedIp}`),
      accountIpHash: challenge.accountIpHash,
    });
    if (block.blocked) throw new AuthAbuseBlockedError(block.reason ?? 'challenge_throttle', block.retryAfterSeconds ?? 1);

    const credential = await this.repository.getActiveOwnerMfaCredential(challenge.userId);
    if (!credential) throw new Error('MFA_ENROLLMENT_REQUIRED');
    const verified = await this.verifyMfaCode(challenge.userId, credential, code);
    if (!verified) {
      const failure = await this.repository.recordMfaFailure({
        challengeHash,
        accountHash: challenge.accountHash,
        ipHash: authAbuseHash(`ip:${normalizedIp}`),
        accountIpHash: challenge.accountIpHash,
        userId: challenge.userId,
      });
      if (failure.blocked) throw new AuthAbuseBlockedError(failure.reason ?? 'challenge_throttle', failure.retryAfterSeconds ?? 1);
      throw new Error('MFA_INVALID_CODE');
    }
    await this.repository.clearSuccessfulMfa({ challengeHash, accountHash: challenge.accountHash, accountIpHash: challenge.accountIpHash });
    const verifiedAt = new Date();
    const session = await this.repository.createSession(challenge.userId, 'OWNER', verifiedAt);
    await this.repository.appendAuditEvent({
      actorUserId: challenge.userId,
      action: verified === 'recovery' ? 'auth.owner.mfa.recovery_code_used' : 'auth.owner.mfa.verified',
      entityType: 'User',
      entityId: challenge.userId,
      metadata: { method: verified },
    });
    return {
      user: await this.repository.getUserById(challenge.userId),
      cookies: [buildSessionCookie(session.rawToken, SESSION_POLICY.ttlSeconds)],
    };
  }

  async startOwnerMfaEnrollment(user: RequestUser, password: string) {
    this.assertOwnerSession(user);
    await this.assertPassword(user.id, password);
    const secret = generateTotpSecret();
    const encryptedSecret = encryptMfaSecret(secret);
    const draftId = await this.repository.createOwnerMfaEnrollmentDraft(
      user.id,
      encryptedSecret,
      new Date(Date.now() + OWNER_MFA_POLICY.enrollmentTtlSeconds * 1000),
    );
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.owner.mfa.enrollment_started',
      entityType: 'User',
      entityId: user.id,
      metadata: { draftId },
    });
    const accountName = user.username ?? user.email ?? user.id;
    return {
      enrollmentId: draftId,
      secret,
      provisioningUri: provisioningUri({ issuer: 'Weight App', accountName, secret }),
      expiresAt: new Date(Date.now() + OWNER_MFA_POLICY.enrollmentTtlSeconds * 1000).toISOString(),
    };
  }

  async confirmOwnerMfaEnrollment(
    user: RequestUser,
    enrollmentId: string,
    code: string,
    rawToken?: string,
  ) {
    this.assertOwnerSession(user);
    const recoveryCodes = generateRecoveryCodes();
    const codeHashes = recoveryCodes.map((value) => recoveryCodeHash(user.id, value));
    const draftSecret = await this.peekEnrollmentSecret(user.id, enrollmentId);
    const result = verifyTotpCode(draftSecret, code);
    if (!result.valid) throw new Error('MFA_INVALID_CODE');
    const confirmed = await this.repository.confirmOwnerMfaEnrollmentDraft({
      draftId: enrollmentId,
      userId: user.id,
      recoveryCodeHashes: codeHashes,
    });
    if (!confirmed) throw new Error('MFA_CHALLENGE_EXPIRED');
    if (!rawToken) throw new Error('SESSION_REQUIRED');
    const verifiedAt = new Date();
    await this.repository.markSessionMfaVerified(rawToken, verifiedAt);
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.owner.mfa.enrollment_completed',
      entityType: 'User',
      entityId: user.id,
      metadata: { credentialId: confirmed.credentialId, recoveryCodeCount: recoveryCodes.length },
    });
    return { recoveryCodes, mfaVerifiedAt: verifiedAt.toISOString() };
  }

  async cancelOwnerMfaEnrollment(user: RequestUser, enrollmentId: string) {
    this.assertOwnerSession(user);
    const cancelled = await this.repository.cancelOwnerMfaEnrollmentDraft(user.id, enrollmentId);
    if (cancelled) {
      await this.repository.appendAuditEvent({
        actorUserId: user.id,
        action: 'auth.owner.mfa.enrollment_cancelled',
        entityType: 'User',
        entityId: user.id,
        metadata: { enrollmentId },
      });
    }
    return { ok: cancelled };
  }

  async recentOwnerReauth(user: RequestUser, rawToken: string | undefined, password: string) {
    this.assertOwnerSession(user);
    if (!rawToken) throw new Error('REAUTH_FAILED');
    await this.assertPassword(user.id, password);
    const when = new Date();
    await this.repository.updateSessionRecentReauth(rawToken, when, user.id);
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.owner.reauthenticated',
      entityType: 'User',
      entityId: user.id,
      metadata: { method: 'password', maxAgeSeconds: OWNER_MFA_POLICY.recentReauthMaxAgeSeconds },
    });
    return {
      ok: true,
      recentReauthAt: when.toISOString(),
      expiresAt: new Date(when.getTime() + OWNER_MFA_POLICY.recentReauthMaxAgeSeconds * 1000).toISOString(),
    };
  }

  async regenerateRecoveryCodes(user: RequestUser) {
    this.assertOwnerMfaSession(user);
    const credential = await this.repository.getActiveOwnerMfaCredential(user.id);
    if (!credential) throw new Error('MFA_ENROLLMENT_REQUIRED');
    const codes = generateRecoveryCodes();
    await this.repository.replaceRecoveryCodes(user.id, credential.id, codes.map((code) => recoveryCodeHash(user.id, code)));
    await this.repository.appendAuditEvent({
      actorUserId: user.id,
      action: 'auth.owner.mfa.recovery_codes_regenerated',
      entityType: 'User',
      entityId: user.id,
      metadata: { recoveryCodeCount: codes.length },
    });
    return { recoveryCodes: codes };
  }

  async logout(rawToken?: string) {
    if (rawToken) await this.repository.revokeSession(rawToken);
    return {
      cookies: [clearSessionCookie(), clearLegacyUserSessionCookie(), clearLegacyOwnerSessionCookie()],
    };
  }

  async me(userId: string, roleFromSession?: string) {
    const user = await this.repository.getUserById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    const subscription = await this.repository.getSubscription(userId);
    return {
      ...user,
      role: roleFromSession ?? user.role,
      tier: subscription?.tier ?? 'FREE',
      status: 'ACTIVE',
    };
  }

  private async maybeMigrate(anonymousUserId: string | undefined, targetUserId: string) {
    if (!anonymousUserId || anonymousUserId === targetUserId) return;
    await this.repository.migrateAnonymousData(anonymousUserId, targetUserId);
  }

  private async assertPassword(userId: string, password: string) {
    const credential = await this.repository.findCredentialByUserId(userId);
    if (!credential || !this.auth.verifyPassword(password, credential.credentialHash)) throw new Error('REAUTH_FAILED');
  }

  private async verifyMfaCode(
    userId: string,
    credential: { id: string; encryptedSecret: unknown },
    code: string,
  ): Promise<'totp' | 'recovery' | false> {
    const secret = decryptMfaSecret(credential.encryptedSecret);
    const totp = verifyTotpCode(secret, code);
    if (totp.valid) {
      const fresh = await this.repository.recordTotpReplayStep(userId, totp.timeStep);
      return fresh ? 'totp' : false;
    }
    const consumed = await this.repository.consumeRecoveryCode(userId, credential.id, recoveryCodeHash(userId, code));
    return consumed ? 'recovery' : false;
  }

  private assertOwnerSession(user: RequestUser) {
    if (String(user.role).toUpperCase() !== 'OWNER') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  private assertOwnerMfaSession(user: RequestUser) {
    this.assertOwnerSession(user);
    if (!user.mfaVerifiedAt) throw new Error('MFA_REQUIRED');
  }

  private async peekEnrollmentSecret(userId: string, enrollmentId: string): Promise<string> {
    const encryptedSecret = await this.repository.getOwnerMfaEnrollmentDraftSecret(userId, enrollmentId);
    if (!encryptedSecret) throw new Error('MFA_CHALLENGE_EXPIRED');
    return decryptMfaSecret(encryptedSecret);
  }
}
