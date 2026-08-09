import { describe, expect, it } from 'vitest';
import { normalizeIdentityEmail } from '../domain/identity-normalizer';

describe('AUTH-01A identity boundary', () => {
  it('uses one deterministic normalization for whitespace and case', () => {
    expect(normalizeIdentityEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(normalizeIdentityEmail('user@example.com')).toBe('user@example.com');
  });

  it('does not apply provider-specific Gmail rewriting', () => {
    expect(normalizeIdentityEmail('first.last+beta@gmail.com')).toBe('first.last+beta@gmail.com');
  });

  it('rejects malformed and non-string identity input', () => {
    expect(() => normalizeIdentityEmail('not-an-email')).toThrow('EMAIL_INVALID');
    expect(() => normalizeIdentityEmail({ email: 'x@y.test' })).toThrow('EMAIL_REQUIRED');
  });
});
