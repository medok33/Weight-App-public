export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = { pending: ['pending', 'succeeded', 'failed', 'cancelled'], succeeded: ['succeeded'], failed: ['failed'], cancelled: ['cancelled'] };
export type RefundStatus = 'pending' | 'succeeded' | 'failed';

export type PaymentDraft = {
  userId: string;
  provider: string;
  providerPaymentId?: string;
  offerKey?: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  metadata: Record<string, unknown>;
};

export type RefundDraft = {
  paymentId: string;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  reason?: string;
  providerRefundId?: string;
  metadata: Record<string, unknown>;
};
