import { describe, expect, it } from 'vitest';
import { maskSupportUser, requireMfa } from '../domain/owner-admin.policy';

describe('owner controls', () => {
  it('does not require TOTP MFA and masks support identity', () => {
    expect(requireMfa('OWNER', false)).toBe(true);
    expect(requireMfa('OWNER', true)).toBe(true);
    expect(maskSupportUser('owner@example.com')).toBe('ow***@example.com');
  });
});
