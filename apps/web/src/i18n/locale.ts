/** Default product locale for Weight App (UI-RU-01). */
export const DEFAULT_LOCALE = 'ru' as const;
export const DEFAULT_BCP47 = 'ru-RU' as const;

export type UiLocaleCode = 'ru' | 'en';

export function toBcp47(locale: UiLocaleCode | string | null | undefined): string {
  if (locale === 'en' || locale === 'en-US' || locale === 'en-GB') return 'en-US';
  return DEFAULT_BCP47;
}

export function normalizeAppLocale(locale: string | null | undefined): UiLocaleCode {
  return locale === 'en' || locale === 'en-US' || locale === 'en-GB' ? 'en' : 'ru';
}
