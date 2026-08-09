import { createHmac } from 'node:crypto';

export const AUTH_ABUSE_POLICY = {
  loginWindowSeconds: 15 * 60,
  loginAccountMaxFailures: 5,
  loginAccountIpMaxFailures: 8,
  loginIpMaxFailures: 20,
  loginLockoutSeconds: 10 * 60,
  registerWindowSeconds: 60 * 60,
  registerIpMaxFailures: 50,
  registerAccountMaxFailures: 3,
  mfaWindowSeconds: 10 * 60,
  mfaChallengeMaxFailures: 5,
  mfaAccountMaxFailures: 8,
  mfaIpMaxFailures: 30,
  mfaAccountIpMaxFailures: 10,
  mfaBlockSeconds: 10 * 60,
  highRiskFailureCount: 4,
} as const;

export type AuthThrottleAction = 'login' | 'register' | 'password_reset' | 'mfa_challenge';
export type AuthThrottleSubjectType = 'account' | 'ip' | 'account_ip' | 'challenge';
export type AuthHighRiskAction = 'login' | 'register' | 'password_reset' | 'recovery_redeem' | 'reauth' | 'beta_invite';

export type AuthBlockDecision = {
  blocked: boolean;
  retryAfterSeconds?: number;
  reason?: 'account_lockout' | 'account_throttle' | 'ip_throttle' | 'account_ip_throttle' | 'challenge_throttle';
};

export class AuthAbuseBlockedError extends Error {
  readonly retryAfterSeconds: number;
  readonly reason: NonNullable<AuthBlockDecision['reason']>;

  constructor(reason: NonNullable<AuthBlockDecision['reason']>, retryAfterSeconds: number) {
    super('AUTH_TEMPORARILY_BLOCKED');
    this.reason = reason;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export class AuthAbuseGuardUnavailableError extends Error {
  constructor() {
    super('AUTH_ABUSE_GUARD_UNAVAILABLE');
  }
}

export function normalizeAuthIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function normalizeClientAddress(ip?: string): string {
  const raw = String(ip ?? '').split(',')[0]?.trim() ?? '';
  return raw || 'unknown';
}

export function authAbuseHash(value: string, secret = authAbuseHashSecret()): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function authAbuseHashSecret(source: NodeJS.ProcessEnv = process.env): string {
  const explicit = source.AUTH_ABUSE_HASH_SECRET?.trim();
  if (explicit) return explicit;

  const env = String(source.APP_ENV ?? source.NODE_ENV ?? 'LOCAL').trim().toUpperCase();
  if (env === 'STAGING' || env === 'PRODUCTION') {
    throw new Error('AUTH_ABUSE_HASH_SECRET_REQUIRED');
  }
  return 'local-test-auth-abuse-secret';
}

export function blockedUntilToRetryAfterSeconds(blockedUntil: Date | string, now = new Date()): number {
  const untilMs = blockedUntil instanceof Date ? blockedUntil.getTime() : new Date(blockedUntil).getTime();
  return Math.max(1, Math.ceil((untilMs - now.getTime()) / 1000));
}

export function redisAuthAbuseKey(action: AuthHighRiskAction, subjectHash: string): string {
  return `auth01b:abuse:${action}:${subjectHash}`;
}
