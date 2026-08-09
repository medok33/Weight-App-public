import { describe, expect, it } from 'vitest';
import { isPasswordAcceptable } from '../domain/auth.policy';

describe('auth policy', () => {
  it('accepts strong passwords', () => {
    expect(isPasswordAcceptable('Password12345')).toBe(true);
  });

  it('rejects weak passwords', () => {
    expect(isPasswordAcceptable('short')).toBe(false);
  });
});
