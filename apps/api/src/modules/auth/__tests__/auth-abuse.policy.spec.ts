import { describe, expect, it } from 'vitest';
import {
  authAbuseHash,
  authAbuseHashSecret,
  blockedUntilToRetryAfterSeconds,
  normalizeAuthIdentifier,
  normalizeClientAddress,
  redisAuthAbuseKey,
} from '../domain/auth-abuse.policy';

describe('auth abuse policy', () => {
  it('normalizes identifiers and trusted client addresses before hashing', () => {
    expect(normalizeAuthIdentifier(' User@Example.COM ')).toBe('user@example.com');
    expect(normalizeClientAddress('203.0.113.10, 10.0.0.1')).toBe('203.0.113.10');
    expect(authAbuseHash('account:user@example.com', 'secret-a')).not.toContain('user@example.com');
    expect(authAbuseHash('account:user@example.com', 'secret-a')).toBe(
      authAbuseHash('account:user@example.com', 'secret-a'),
    );
  });

  it('requires an explicit hash secret outside local/test environments', () => {
    expect(() => authAbuseHashSecret({ APP_ENV: 'PRODUCTION' } as NodeJS.ProcessEnv)).toThrow(
      'AUTH_ABUSE_HASH_SECRET_REQUIRED',
    );
    expect(authAbuseHashSecret({ APP_ENV: 'LOCAL' } as NodeJS.ProcessEnv)).toBe('local-test-auth-abuse-secret');
  });

  it('calculates bounded retry-after seconds', () => {
    const now = new Date('2026-07-27T10:00:00.000Z');
    expect(blockedUntilToRetryAfterSeconds('2026-07-27T10:00:30.100Z', now)).toBe(31);
    expect(blockedUntilToRetryAfterSeconds('2026-07-27T09:59:00.000Z', now)).toBe(1);
  });

  it('builds Redis abuse keys from hashed subjects only', () => {
    const subjectHash = authAbuseHash('account:user@example.com', 'secret-a');
    const key = redisAuthAbuseKey('login', subjectHash);
    expect(key).toBe(`auth01b:abuse:login:${subjectHash}`);
    expect(key).not.toContain('user@example.com');
  });
});
