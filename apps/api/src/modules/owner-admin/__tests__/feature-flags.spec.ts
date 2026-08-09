import { describe, expect, it } from 'vitest';
import {
  CLOSED_BETA_FLAG_KEY,
  assertClosedBetaFlagKey,
  isClosedBetaEnabled,
  validateFeatureFlagKey,
} from '../domain/owner-admin.policy';

describe('feature flags', () => {
  it('normalizes valid keys and rejects unsafe keys', () => {
    expect(validateFeatureFlagKey(' new-dashboard ')).toBe('new-dashboard');
    expect(() => validateFeatureFlagKey('BAD KEY')).toThrow('FEATURE_FLAG_KEY_INVALID');
  });

  it('STEP_168 closed_beta flag helpers', () => {
    expect(assertClosedBetaFlagKey(CLOSED_BETA_FLAG_KEY)).toBe('closed_beta');
    expect(() => assertClosedBetaFlagKey('other_flag')).toThrow('CLOSED_BETA_FLAG_KEY_INVALID');
    expect(isClosedBetaEnabled([{ key: 'closed_beta', enabled: true }])).toBe(true);
    expect(isClosedBetaEnabled([{ key: 'closed_beta', enabled: false }])).toBe(false);
    expect(isClosedBetaEnabled([])).toBe(false);
  });
});
