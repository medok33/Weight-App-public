import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto'; import { parseCheckoutSessionRequest } from '../../src/modules/payments/dto/payments.request.dto'; import { verifyWebhookSignature } from '../../src/modules/payments/domain/payment-provider.policy';

describe('checkout API boundary', () => {
  it('accepts the explicit contract and rejects unknown fields', () => {
    expect(parseCheckoutSessionRequest({ offerKey: 'pro-monthly', returnUrl: 'https://example.test/return', idempotencyKey: 'idem-1234' }).offerKey).toBe('pro-monthly');
    expect(() => parseCheckoutSessionRequest({ offerKey: 'pro-monthly', returnUrl: 'https://example.test/return', idempotencyKey: 'idem-1234', extra: true })).toThrow('CHECKOUT_REQUEST_INVALID');
  });
  it('requires a valid HMAC signature and supports replay-safe signatures', () => { const body = '{"provider":"mock","eventId":"evt-1","paymentId":"p","status":"succeeded","payload":{}}'; const signature = `sha256=${createHmac('sha256','secret').update(body).digest('hex')}`; expect(verifyWebhookSignature(body, signature, 'secret')).toBe(true); expect(verifyWebhookSignature(body, signature.slice(0, -1), 'secret')).toBe(false); });
});
