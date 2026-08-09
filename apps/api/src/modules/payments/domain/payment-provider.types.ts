import type { PaymentDraft, RefundDraft } from './payment-models.types';

export type PaymentProviderName = string;

export type CreatePaymentRequest = Pick<PaymentDraft, 'userId' | 'offerKey' | 'amountMinor' | 'currency'> & {
  returnUrl: string;
  idempotencyKey: string;
};

export type CreatePaymentResponse = {
  providerPaymentId: string;
  status: 'pending' | 'succeeded' | 'failed';
  confirmationUrl?: string;
};

export type ProviderWebhookEvent = {
  providerEventId: string;
  type: string;
  paymentId?: string;
  payload: Record<string, unknown>;
};

export type PaymentProvider = {
  readonly name: PaymentProviderName;
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse>;
  refund(request: RefundDraft & { idempotencyKey: string }): Promise<{ providerRefundId: string; status: 'pending' | 'succeeded' | 'failed' }>;
  verifyWebhook(rawBody: string, signature: string): ProviderWebhookEvent;
};

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
