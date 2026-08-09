import { describe, expect, it } from 'vitest';
import { activityProviderHintKey } from '../activity-connections.logic';
import type { ActivityProviderStatus } from '../../api/activity.client';

function provider(
  overrides: Partial<ActivityProviderStatus>,
): ActivityProviderStatus {
  return {
    source: 'HEALTHKIT',
    consentState: 'NOT_GRANTED',
    connectionState: 'NOT_CONNECTED',
    syncHealth: 'BLOCKED_BY_CONSENT',
    connectedAt: null,
    disconnectedAt: null,
    lastSuccessfulSyncAt: null,
    ...overrides,
  };
}

describe('activityProviderHintKey', () => {
  it('prefers consent blocked over not-connected copy', () => {
    expect(
      activityProviderHintKey(
        provider({
          consentState: 'NOT_GRANTED',
          connectionState: 'NOT_CONNECTED',
          syncHealth: 'BLOCKED_BY_CONSENT',
        }),
      ),
    ).toBe('settings.activity.hint.consent');
  });

  it('uses disconnect hint for BLOCKED_BY_DISCONNECT', () => {
    expect(
      activityProviderHintKey(
        provider({
          consentState: 'GRANTED',
          connectionState: 'DISCONNECTED',
          syncHealth: 'BLOCKED_BY_DISCONNECT',
        }),
      ),
    ).toBe('settings.activity.hint.disconnected');
  });

  it('uses notConnected for NEVER_SYNCED without row', () => {
    expect(
      activityProviderHintKey(
        provider({
          consentState: 'GRANTED',
          connectionState: 'NOT_CONNECTED',
          syncHealth: 'NEVER_SYNCED',
        }),
      ),
    ).toBe('settings.activity.hint.notConnected');
  });

  it('uses healthy hint that allows web disconnect wording', () => {
    expect(
      activityProviderHintKey(
        provider({
          consentState: 'GRANTED',
          connectionState: 'CONNECTED',
          syncHealth: 'HEALTHY',
          lastSuccessfulSyncAt: '2026-08-04T12:00:00.000Z',
        }),
      ),
    ).toBe('settings.activity.hint.healthy');
  });
});
