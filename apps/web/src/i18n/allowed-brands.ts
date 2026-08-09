/**
 * Narrow brand / proper-name allowlist for Russian UI audits (UI-RU-01).
 * Keep small — do not hide real untranslated chrome.
 */
export const ALLOWED_BRAND_LITERALS = [
  'Weight App',
  'Food.ru',
  'Аймкук',
  'RussianFood',
  'DeepSeek',
  'PostgreSQL',
  'Redis',
  'email',
  'API',
] as const;

export type AllowedBrandLiteral = (typeof ALLOWED_BRAND_LITERALS)[number];

export function isAllowedBrandLiteral(text: string): boolean {
  const trimmed = text.trim();
  return (ALLOWED_BRAND_LITERALS as readonly string[]).includes(trimmed);
}

/** Tokens that may appear inside otherwise-Russian UI without failing the audit. */
export const ALLOWED_INLINE_TOKENS = [
  'Weight App',
  'Food.ru',
  'Аймкук',
  'RussianFood',
  'DeepSeek',
  'PostgreSQL',
  'Redis',
  'API',
  'URL',
  'UUID',
  'OWNER',
] as const;
