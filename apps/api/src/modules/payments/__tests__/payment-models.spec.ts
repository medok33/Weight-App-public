import { describe, expect, it } from 'vitest';
import { validatePayment, validateRefund } from '../domain/payment-models.policy';

describe('payment models policy', () => {
  it('accepts valid payment and refund drafts', () => {
    expect(validatePayment({ userId: 'u', provider: 'mock', status: 'pending', amountMinor: 9900, currency: 'RUB', metadata: {} }).status).toBe('pending');
    expect(validateRefund({ paymentId: 'p', amountMinor: 100, currency: 'RUB', status: 'pending', metadata: {} }).amountMinor).toBe(100);
  });
  it('rejects invalid money and currencies', () => {
    expect(() => validatePayment({ userId: 'u', provider: 'mock', status: 'pending', amountMinor: -1, currency: 'GBP', metadata: {} })).toThrow('PAYMENT_INVALID');
    expect(() => validateRefund({ paymentId: 'p', amountMinor: 0, currency: 'RUB', status: 'pending', metadata: {} })).toThrow('REFUND_INVALID');
  });
});
