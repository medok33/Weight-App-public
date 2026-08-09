import type { PaymentDraft, RefundDraft } from './payment-models.types';

const currencies = new Set(['RUB', 'USD', 'EUR']);
export function validatePayment(input: PaymentDraft): PaymentDraft {
  if (!input.userId || !input.provider || !Number.isInteger(input.amountMinor) || input.amountMinor < 0 || !currencies.has(input.currency) || !input.status) throw new Error('PAYMENT_INVALID');
  return { ...input, metadata: input.metadata ?? {} };
}
export function validateRefund(input: RefundDraft): RefundDraft {
  if (!input.paymentId || !Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || !currencies.has(input.currency) || !input.status) throw new Error('REFUND_INVALID');
  return { ...input, metadata: input.metadata ?? {} };
}
