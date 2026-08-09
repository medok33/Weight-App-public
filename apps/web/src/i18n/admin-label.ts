import type { AdminMessageKey } from './admin-message-keys';
import type { MessageKey } from './types';

type TFn = (key: MessageKey) => string;

/** Prefer API Russian label; otherwise i18n enum key; last resort raw code (for technical details only). */
export function labelOrEnum(
  t: TFn,
  code: string | null | undefined,
  keyByCode: Record<string, AdminMessageKey>,
  apiLabelRu?: string | null,
): string {
  if (apiLabelRu) return apiLabelRu;
  const key = keyByCode[String(code ?? '')];
  return key ? t(key) : code ? String(code) : '—';
}

export const COVERAGE_STATUS_KEYS: Record<string, AdminMessageKey> = {
  EMPTY: 'admin.coverage.status.EMPTY',
  UNDERFILLED: 'admin.coverage.status.UNDERFILLED',
  COVERED: 'admin.coverage.status.COVERED',
  OVERFILLED: 'admin.coverage.status.OVERFILLED',
  NEEDS_REFRESH: 'admin.coverage.status.NEEDS_REFRESH',
};
