/**
 * RP2-03C Phase 0 — price data classification and USER-facing price labels.
 * Production resolvers must not treat FIXTURE/TEST_ONLY as confirmed store evidence.
 */

export const PRICE_DATA_CLASSES = [
  'PRODUCTION',
  'TEST_ONLY',
  'FIXTURE',
  'HISTORICAL_TEST',
] as const;
export type PriceDataClass = (typeof PRICE_DATA_CLASSES)[number];

export const NON_PRODUCTION_PRICE_CLASSES: readonly PriceDataClass[] = [
  'TEST_ONLY',
  'FIXTURE',
  'HISTORICAL_TEST',
];

export function isProductionPriceDataClass(value: string | null | undefined): boolean {
  return (value ?? 'PRODUCTION') === 'PRODUCTION';
}

/** Explicit opt-in for fixture/test prices (never on by display-name heuristics alone). */
export function allowTestPriceEvidence(options?: { allowTestPrices?: boolean }): boolean {
  if (options?.allowTestPrices === true) return true;
  return process.env.ALLOW_TEST_PRICES === '1';
}

export type UserPriceStatusCode =
  | 'STORE_PRICE'
  | 'STALE_PRICE'
  | 'UNCONFIRMED_PRICE'
  | 'PRICE_NOT_FOUND'
  | 'APPROXIMATE_ESTIMATE';

export function resolveUserPriceStatus(input: {
  hasPrice: boolean;
  stale?: boolean;
  incomplete?: boolean;
  dataClass?: string | null;
  approximate?: boolean;
}): UserPriceStatusCode {
  if (!input.hasPrice || !isProductionPriceDataClass(input.dataClass)) {
    return 'PRICE_NOT_FOUND';
  }
  if (input.incomplete) return 'UNCONFIRMED_PRICE';
  if (input.stale) return 'STALE_PRICE';
  if (input.approximate) return 'APPROXIMATE_ESTIMATE';
  return 'STORE_PRICE';
}

/** RU/EN USER labels — never expose fixture store / raw source codes. */
export const USER_PRICE_STATUS_LABELS: Record<
  UserPriceStatusCode,
  { ru: string; en: string }
> = {
  STORE_PRICE: { ru: 'Цена из магазина', en: 'Store price' },
  STALE_PRICE: { ru: 'Цена устарела', en: 'Price is outdated' },
  UNCONFIRMED_PRICE: { ru: 'Цена не подтверждена', en: 'Price not confirmed' },
  PRICE_NOT_FOUND: { ru: 'Цена не найдена', en: 'Price not found' },
  APPROXIMATE_ESTIMATE: { ru: 'Расчёт приблизительный', en: 'Approximate estimate' },
};

export function userPriceStatusLabel(
  code: UserPriceStatusCode,
  locale: 'ru' | 'en' = 'ru',
): string {
  return USER_PRICE_STATUS_LABELS[code][locale];
}

/**
 * Strip internal/fixture names from USER shopping DTO fields.
 * OWNER/admin may still see technical provenance separately.
 */
export function sanitizeUserShoppingPriceFields(input: {
  retailerName?: string | null;
  priceSourceName?: string | null;
  priceSourceType?: string | null;
  hasPrice: boolean;
  stale?: boolean;
  locale?: 'ru' | 'en';
  dataClass?: string | null;
}): {
  retailerName: string | null;
  priceSourceName: string | null;
  priceStatusCode: UserPriceStatusCode;
  priceStatusLabel: string;
} {
  const locale = input.locale ?? 'ru';
  const code = resolveUserPriceStatus({
    hasPrice: input.hasPrice,
    stale: input.stale,
    incomplete: !input.hasPrice,
    dataClass: input.dataClass ?? 'PRODUCTION',
    approximate: String(input.priceSourceType ?? '').toUpperCase().includes('ESTIMAT'),
  });
  return {
    retailerName: code === 'STORE_PRICE' ? 'Магазин' : null,
    priceSourceName: userPriceStatusLabel(code, locale),
    priceStatusCode: code,
    priceStatusLabel: userPriceStatusLabel(code, locale),
  };
}

export function classifyPriceObservationHeuristics(input: {
  source?: string | null;
  sourceName?: string | null;
  retailProductSource?: string | null;
  retailerKey?: string | null;
  retailerCode?: string | null;
}): PriceDataClass {
  const blob = [
    input.source,
    input.sourceName,
    input.retailProductSource,
    input.retailerKey,
    input.retailerCode,
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  if (
    blob.includes('step092') ||
    blob.includes('fixture') ||
    input.retailProductSource === 'FIXTURE' ||
    input.retailerKey === 'step092_fixture'
  ) {
    return 'FIXTURE';
  }
  if (/\be2e\b/.test(blob) || blob.startsWith('test') || blob.includes(' test')) {
    return 'TEST_ONLY';
  }
  return 'PRODUCTION';
}
