export type RefundLifecycleStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'succeeded'
  | 'failed';

export type RefundRequestInput = {
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  idempotencyKey: string;
};

export type RefundDecisionInput = {
  refundId: string;
  decision: 'approve' | 'reject';
  decisionNote?: string;
};

export type RefundRecord = {
  id: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  status: RefundLifecycleStatus;
  reason: string | null;
  requestedByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  idempotencyKey: string | null;
};
