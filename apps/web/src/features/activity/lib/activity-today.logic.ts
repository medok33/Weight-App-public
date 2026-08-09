import type { ActivityTodayResponse } from '../api/activity.client';

export function formatStepsCount(steps: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU').format(steps);
}

export function formatSyncedAt(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function activitySourceLabelKey(
  source: ActivityTodayResponse['source'],
): 'activity.source.healthkit' | 'activity.source.healthConnect' | null {
  if (source === 'HEALTHKIT') return 'activity.source.healthkit';
  if (source === 'HEALTH_CONNECT') return 'activity.source.healthConnect';
  return null;
}
