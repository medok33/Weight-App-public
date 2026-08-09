import type { RefundDecisionInput, RefundLifecycleStatus, RefundRequestInput } from './refund.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCIES = new Set(['RUB', 'USD', 'EUR']);

export const REFUND_DECISION_TRANSITIONS: Readonly<
  Record<'approve' | 'reject', Readonly<Record<RefundLifecycleStatus, RefundLifecycleStatus | null>>>
> = {
  approve: {
    requested: 'approved',
    approved: 'approved',
    rejected: null,
    pending: 'pending',
    succeeded: 'succeeded',
    failed: null,
  },
  reject: {
    requested: 'rejected',
    approved: null,
    rejected: 'rejected',
    pending: null,
    succeeded: null,
    failed: 'failed',
  },
};

export function validateRefundRequest(input: RefundRequestInput): RefundRequestInput {
  if (!UUID.test(input.paymentId)) throw new Error('REFUND_REQUEST_INVALID');
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('REFUND_REQUEST_INVALID');
  if (!CURRENCIES.has(input.currency)) throw new Error('REFUND_REQUEST_INVALID');
  if (!input.reason?.trim() || input.reason.trim().length > 500) throw new Error('REFUND_REQUEST_INVALID');
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new Error('REFUND_REQUEST_INVALID');
  return {
    paymentId: input.paymentId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    reason: input.reason.trim(),
    idempotencyKey: input.idempotencyKey,
  };
}

export function validateRefundDecision(input: RefundDecisionInput): RefundDecisionInput {
  if (!UUID.test(input.refundId)) throw new Error('REFUND_DECISION_INVALID');
  if (input.decision !== 'approve' && input.decision !== 'reject') throw new Error('REFUND_DECISION_INVALID');
  if (input.decisionNote && input.decisionNote.length > 500) throw new Error('REFUND_DECISION_INVALID');
  return {
    refundId: input.refundId,
    decision: input.decision,
    decisionNote: input.decisionNote?.trim() || undefined,
  };
}

export function assertPaymentRefundable(status: string, paymentUserId: string, actorUserId: string) {
  if (paymentUserId !== actorUserId) throw new Error('REFUND_FORBIDDEN');
  if (status !== 'succeeded') throw new Error('REFUND_PAYMENT_NOT_SETTLED');
}

export function applyRefundDecision(
  current: RefundLifecycleStatus,
  decision: 'approve' | 'reject',
): RefundLifecycleStatus {
  const next = REFUND_DECISION_TRANSITIONS[decision][current];
  if (!next) throw new Error('REFUND_INVALID_TRANSITION');
  return next;
}
