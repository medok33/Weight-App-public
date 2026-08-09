import { describe, expect, it } from 'vitest';
import { transitionPayment } from '../domain/payments.policy';

describe('payment state machine', () => {
  it('accepts pending to terminal and same-state retries', () => {
    expect(transitionPayment('pending', 'succeeded')).toBe('succeeded');
    expect(transitionPayment('succeeded', 'succeeded')).toBe('succeeded');
  });
  it('rejects terminal state changes', () => {
    expect(() => transitionPayment('succeeded', 'failed')).toThrow('PAYMENT_INVALID_TRANSITION');
    expect(() => transitionPayment('cancelled', 'pending')).toThrow('PAYMENT_INVALID_TRANSITION');
  });
});
