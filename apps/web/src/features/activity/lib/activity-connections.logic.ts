import type { MessageKey } from '@/i18n/types';
import type {
  ActivityConsentState,
  ActivityConnectionState,
  ActivityProviderStatus,
  ActivitySyncHealth,
} from '../api/activity.client';

export function activityProviderTitleKey(
  source: ActivityProviderStatus['source'],
): MessageKey {
  return source === 'HEALTHKIT'
    ? 'activity.source.healthkit'
    : 'activity.source.healthConnect';
}

export function activityConsentLabelKey(state: ActivityConsentState): MessageKey {
  switch (state) {
    case 'GRANTED':
      return 'settings.activity.consent.granted';
    case 'REVOKED':
      return 'settings.activity.consent.revoked';
    default:
      return 'settings.activity.consent.notGranted';
  }
}

export function activityConnectionLabelKey(state: ActivityConnectionState): MessageKey {
  switch (state) {
    case 'CONNECTED':
      return 'settings.activity.connection.connected';
    case 'DISCONNECTED':
      return 'settings.activity.connection.disconnected';
    default:
      return 'settings.activity.connection.notConnected';
  }
}

export function activitySyncHealthLabelKey(health: ActivitySyncHealth): MessageKey {
  switch (health) {
    case 'BLOCKED_BY_CONSENT':
      return 'settings.activity.health.blockedByConsent';
    case 'BLOCKED_BY_DISCONNECT':
      return 'settings.activity.health.blockedByDisconnect';
    case 'NEVER_SYNCED':
      return 'settings.activity.health.neverSynced';
    case 'STALE':
      return 'settings.activity.health.stale';
    default:
      return 'settings.activity.health.healthy';
  }
}

/**
 * Hint copy follows syncHealth precedence (not connectionState alone):
 * BLOCKED_BY_CONSENT → BLOCKED_BY_DISCONNECT → NEVER_SYNCED → STALE → HEALTHY.
 */
export function activityProviderHintKey(provider: ActivityProviderStatus): MessageKey {
  switch (provider.syncHealth) {
    case 'BLOCKED_BY_CONSENT':
      return 'settings.activity.hint.consent';
    case 'BLOCKED_BY_DISCONNECT':
      return 'settings.activity.hint.disconnected';
    case 'NEVER_SYNCED':
      return provider.connectionState === 'NOT_CONNECTED'
        ? 'settings.activity.hint.notConnected'
        : 'settings.activity.hint.neverSynced';
    case 'STALE':
      return 'settings.activity.hint.stale';
    case 'HEALTHY':
    default:
      return 'settings.activity.hint.healthy';
  }
}

export function formatActivitySyncedAt(
  value: string | null,
  locale: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
