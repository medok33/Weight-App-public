import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertOutboundAllowlisted,
  encryptToken,
  decryptToken,
  validateOAuthState,
  verifyWebhookSignature,
} from '../domain/integrations.policy';

describe('integration adapter security STEP_186', () => {
  it('encrypts tokens without leaking plaintext round-trip helpers', () => {
    const cipher = encryptToken('raw-secret-token');
    expect(cipher).not.toContain('raw-secret-token');
    expect(decryptToken(cipher)).toBe('raw-secret-token');
  });

  it('validates oauth state, webhook signature, replay-safe host allowlist', () => {
    expect(validateOAuthState('abc', 'abc')).toBe(true);
    expect(() => validateOAuthState('abc', 'xyz')).toThrow('INTEGRATION_OAUTH_STATE_INVALID');
    const raw = '{"ok":true}';
    const secret = 'test-webhook-secret';
    const signature = createHash('sha256').update(`${secret}:${raw}`).digest('hex');
    expect(verifyWebhookSignature(raw, secret, signature)).toBe(true);
    expect(verifyWebhookSignature(raw, secret, 'bad')).toBe(false);
    expect(() => assertOutboundAllowlisted('https://evil.example/x', ['api.provider.test'])).toThrow(
      'INTEGRATION_OUTBOUND_BLOCKED',
    );
  });
});
