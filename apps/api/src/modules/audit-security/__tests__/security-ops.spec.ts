import { describe, expect, it } from 'vitest';
import {
  LOGIN_BRUTE_FORCE,
  assertWithinRateLimit,
  clearRateLimit,
  recordRateLimitFailure,
} from '../domain/rate-limit.policy';
import { validateAuditEventDraft } from '../domain/audit-event.policy';
import { csrfOriginAllowed } from '../infrastructure/security-headers.middleware';

describe('STEP_150 rate limits / brute-force', () => {
  it('blocks after max failures in window', () => {
    const buckets = new Map();
    for (let i = 0; i < LOGIN_BRUTE_FORCE.maxFailures; i += 1) {
      recordRateLimitFailure(buckets, 'ip::user', LOGIN_BRUTE_FORCE);
    }
    expect(() => assertWithinRateLimit(buckets, 'ip::user', LOGIN_BRUTE_FORCE)).toThrow('RATE_LIMITED');
    clearRateLimit(buckets, 'ip::user');
    expect(() => assertWithinRateLimit(buckets, 'ip::user', LOGIN_BRUTE_FORCE)).not.toThrow();
  });
});

describe('STEP_151 audit event', () => {
  it('validates append-only drafts', () => {
    expect(validateAuditEventDraft({ actorUserId: 'u1', action: 'export.job.created' }).action).toBe(
      'export.job.created',
    );
    expect(() => validateAuditEventDraft({ actorUserId: null, action: 'BAD' })).toThrow('AUDIT_EVENT_INVALID');
  });
});

describe('STEP_149 CSRF origin helper', () => {
  it('allows listed origins and rejects missing/foreign', () => {
    expect(csrfOriginAllowed('http://localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(csrfOriginAllowed('https://evil.test', ['http://localhost:3000'])).toBe(false);
    expect(csrfOriginAllowed(undefined, ['http://localhost:3000'])).toBe(false);
  });
});
