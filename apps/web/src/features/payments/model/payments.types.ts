export type ProductOffer = {
  key: string;
  name: string;
  amountMinor: number;
  currency: string;
  interval: string;
  active: boolean;
};

export type PaymentView = {
  id: string;
  offerKey: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  amountMinor: number;
  currency: string;
  outcome: 'success' | 'failure' | 'pending';
};

export type CheckoutSession = {
  id: string;
  offerKey: string;
  status: 'pending';
  confirmationUrl: string;
  amountMinor: number;
  currency: string;
};
