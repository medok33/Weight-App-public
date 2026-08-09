'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/locale-provider';
import type { MessageKey } from '../../../i18n/types';

type Overview = {
  productionRecipes?: number;
  testOnlyRecipes?: number;
  fixtureRecipes?: number;
  historicalRecipes?: number;
  legacyRecipes?: number;
  eligibleCurrentVersions?: number;
  coverageEmpty?: number;
  coverageUnderfilled?: number;
  openRevalidation?: number;
  duplicateBlockers?: number;
  mediaRightsBlockers?: number;
  unresolvedDependencies?: number;
  staleSearchDecisions?: number;
  dirtyCoverage?: number;
  lastCoverageAnalyzerRun?: { id?: string; finishedAt?: string | null; mode?: string } | null;
  links?: Record<string, string>;
};

const METRIC_KEYS: Array<{ key: keyof Overview; labelKey: MessageKey; linkKey?: string }> = [
  { key: 'productionRecipes', labelKey: 'admin.content.metric.productionRecipes', linkKey: 'recipesProduction' },
  { key: 'eligibleCurrentVersions', labelKey: 'admin.content.metric.eligibleCurrentVersions', linkKey: 'recipesProduction' },
  { key: 'coverageEmpty', labelKey: 'admin.content.metric.coverageEmpty', linkKey: 'coverageEmpty' },
  { key: 'coverageUnderfilled', labelKey: 'admin.content.metric.coverageUnderfilled', linkKey: 'coverageUnderfilled' },
  { key: 'openRevalidation', labelKey: 'admin.content.metric.openRevalidation', linkKey: 'revalidation' },
  { key: 'duplicateBlockers', labelKey: 'admin.content.metric.duplicateBlockers', linkKey: 'duplicates' },
  { key: 'mediaRightsBlockers', labelKey: 'admin.content.metric.mediaRightsBlockers', linkKey: 'media' },
  { key: 'unresolvedDependencies', labelKey: 'admin.content.metric.unresolvedDependencies', linkKey: 'unresolvedDependencies' },
  { key: 'staleSearchDecisions', labelKey: 'admin.content.metric.staleSearchDecisions', linkKey: 'staleSearch' },
  { key: 'dirtyCoverage', labelKey: 'admin.content.metric.dirtyCoverage', linkKey: 'dirtyCoverage' },
  { key: 'testOnlyRecipes', labelKey: 'admin.content.metric.testOnlyRecipes', linkKey: 'recipesTest' },
  { key: 'historicalRecipes', labelKey: 'admin.content.metric.historicalRecipes', linkKey: 'recipesTest' },
];

export function ContentOverviewScreen() {
  const { t } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  const metrics = useMemo(() => METRIC_KEYS.map((m) => ({ ...m, label: t(m.labelKey) })), [t]);

  useEffect(() => {
    void fetch('/api/admin/content/overview', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          setError(true);
          return;
        }
        setData((await response.json()) as Overview);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <main className="admin-workspace" role="alert">
        {t('admin.content.unavailable')}
      </main>
    );
  }
  if (!data) {
    return (
      <main className="admin-workspace" aria-busy="true">
        {t('admin.content.loading')}
      </main>
    );
  }

  const lastRun = data.lastCoverageAnalyzerRun;
  const lastRunText = lastRun
    ? `${lastRun.mode ?? ''} ${(lastRun as { completedAt?: string }).completedAt ?? lastRun.finishedAt ?? ''}`.trim()
    : t('admin.content.analyzerNeverRun');

  return (
    <main className="admin-workspace" data-testid="admin-content-overview">
      <h1>{t('nav.adminContent')}</h1>
      <p data-testid="admin-workspace-label">{t('admin.content.workspaceLabel')}</p>
      <section className="admin-metric-grid">
        {metrics.map((metric) => {
          const href = metric.linkKey ? data.links?.[metric.linkKey] : undefined;
          const value = data[metric.key];
          const body = (
            <>
              <small>{metric.label}</small>
              <strong style={{ display: 'block', fontSize: 28 }}>{String(value ?? 0)}</strong>
            </>
          );
          return (
            <article key={metric.key} data-testid={`content-metric-${metric.key}`}>
              {href ? <Link href={href}>{body}</Link> : body}
            </article>
          );
        })}
      </section>
      <p>
        {t('admin.content.lastAnalyzer')}: {lastRunText}
      </p>
      {lastRun?.id ? (
        <details>
          <summary>{t('admin.common.technicalDetails')}</summary>
          <p>{lastRun.id}</p>
        </details>
      ) : null}
    </main>
  );
}
