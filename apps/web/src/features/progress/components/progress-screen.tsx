'use client';

import { useEffect, useMemo, useState } from 'react';
import { addProgressWeight, getProgressSummary } from '../api/progress.client';
import type { ProgressSummary } from '../model/progress.types';
import { useI18n } from '../../../i18n/locale-provider';

function WeightChart({ entries }: { entries: ProgressSummary['entries'] }) {
  const { t } = useI18n();
  const points = useMemo(() => {
    if (entries.length === 0) return '';
    const weights = entries.map((entry) => entry.weightKg);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const span = Math.max(max - min, 1);
    return entries
      .map((entry, index) => {
        const x = entries.length === 1 ? 50 : (index / (entries.length - 1)) * 100;
        const y = 90 - ((entry.weightKg - min) / span) * 70;
        return `${x},${y}`;
      })
      .join(' ');
  }, [entries]);

  if (!entries.length) {
    return <p data-testid="progress-chart-empty">{t('progress.emptyChart')}</p>;
  }

  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={t('progress.title')} data-testid="progress-chart" width="100%" height="220">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      {entries.map((entry, index) => {
        const weights = entries.map((item) => item.weightKg);
        const min = Math.min(...weights);
        const max = Math.max(...weights);
        const span = Math.max(max - min, 1);
        const x = entries.length === 1 ? 50 : (index / (entries.length - 1)) * 100;
        const y = 90 - ((entry.weightKg - min) / span) * 70;
        return <circle key={entry.id ?? `${entry.measuredAt}-${index}`} cx={x} cy={y} r="1.8" fill="currentColor" />;
      })}
    </svg>
  );
}

export function ProgressScreen() {
  const { t, tc, locale } = useI18n();
  const [weight, setWeight] = useState('');
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'saving' | 'error';
    summary?: ProgressSummary;
    message?: string;
  }>({ status: 'loading' });

  useEffect(() => {
    getProgressSummary()
      .then((summary) => setState({ status: 'ready', summary }))
      .catch(() => setState({ status: 'error', message: t('progress.loadError') }));
  }, [t]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) => ({ ...current, status: 'saving' }));
    try {
      const summary = await addProgressWeight(Number(weight));
      setWeight('');
      setState({ status: 'ready', summary, message: t('progress.saved') });
    } catch {
      setState((current) => ({ ...current, status: 'error', message: t('progress.saveError') }));
    }
  }

  if (state.status === 'loading') {
    return <main aria-busy="true"><h1>{t('progress.title')}</h1><p>{t('common.loading')}</p></main>;
  }

  const summary = state.summary;
  return (
    <main>
      <h1 data-testid="progress-heading">{t('progress.title')}</h1>
      <p>{t('progress.subtitle')}</p>
      {state.message ? <p role="status" data-testid="progress-status">{state.message}</p> : null}
      <form onSubmit={onSubmit} data-testid="progress-form">
        <label>
          {t('progress.weight')}
          <input
            data-testid="progress-weight"
            type="number"
            min={35}
            max={250}
            step="0.1"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            required
          />
        </label>
        <button type="submit" data-testid="progress-save" disabled={state.status === 'saving'}>
          {state.status === 'saving' ? t('progress.saving') : t('progress.add')}
        </button>
      </form>
      {summary?.latest ? (
        <p data-testid="progress-latest">
          {t('progress.latest')}: {summary.latest.weightKg} {tc('unit', 'kg')}
          {summary.deltaKg != null ? ` · ${t('progress.delta')} ${summary.deltaKg > 0 ? '+' : ''}${summary.deltaKg} ${tc('unit', 'kg')}` : ''}
        </p>
      ) : null}
      <WeightChart entries={summary?.entries ?? []} />
      <ul data-testid="progress-history">
        {(summary?.entries ?? []).slice().reverse().map((entry) => (
          <li key={entry.id ?? entry.measuredAt}>
            {new Date(entry.measuredAt).toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU')}: {entry.weightKg} {tc('unit', 'kg')}
          </li>
        ))}
      </ul>
    </main>
  );
}
