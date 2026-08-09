export type CheckoutSessionRequest = { offerKey: string; returnUrl: string; idempotencyKey: string };
export type CheckoutSessionResponse = { id: string; offerKey: string; provider: 'checkout'; status: 'pending'; amountMinor: number; currency: string; confirmationUrl: string };
export type PaymentWebhookEvent = { provider: string; eventId: string; paymentId: string; status: 'pending' | 'succeeded' | 'failed' | 'cancelled'; payload: Record<string, unknown> };
export type PaymentWebhookResponse = { accepted: true; duplicate: boolean };
