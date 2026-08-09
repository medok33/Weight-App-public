import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreatePaymentRequest, PaymentProviderName } from './payment-provider.types';

export function validateProviderName(name: string): PaymentProviderName {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) throw new Error('PAYMENT_PROVIDER_UNSUPPORTED');
  return name;
}
export function validateCreatePaymentRequest(request: CreatePaymentRequest): CreatePaymentRequest {
  if (!request.userId || !request.idempotencyKey || !request.returnUrl.startsWith('https://') || !Number.isInteger(request.amountMinor) || request.amountMinor <= 0 || !request.currency) throw new Error('PAYMENT_PROVIDER_REQUEST_INVALID');
  return request;
}

export function validateCheckoutInput(input: { offerKey: string; returnUrl: string; idempotencyKey: string }) {
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(input.offerKey) || !/^https:\/\//.test(input.returnUrl) || input.returnUrl.length > 2048 || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new Error('CHECKOUT_REQUEST_INVALID');
  return input;
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actual = Buffer.from(signature ?? ''); const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function validateWebhookEvent(input: Record<string, unknown>) {
  const keys = Object.keys(input ?? {});
  if (keys.some((key) => !['provider', 'eventId', 'paymentId', 'status', 'payload'].includes(key)) || typeof input?.provider !== 'string' || typeof input.eventId !== 'string' || typeof input.paymentId !== 'string' || !['pending', 'succeeded', 'failed', 'cancelled'].includes(String(input.status)) || !input.payload || typeof input.payload !== 'object') throw new Error('WEBHOOK_EVENT_INVALID');
  return { provider: input.provider, eventId: input.eventId, paymentId: input.paymentId, status: input.status as 'pending' | 'succeeded' | 'failed' | 'cancelled', payload: input.payload as Record<string, unknown> };
}
