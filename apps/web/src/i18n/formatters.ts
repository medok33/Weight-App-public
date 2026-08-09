import { DEFAULT_BCP47, toBcp47, type UiLocaleCode } from './locale';

const numberFmtCache = new Map<string, Intl.NumberFormat>();
const dateFmtCache = new Map<string, Intl.DateTimeFormat>();

function numberFmt(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let fmt = numberFmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    numberFmtCache.set(key, fmt);
  }
  return fmt;
}

function dateFmt(locale: string, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let fmt = dateFmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    dateFmtCache.set(key, fmt);
  }
  return fmt;
}

function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatNumber(
  value: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFmt(toBcp47(locale), options).format(value);
}

export function formatInteger(value: number, locale: UiLocaleCode | string = DEFAULT_BCP47): string {
  return formatNumber(value, locale, { maximumFractionDigits: 0 });
}

export function formatDecimal(
  value: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
  fractionDigits = 1,
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

/** e.g. 5 565 ₽ / 120,50 ₽ */
export function formatCurrencyRub(
  amount: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  return numberFmt(toBcp47(locale), {
    style: 'currency',
    currency: 'RUB',
    currencyDisplay: 'symbol',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Minor units (kopecks) → ₽ */
export function formatCurrencyRubMinor(
  amountMinor: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  return formatCurrencyRub(amountMinor / 100, locale);
}

/** 26.07.2026 */
export function formatDate(
  value: Date | string | number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  return dateFmt(toBcp47(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(asDate(value));
}

/** 26.07.2026, 14:35 */
export function formatDateTime(
  value: Date | string | number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  return dateFmt(toBcp47(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(asDate(value));
}

/** сегодня / вчера / 26.07.2026 */
export function formatRelativeDay(
  value: Date | string | number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
  now: Date = new Date(),
): string {
  const target = startOfLocalDay(asDate(value));
  const today = startOfLocalDay(now);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (toBcp47(locale).startsWith('ru')) {
    if (diffDays === 0) return 'сегодня';
    if (diffDays === 1) return 'вчера';
  } else {
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
  }
  return formatDate(value, locale);
}

/** 250 г / 1,5 кг */
export function formatMassGrams(
  grams: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  if (Math.abs(grams) >= 1000) {
    return `${formatDecimal(grams / 1000, locale, 2)} кг`;
  }
  return `${formatInteger(Math.round(grams), locale)} г`;
}

/** 200 мл / 1,2 л */
export function formatVolumeMl(
  milliliters: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  if (Math.abs(milliliters) >= 1000) {
    return `${formatDecimal(milliliters / 1000, locale, 2)} л`;
  }
  return `${formatInteger(Math.round(milliliters), locale)} мл`;
}

/** 485 ккал */
export function formatEnergyKcal(
  kcal: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  return `${formatInteger(Math.round(kcal), locale)} ккал`;
}

/** 12,5 % */
export function formatPercent(
  value: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
  fractionDigits = 1,
): string {
  return `${formatDecimal(value, locale, fractionDigits)} %`;
}

/** 35 минут / 1 час 20 минут */
export function formatDurationMinutes(
  totalMinutes: number,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  const ru = toBcp47(locale).startsWith('ru');
  if (hours <= 0) {
    return ru ? `${minutes} ${pluralMinutesRu(minutes)}` : `${minutes} min`;
  }
  if (rem === 0) {
    return ru ? `${hours} ${pluralHoursRu(hours)}` : `${hours} h`;
  }
  return ru
    ? `${hours} ${pluralHoursRu(hours)} ${rem} ${pluralMinutesRu(rem)}`
    : `${hours} h ${rem} min`;
}

function pluralMinutesRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'минута';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'минуты';
  return 'минут';
}

function pluralHoursRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'час';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'часа';
  return 'часов';
}
