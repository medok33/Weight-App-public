'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  disconnectActivityProvider,
  getActivityConnections,
  type ActivityConnectionsResponse,
  type ActivityProviderStatus,
} from '../api/activity.client';
import {
  activityConnectionLabelKey,
  activityConsentLabelKey,
  activityProviderHintKey,
  activityProviderTitleKey,
  activitySyncHealthLabelKey,
  formatActivitySyncedAt,
} from '../lib/activity-connections.logic';
import { useI18n } from '@/i18n/locale-provider';
import { handleUnauthorized } from '@/lib/handle-unauthorized';
import { mapUnknownToUiError, type UiApiError } from '@/lib/map-api-error';
import { ErrorState, LoadingState, RetryAction } from '@/components/ui-state';

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; error: UiApiError }
  | { status: 'ready'; data: ActivityConnectionsResponse };

export function ActivityConnectionsPanel({ formId }: { formId: string }) {
  const { t, locale } = useI18n();
  const localeTag = locale === 'en' ? 'en-US' : 'ru-RU';
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [busySource, setBusySource] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await getActivityConnections();
      setState({ status: 'ready', data });
    } catch (error) {
      if (handleUnauthorized(error)) return;
      setState({ status: 'error', error: mapUnknownToUiError(error, { locale }) });
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDisconnect(provider: ActivityProviderStatus) {
    setBusySource(provider.source);
    try {
      const updated = await disconnectActivityProvider(provider.source);
      setState((current) => {
        if (current.status !== 'ready') return current;
        return {
          status: 'ready',
          data: {
            ...current.data,
            providers: current.data.providers.map((row) =>
              row.source === updated.source ? updated : row,
            ),
          },
        };
      });
    } catch (error) {
      if (handleUnauthorized(error)) return;
      setState({ status: 'error', error: mapUnknownToUiError(error, { locale }) });
    } finally {
      setBusySource(null);
    }
  }

  return (
    <section
      className="wa-settings-section"
      data-testid="settings-activity-section"
      aria-labelledby={`${formId}-activity`}
    >
      <h2 id={`${formId}-activity`}>{t('settings.activity.title')}</h2>
      <p className="wa-settings-lead">{t('settings.activity.body')}</p>

      {state.status === 'loading' ? (
        <LoadingState message={t('common.loading')} testId="settings-activity-loading" />
      ) : null}

      {state.status === 'error' ? (
        <ErrorState
          title={state.error.title}
          message={state.error.explanation}
          testId="settings-activity-error"
          action={
            <RetryAction
              label={t('common.retry')}
              onRetry={() => void load()}
              testId="settings-activity-retry"
            />
          }
        />
      ) : null}

      {state.status === 'ready'
        ? state.data.providers.map((provider) => {
            const lastSync = formatActivitySyncedAt(
              provider.lastSuccessfulSyncAt,
              localeTag,
            );
            return (
              <article
                key={provider.source}
                className="wa-settings-activity-provider"
                data-testid={`settings-activity-provider-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}
              >
                <h3>{t(activityProviderTitleKey(provider.source))}</h3>
                <dl className="wa-settings-activity-meta">
                  <div>
                    <dt>{t('settings.activity.consentLabel')}</dt>
                    <dd data-testid={`settings-activity-consent-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}>
                      {t(activityConsentLabelKey(provider.consentState))}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('settings.activity.connectionLabel')}</dt>
                    <dd data-testid={`settings-activity-connection-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}>
                      {t(activityConnectionLabelKey(provider.connectionState))}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('settings.activity.healthLabel')}</dt>
                    <dd data-testid={`settings-activity-health-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}>
                      {t(activitySyncHealthLabelKey(provider.syncHealth))}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('settings.activity.lastSyncLabel')}</dt>
                    <dd data-testid={`settings-activity-last-sync-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}>
                      {lastSync ?? t('settings.activity.lastSyncNever')}
                    </dd>
                  </div>
                </dl>
                <p
                  className="wa-settings-lead"
                  data-testid={`settings-activity-hint-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}
                >
                  {t(activityProviderHintKey(provider))}
                </p>
                {provider.connectionState === 'CONNECTED' ? (
                  <div className="wa-settings-actions">
                    <button
                      type="button"
                      data-testid={`settings-activity-disconnect-${provider.source === 'HEALTHKIT' ? 'apple' : 'health-connect'}`}
                      disabled={busySource === provider.source}
                      onClick={() => void onDisconnect(provider)}
                    >
                      {busySource === provider.source
                        ? t('common.loading')
                        : t('settings.activity.disconnect')}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        : null}
    </section>
  );
}
