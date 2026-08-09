import { createHash } from 'node:crypto';
import type { EngagementState, NotificationCategory, NotificationChannel, NotificationPreferences } from './retention.types';

const TOXIC = ['failed', 'broken', 'start over', 'ruined', 'burned'];
export function composePrivacySafeCopy(category: NotificationCategory, event: { title?: string; body?: string }) {
  const safe = (value = '') => value.replace(/\b\d+(?:[.,]\d+)?\s*kg\b/gi, 'your progress').replace(/diagnos\w*|payment\w*|family member\w*|ai\b/gi, 'update');
  return { title: safe(event.title || `${category} update`), body: safe(event.body || 'You have an update in the app.') };
}
export function dedupeKey(userId: string, category: NotificationCategory, eventId: string) {
  return createHash('sha256').update(`${userId}:${category}:${eventId}`).digest('hex');
}
export type DeliveryDecision = { action: 'deliver' | 'defer' | 'skip'; reason?: string; deferUntil?: Date };

export function resolveDeliveryDecision(prefs: NotificationPreferences, category: NotificationCategory, channel: NotificationChannel, nowLocal: Date): DeliveryDecision {
  if (category === 'security' && (channel === 'in_app' || channel === 'email')) return { action: 'deliver' };
  if (!prefs.channels[channel] || prefs.categoryOpts?.[category] === false) return { action: 'skip', reason: 'CHANNEL_OR_CATEGORY_DISABLED' };
  const start = prefs.quietHoursStart, end = prefs.quietHoursEnd;
  if (!start || !end) return { action: 'deliver' };
  const current = `${String(nowLocal.getHours()).padStart(2, '0')}:${String(nowLocal.getMinutes()).padStart(2, '0')}`;
  const quiet = start <= end ? current >= start && current < end : current >= start || current < end;
  if (!quiet) return { action: 'deliver' };
  const [hours, minutes] = end.split(':').map(Number);
  const deferUntil = new Date(nowLocal);
  deferUntil.setHours(hours, minutes, 0, 0);
  if (deferUntil <= nowLocal) deferUntil.setDate(deferUntil.getDate() + 1);
  return { action: 'defer', reason: 'QUIET_HOURS', deferUntil };
}

export function shouldDeliver(prefs: NotificationPreferences, category: NotificationCategory, channel: NotificationChannel, nowLocal: Date) {
  return resolveDeliveryDecision(prefs, category, channel, nowLocal).action === 'deliver';
}
export function classifyProviderFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /timeout|rate|5\d\d/i.test(message) ? 'RETRYABLE_PROVIDER_FAILURE' : 'PROVIDER_FAILURE';
}
export function buildReturnAfterBreak(state: EngagementState, today: string, options: { planExpired?: boolean; unsafeCalorieTarget?: boolean } = {}) {
  const daysAway = state.lastActiveOn ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(state.lastActiveOn)) / 86_400_000)) : 0;
  const requireSafetyReview = Boolean(options.planExpired || options.unsafeCalorieTarget);
  const message = 'Welcome back. A small step today is enough.';
  if (TOXIC.some((phrase) => message.toLowerCase().includes(phrase))) throw new Error('ENGAGEMENT_COPY_UNSAFE');
  return { daysAway, message, requireSafetyReview, nextSmallAction: requireSafetyReview ? 'recalculate_if_unsafe' : daysAway > 7 ? 'review_plan' : 'check_in', successfulDaysTotal: state.successfulDaysTotal, bestStreakDays: state.bestStreakDays, currentStreakDays: state.paused ? state.currentStreakDays : state.currentStreakDays };
}
export function recordEngagementDay(state: EngagementState, date: string): EngagementState {
  if (state.paused || state.lastActiveOn === date) return { ...state, lastActiveOn: date };
  const consecutive = state.lastActiveOn && Math.floor((Date.parse(date) - Date.parse(state.lastActiveOn)) / 86_400_000) === 1;
  const currentStreakDays = consecutive ? state.currentStreakDays + 1 : 1;
  return { ...state, lastActiveOn: date, currentStreakDays, bestStreakDays: Math.max(state.bestStreakDays, currentStreakDays), successfulDaysTotal: state.successfulDaysTotal + 1 };
}
