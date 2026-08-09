export type CheckoutSessionResponse = {
  id: string;
  offerKey: string;
  provider: 'checkout';
  status: 'pending';
  amountMinor: number;
  currency: string;
  confirmationUrl: string;
};
