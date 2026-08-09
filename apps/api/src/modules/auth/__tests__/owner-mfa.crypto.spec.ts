import { describe, expect, it } from 'vitest';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  loadMfaEncryptionKey,
  recoveryCodeHash,
  verifyTotpCode,
} from '../domain/owner-mfa.crypto';

describe('OWNER MFA crypto', () => {
  const key = Buffer.alloc(32, 7);

  it('encrypts TOTP secrets at rest with authenticated envelopes', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, key);
    expect(JSON.stringify(encrypted)).not.toContain(secret);
    expect(encrypted).toMatchObject({ v: 1, alg: 'AES-256-GCM' });
    expect(decryptMfaSecret(encrypted, key)).toBe(secret);
    expect(() => decryptMfaSecret({ ...encrypted, tag: 'bad' }, key)).toThrow();
  });

  it('fails closed without a valid production encryption key', () => {
    expect(() => loadMfaEncryptionKey({ APP_ENV: 'PRODUCTION' } as NodeJS.ProcessEnv)).toThrow(
      'AUTH_MFA_ENCRYPTION_KEY_REQUIRED',
    );
    expect(() => loadMfaEncryptionKey({ APP_ENV: 'STAGING' } as NodeJS.ProcessEnv)).toThrow(
      'AUTH_MFA_ENCRYPTION_KEY_REQUIRED',
    );
    expect(() =>
      loadMfaEncryptionKey({ APP_ENV: 'PRODUCTION', AUTH_MFA_ENCRYPTION_KEY: 'abcd' } as NodeJS.ProcessEnv),
    ).toThrow('AUTH_MFA_ENCRYPTION_KEY_INVALID');
    expect(() =>
      loadMfaEncryptionKey({ APP_ENV: 'STAGING', AUTH_MFA_ENCRYPTION_KEY: 'abcd' } as NodeJS.ProcessEnv),
    ).toThrow('AUTH_MFA_ENCRYPTION_KEY_INVALID');
    expect(loadMfaEncryptionKey({ APP_ENV: 'TEST' } as NodeJS.ProcessEnv)).toHaveLength(32);
    expect(loadMfaEncryptionKey({ APP_ENV: 'LOCAL' } as NodeJS.ProcessEnv)).toHaveLength(32);
  });

  it('rejects TOTP outside the narrow ±1 step skew window', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 59_000;
    expect(verifyTotpCode(secret, '287082', now)).toEqual({ valid: true, timeStep: 1n });
    expect(verifyTotpCode(secret, '000000', now)).toEqual({ valid: false });
    expect(verifyTotpCode(secret, '287082', now + 90_000).valid).toBe(false);
  });

  it('hashes recovery codes and never requires storing raw codes', () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const hash = recoveryCodeHash('user-1', code);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(code);
    expect(recoveryCodeHash('user-1', code.toLowerCase())).toBe(hash);
  });
});
