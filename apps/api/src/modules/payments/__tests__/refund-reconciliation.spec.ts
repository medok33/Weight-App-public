import { describe, expect, it } from 'vitest';
import {
  applyRefundDecision,
  assertPaymentRefundable,
  validateRefundDecision,
  validateRefundRequest,
} from '../domain/refund.policy';
import { decideReconciliation } from '../domain/reconciliation.policy';

describe('STEP_137 refund request/admin decision', () => {
  it('accepts a valid refund request', () => {
    expect(
      validateRefundRequest({
        paymentId: '11111111-1111-4111-8111-111111111111',
        amountMinor: 1000,
        currency: 'RUB',
        reason: 'Accidental purchase',
        idempotencyKey: 'refund-key-01',
      }).amountMinor,
    ).toBe(1000);
  });

  it('rejects invalid refund request before persistence', () => {
    expect(() =>
      validateRefundRequest({
        paymentId: 'bad',
        amountMinor: 0,
        currency: 'RUB',
        reason: '',
        idempotencyKey: 'x',
      }),
    ).toThrow('REFUND_REQUEST_INVALID');
  });

  it('blocks refund for another user or unsettled payment', () => {
    expect(() => assertPaymentRefundable('succeeded', 'u1', 'u2')).toThrow('REFUND_FORBIDDEN');
    expect(() => assertPaymentRefundable('pending', 'u1', 'u1')).toThrow('REFUND_PAYMENT_NOT_SETTLED');
  });

  it('applies owner approve/reject transitions', () => {
    expect(applyRefundDecision('requested', 'approve')).toBe('approved');
    expect(applyRefundDecision('requested', 'reject')).toBe('rejected');
    expect(() => applyRefundDecision('succeeded', 'reject')).toThrow('REFUND_INVALID_TRANSITION');
    expect(validateRefundDecision({ refundId: '11111111-1111-4111-8111-111111111111', decision: 'approve' }).decision).toBe(
      'approve',
    );
  });
});

describe('STEP_139 reconciliation policy', () => {
  it('marks only stale pending payments', () => {
    expect(decideReconciliation({ paymentId: 'p1', status: 'pending', ageMinutes: 90 }, 60).action).toBe('mark_failed');
    expect(decideReconciliation({ paymentId: 'p2', status: 'pending', ageMinutes: 5 }, 60).action).toBe('noop');
    expect(decideReconciliation({ paymentId: 'p3', status: 'succeeded', ageMinutes: 999 }, 60).action).toBe('noop');
  });
});
