import type { CheckoutSession, PaymentView, ProductOffer } from '../model/payments.types';

export async function getOffers() {
  const r = await fetch('/api/payments/offers', { cache: 'no-store' });
  if (!r.ok) throw new Error('OFFERS_FAILED');
  return r.json() as Promise<ProductOffer[]>;
}

export async function startCheckout(offerKey: string, returnUrl: string, idempotencyKey: string) {
  const r = await fetch('/api/payments/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offerKey, returnUrl, idempotencyKey }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('CHECKOUT_FAILED');
  return r.json() as Promise<CheckoutSession>;
}

export async function getPayment(paymentId: string) {
  const r = await fetch(`/api/payments/status/${encodeURIComponent(paymentId)}`, { cache: 'no-store' });
  if (r.status === 401 || r.status === 403) throw new Error('PAYMENT_FORBIDDEN');
  if (r.status === 404) throw new Error('PAYMENT_NOT_FOUND');
  if (!r.ok) throw new Error('PAYMENT_FAILED');
  return r.json() as Promise<PaymentView>;
}
