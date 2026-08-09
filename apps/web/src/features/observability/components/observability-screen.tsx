'use client';

import { useEffect, useState } from 'react';
import { getObservabilityDashboard } from '../api/observability.client';
import type { ObservabilityDashboard } from '../model/observability.types';
import { useI18n } from '../../../i18n/locale-provider';

type State = 'loading' | 'forbidden' | 'error' | 'empty' | 'success';

export function ObservabilityScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<State>('loading');
  const [data, setData] = useState<ObservabilityDashboard | null>(null);

  useEffect(() => {
    getObservabilityDashboard()
      .then((result) => {
        setData(result);
        const empty =
          result.operations.audit.length === 0 &&
          result.metrics.every((metric) => metric.value === 0);
        setState(empty ? 'empty' : 'success');
      })
      .catch((error: unknown) =>
        setState(error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN' ? 'forbidden' : 'error'),
      );
  }, []);

  if (state === 'loading') {
    return (
      <main aria-busy="true" data-testid="observability-screen">
        <h1>{t('admin.obs.title')}</h1>
        <p>{t('admin.obs.loading')}</p>
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main role="alert" data-testid="observability-screen">
        <h1>{t('admin.obs.title')}</h1>
        <p>{t('admin.obs.forbidden')}</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert" data-testid="observability-screen">
        <h1>{t('admin.obs.title')}</h1>
        <p>{t('admin.obs.error')}</p>
      </main>
    );
  }
  if (state === 'empty') {
    return (
      <main data-testid="observability-screen">
        <h1>{t('admin.obs.title')}</h1>
        <p>{t('admin.obs.empty')}</p>
      </main>
    );
  }

  return (
    <main data-testid="observability-screen">
      <h1>{t('admin.obs.title')}</h1>
      <section data-testid="observability-metrics">
        <h2>{t('admin.obs.metrics')}</h2>
        <ul>
          {data?.metrics.map((metric) => (
            <li key={metric.name}>
              {metric.name}: {metric.value} {metric.unit}
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="observability-traces">
        <h2>{t('admin.obs.traces')}</h2>
        <ul>
          {data?.traces.map((span) => (
            <li key={span.name}>
              {span.name} — {span.durationMs}ms ({span.status})
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>
          {t('admin.obs.jobs')} ({data?.operations.jobs.length ?? 0})
        </h2>
        {data?.operations.jobs.length ? (
          <ul>
            {data.operations.jobs.map((event) => (
              <li key={event.id}>{event.action}</li>
            ))}
          </ul>
        ) : (
          <p>{t('admin.obs.noJobs')}</p>
        )}
      </section>
      <section>
        <h2>
          {t('admin.obs.errors')} ({data?.operations.errors.length ?? 0})
        </h2>
        {data?.operations.errors.length ? (
          <ul>
            {data.operations.errors.map((event) => (
              <li key={event.id}>{event.action}</li>
            ))}
          </ul>
        ) : (
          <p>{t('admin.obs.noErrors')}</p>
        )}
      </section>
      <section>
        <h2>
          {t('admin.obs.audit')} ({data?.operations.audit.length ?? 0})
        </h2>
        <ul>
          {data?.operations.audit.slice(0, 20).map((event) => (
            <li key={event.id}>{event.action}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
