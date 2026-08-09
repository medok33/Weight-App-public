export type CheckoutSessionRequest = {
  offerKey: string;
  returnUrl: string;
  idempotencyKey: string;
};

export function parseCheckoutSessionRequest(body: Record<string, unknown>): CheckoutSessionRequest {
  const keys = Object.keys(body ?? {});
  if (keys.some((key) => !['offerKey', 'returnUrl', 'idempotencyKey'].includes(key)) || typeof body?.offerKey !== 'string' || typeof body.returnUrl !== 'string' || typeof body.idempotencyKey !== 'string') throw new Error('CHECKOUT_REQUEST_INVALID');
  return { offerKey: body.offerKey, returnUrl: body.returnUrl, idempotencyKey: body.idempotencyKey };
}
