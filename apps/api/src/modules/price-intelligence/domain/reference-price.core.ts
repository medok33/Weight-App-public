import { createHash } from 'node:crypto';

export const PRICE_CONDITIONS = ['REGULAR', 'PROMOTIONAL', 'LOYALTY_ONLY', 'CONDITIONAL', 'UNKNOWN_CONDITION'] as const;
export type PriceCondition = (typeof PRICE_CONDITIONS)[number];
export type NormalizedUnit = 'GRAM' | 'MILLILITER' | 'PIECE';
export type FreshnessStatus = 'CURRENT' | 'STALE' | 'UNKNOWN' | 'APPROXIMATE';

export const DEFAULT_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const SUPPORTED_PRICE_CURRENCY = 'RUB' as const;

const UNIT_FACTORS: Record<string, { unit: NormalizedUnit; factor: number }> = {
  g: { unit: 'GRAM', factor: 1 }, gram: { unit: 'GRAM', factor: 1 }, grams: { unit: 'GRAM', factor: 1 },
  kg: { unit: 'GRAM', factor: 1000 }, kilogram: { unit: 'GRAM', factor: 1000 }, kilograms: { unit: 'GRAM', factor: 1000 },
  ml: { unit: 'MILLILITER', factor: 1 }, milliliter: { unit: 'MILLILITER', factor: 1 }, milliliters: { unit: 'MILLILITER', factor: 1 },
  l: { unit: 'MILLILITER', factor: 1000 }, liter: { unit: 'MILLILITER', factor: 1000 }, liters: { unit: 'MILLILITER', factor: 1000 },
  pcs: { unit: 'PIECE', factor: 1 }, piece: { unit: 'PIECE', factor: 1 }, pieces: { unit: 'PIECE', factor: 1 }, шт: { unit: 'PIECE', factor: 1 },
};

export function normalizePackage(value: number | string | null | undefined, unit: string | null | undefined) {
  const raw = String(value ?? '').trim();
  const embedded = typeof value === 'string' ? /^([0-9]+(?:[.,][0-9]+)?)\s*([\p{L}]+)?$/u.exec(raw) : null;
  const numeric = typeof value === 'number' ? value : Number(String(embedded?.[1] ?? raw).replace(',', '.'));
  const suppliedKey = String(unit ?? '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const embeddedKey = String(embedded?.[2] ?? '').trim().toLowerCase();
  if (suppliedKey && embeddedKey && UNIT_FACTORS[suppliedKey]?.unit !== UNIT_FACTORS[embeddedKey]?.unit) return null;
  const key = suppliedKey || embeddedKey;
  const match = UNIT_FACTORS[key];
  if (!Number.isFinite(numeric) || numeric <= 0 || !match) return null;
  return { sourceQuantity: numeric, sourceUnit: unit ?? key, quantity: numeric * match.factor, unit: match.unit };
}

export function normalizeCurrency(currency: string | null | undefined): typeof SUPPORTED_PRICE_CURRENCY {
  const normalized = String(currency ?? '').trim().toUpperCase();
  if (normalized !== SUPPORTED_PRICE_CURRENCY) throw new Error('PRICE_CURRENCY_UNSUPPORTED');
  return SUPPORTED_PRICE_CURRENCY;
}

export function deriveUnitPrice(price: number, pack: { quantity: number; unit: NormalizedUnit } | null, currency = SUPPORTED_PRICE_CURRENCY) {
  if (normalizeCurrency(currency) !== SUPPORTED_PRICE_CURRENCY || !Number.isFinite(price) || price < 0 || !pack || pack.quantity <= 0) return null;
  if (pack.unit === 'GRAM') return { value: price / (pack.quantity / 1000), unit: 'RUB_PER_KG' };
  if (pack.unit === 'MILLILITER') return { value: price / (pack.quantity / 1000), unit: 'RUB_PER_LITER' };
  return { value: price / pack.quantity, unit: 'RUB_PER_PIECE' };
}

export function observationIdentity(input: {
  productId: string; storeId: string; retailerId?: string | null; retailProductId?: string | null;
  sourceType: string; sourceName: string; price: number; currency: string; observedAt: string;
  externalObservationId?: string | null; priceCondition?: PriceCondition;
  providerId?: string | null; externalSku?: string | null; regionId?: string | null; locationScope?: string | null;
  packageQuantity?: number | string | null; packageUnit?: string | null; regularPrice?: number | string | null;
  conditionDescription?: string | null; validFrom?: string | null; validTo?: string | null;
  loyaltyRequired?: boolean | null; quantityRequirement?: number | string | null;
  sourceUrl?: string | null; evidenceSha256?: string | null;
  acquiredAt?: string | null; acquisitionTimeQuality?: string | null;
}) {
  const decimal = (value: number | string | null | undefined) => {
    if (value == null || String(value).trim() === '') return '';
    const parsed = Number(String(value).trim().replace(',', '.'));
    if (!Number.isFinite(parsed)) throw new Error('PRICE_IDENTITY_NUMBER_INVALID');
    return Object.is(parsed, -0) ? '0' : String(parsed);
  };
  const timestamp = (value: string | null | undefined) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new Error('PRICE_IDENTITY_TIMESTAMP_INVALID');
    return parsed.toISOString();
  };
  const text = (value: string | null | undefined, foldCase = false) => {
    const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
    return foldCase ? normalized.toUpperCase() : normalized;
  };
  const pack = normalizePackage(input.packageQuantity, input.packageUnit);
  // Fixed-order tuple serialization is deliberate: no object-key/locale behavior participates in the hash.
  const stable = JSON.stringify([
    ['version', '2'],
    ['providerId', text(input.providerId)],
    ['sourceType', text(input.sourceType, true)],
    ['sourceName', text(input.sourceName)],
    ['externalObservationId', text(input.externalObservationId)],
    ['retailerId', text(input.retailerId)],
    ['retailProductId', text(input.retailProductId)],
    ['externalSku', text(input.externalSku)],
    ['productId', text(input.productId)],
    ['storeId', text(input.storeId)],
    ['regionId', text(input.regionId)],
    ['locationScope', text(input.locationScope, true)],
    ['price', decimal(input.price)],
    ['currency', normalizeCurrency(input.currency)],
    ['observedAt', timestamp(input.observedAt)],
    ['priceCondition', input.priceCondition ?? 'REGULAR'],
    ['packageQuantity', pack ? decimal(pack.quantity) : text(input.packageQuantity == null ? '' : String(input.packageQuantity), true)],
    ['packageUnit', pack?.unit ?? text(input.packageUnit, true)],
    ['regularPrice', decimal(input.regularPrice)],
    ['conditionDescription', text(input.conditionDescription)],
    ['validFrom', timestamp(input.validFrom)],
    ['validTo', timestamp(input.validTo)],
    ['loyaltyRequired', input.loyaltyRequired == null ? '' : String(input.loyaltyRequired)],
    ['quantityRequirement', decimal(input.quantityRequirement)],
    ['sourceUrl', text(input.sourceUrl)],
    ['evidenceSha256', text(input.evidenceSha256)],
    ['acquiredAt', timestamp(input.acquiredAt)],
    ['acquisitionTimeQuality', text(input.acquisitionTimeQuality, true)],
  ]);
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

export function isGenericCurrentCondition(condition: PriceCondition) {
  return condition === 'REGULAR' || condition === 'PROMOTIONAL';
}

export function freshnessStatus(input: { observedAt?: string | Date | null; dataClass?: string | null; now?: Date; windowMs?: number; condition?: PriceCondition }): FreshnessStatus {
  if (!input.observedAt) return 'UNKNOWN';
  if (input.dataClass && input.dataClass !== 'PRODUCTION') return 'APPROXIMATE';
  if (input.condition && !isGenericCurrentCondition(input.condition)) return 'APPROXIMATE';
  const observedAt = new Date(input.observedAt).getTime();
  if (!Number.isFinite(observedAt)) return 'UNKNOWN';
  const age = (input.now ?? new Date()).getTime() - observedAt;
  if (age < -MAX_FUTURE_CLOCK_SKEW_MS) return 'UNKNOWN';
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
  retailerName?: string | null;
  retailerCode?: string | null;
  packageQuantity?: number | null;
  packageUnit?: string | null;
  availability?: string | null;
  confidence?: number | null;
  dataClass?: string | null;
  sourceUrl?: string | null;
  evidenceSha256?: string | null;
  acquiredAt?: string | null;
  acquisitionTimeQuality?: string | null;
};
