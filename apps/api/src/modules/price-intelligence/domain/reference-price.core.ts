import { createHash } from 'node:crypto';

export const PRICE_CONDITIONS = ['REGULAR', 'PROMOTIONAL', 'LOYALTY_ONLY', 'CONDITIONAL', 'UNKNOWN_CONDITION'] as const;
export type PriceCondition = (typeof PRICE_CONDITIONS)[number];
export type NormalizedUnit = 'GRAM' | 'MILLILITER' | 'PIECE';
export type FreshnessStatus = 'CURRENT' | 'STALE' | 'UNKNOWN' | 'APPROXIMATE';

export const DEFAULT_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const UNIT_FACTORS: Record<string, { unit: NormalizedUnit; factor: number }> = {
  g: { unit: 'GRAM', factor: 1 }, gram: { unit: 'GRAM', factor: 1 }, grams: { unit: 'GRAM', factor: 1 },
  kg: { unit: 'GRAM', factor: 1000 }, kilogram: { unit: 'GRAM', factor: 1000 }, kilograms: { unit: 'GRAM', factor: 1000 },
  ml: { unit: 'MILLILITER', factor: 1 }, milliliter: { unit: 'MILLILITER', factor: 1 }, milliliters: { unit: 'MILLILITER', factor: 1 },
  l: { unit: 'MILLILITER', factor: 1000 }, liter: { unit: 'MILLILITER', factor: 1000 }, liters: { unit: 'MILLILITER', factor: 1000 },
  pcs: { unit: 'PIECE', factor: 1 }, piece: { unit: 'PIECE', factor: 1 }, pieces: { unit: 'PIECE', factor: 1 }, шт: { unit: 'PIECE', factor: 1 },
};

export function normalizePackage(value: number | string | null | undefined, unit: string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(',', '.'));
  const key = String(unit ?? '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = UNIT_FACTORS[key];
  if (!Number.isFinite(numeric) || numeric <= 0 || !match) return null;
  return { sourceQuantity: numeric, sourceUnit: unit ?? key, quantity: numeric * match.factor, unit: match.unit };
}

export function deriveUnitPrice(price: number, pack: { quantity: number; unit: NormalizedUnit } | null) {
  if (!Number.isFinite(price) || price < 0 || !pack || pack.quantity <= 0) return null;
  if (pack.unit === 'GRAM') return { value: price / (pack.quantity / 1000), unit: 'RUB_PER_KG' };
  if (pack.unit === 'MILLILITER') return { value: price / (pack.quantity / 1000), unit: 'RUB_PER_LITER' };
  return { value: price / pack.quantity, unit: 'RUB_PER_PIECE' };
}

export function observationIdentity(input: {
  productId: string; storeId: string; retailerId?: string | null; retailProductId?: string | null;
  sourceType: string; sourceName: string; price: number; currency: string; observedAt: string;
  externalObservationId?: string | null; priceCondition?: PriceCondition;
}) {
  const stable = [input.productId, input.storeId, input.retailerId ?? '', input.retailProductId ?? '', input.sourceType,
    input.sourceName, input.externalObservationId ?? '', input.price, input.currency, input.observedAt,
    input.priceCondition ?? 'REGULAR'].join('|');
  return createHash('sha256').update(stable).digest('hex');
}

export function isGenericCurrentCondition(condition: PriceCondition) {
  return condition === 'REGULAR' || condition === 'PROMOTIONAL';
}

export function freshnessStatus(input: { observedAt?: string | Date | null; dataClass?: string | null; now?: Date; windowMs?: number; condition?: PriceCondition }): FreshnessStatus {
  if (!input.observedAt) return 'UNKNOWN';
  if (input.dataClass && input.dataClass !== 'PRODUCTION') return 'APPROXIMATE';
  if (input.condition && !isGenericCurrentCondition(input.condition)) return 'APPROXIMATE';
  const age = (input.now ?? new Date()).getTime() - new Date(input.observedAt).getTime();
  return age <= (input.windowMs ?? DEFAULT_FRESHNESS_WINDOW_MS) ? 'CURRENT' : 'STALE';
}

export type ReferencePriceEvidence = {
  status: FreshnessStatus;
  price: number | null;
  currency: string;
  normalizedUnitPrice: number | null;
  normalizedUnit: string | null;
  priceCondition: PriceCondition;
  observedAt: string | null;
  freshUntil: string | null;
  productId: string;
  retailerId?: string | null;
  storeId?: string | null;
  locationScope?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  observationId?: string | null;
  retailProductId?: string | null;
};
