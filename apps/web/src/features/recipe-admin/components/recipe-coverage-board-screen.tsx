'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../../../i18n/locale-provider';
import { COVERAGE_STATUS_KEYS, labelOrEnum } from '../../../i18n/admin-label';
import { labelCoveragePriority, labelMealType } from '../../../i18n/enums';

type SlotCard = {
  id: string;
  status: string;
  statusLabelRu?: string;
  displayName?: string;
  slotKey?: string;
  priority?: string;
  mealType?: string;
  primaryProductKey?: string | null;
  desiredCount?: number;
  currentUniqueCount?: number;
  ambiguousCandidates?: number;
  dirty?: boolean;
  detailHref?: string;
  lastAnalyzedAt?: string | null;
};

const COLUMN_ORDER = ['EMPTY', 'UNDERFILLED', 'COVERED', 'OVERFILLED', 'NEEDS_REFRESH'] as const;

export function RecipeCoverageBoardScreen() {
  const { t } = useI18n();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'success'>('loading');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const query = searchParams.toString();
  const mode = searchParams.get('mode') ?? 'board';

  useEffect(() => {
    void (async () => {
      setState('loading');
      try {
        const response = await fetch(`/api/admin/recipe-coverage/board?${query}`, { cache: 'no-store' });
        if (!response.ok) {
          setState('error');
          return;
        }
        setData((await response.json()) as Record<string, unknown>);
        setState('success');
      } catch {
        setState('error');
      }
    })();
  }, [query]);

  function update(values: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(values).forEach(([key, value]) => (value ? params.set(key, value) : params.delete(key)));
    router.replace(`${pathname}?${params.toString()}`);
  }

  function statusLabel(status: string, api?: string) {
    return labelOrEnum(t, status, COVERAGE_STATUS_KEYS, api);
  }

  if (state === 'loading' || !data) {
    return (
      <main className="admin-workspace" aria-busy="true">
        {t('admin.coverage.loading')}
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main className="admin-workspace" role="alert">
        {t('admin.coverage.unavailable')}
        <button type="button" onClick={() => router.refresh()}>
          {t('admin.common.retry')}
        </button>
      </main>
    );
  }

  const summary = (data.summary ?? {}) as {
    totalSlots?: number;
    byStatus?: Record<string, number>;
    desiredTotal?: number;
    currentUniqueCoverage?: number;
    dirty?: boolean;
    lastAnalyzerRun?: { id?: string; finishedAt?: string } | null;
  };
  const columns = (data.columns ?? {}) as Record<string, SlotCard[]>;
  const labels = (data.columnLabelsRu ?? {}) as Record<string, string>;
  const slots = (data.itemsFlat ?? []) as SlotCard[];
  const byStatus = summary.byStatus ?? {};

  return (
    <main className="admin-workspace" data-testid="recipe-coverage-board">
      <h1>{t('admin.coverage.title')}</h1>
      <p data-testid="coverage-workspace-label">{t('admin.coverage.workspaceLabel')}</p>
      <div className="admin-toolbar">
        <label>
          {t('admin.coverage.matrix')}
          <input
            defaultValue={searchParams.get('matrixVersion') ?? 'coverage-core-v1'}
            onBlur={(event) => update({ matrixVersion: event.target.value || undefined })}
          />
        </label>
        <label>
          {t('admin.coverage.priority')}
          <select
            value={searchParams.get('priority') ?? ''}
            onChange={(event) => update({ priority: event.target.value || undefined })}
          >
            <option value="">{t('admin.common.all')}</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
          </select>
        </label>
        <label>
          {t('admin.coverage.status')}
          <select
            aria-label={t('admin.coverage.status')}
            value={searchParams.get('status') ?? ''}
            onChange={(event) => update({ status: event.target.value || undefined })}
          >
            <option value="">{t('admin.common.all')}</option>
            {COLUMN_ORDER.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status, labels[status])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.coverage.mealType')}
          <input
            defaultValue={searchParams.get('mealType') ?? ''}
            onBlur={(event) => update({ mealType: event.target.value || undefined })}
          />
        </label>
      </div>
      <p data-testid="coverage-summary">
        {t('admin.coverage.summaryTotal')}: {summary.totalSlots ?? slots.length}
        {COLUMN_ORDER.map(
          (status) => ` · ${statusLabel(status, labels[status])}: ${byStatus[status] ?? 0}`,
        ).join('')}
        {' · '}
        {t('admin.coverage.summaryDesired')} {summary.desiredTotal ?? 0} · {t('admin.coverage.summaryUnique')}{' '}
        {summary.currentUniqueCoverage ?? 0}
        {summary.dirty ? ` · ${t('admin.coverage.dirty')}` : ''}
        {summary.lastAnalyzerRun
          ? ` · ${(summary.lastAnalyzerRun as { completedAt?: string }).completedAt ?? summary.lastAnalyzerRun.finishedAt ?? ''}`
          : ` · ${t('admin.coverage.analyzerNeverRun')}`}
      </p>
      <div role="tablist" className="admin-toolbar">
        <button type="button" aria-current={mode === 'board' ? 'page' : undefined} onClick={() => update({ mode: 'board' })}>
          {t('admin.coverage.board')}
        </button>
        <button type="button" aria-current={mode === 'table' ? 'page' : undefined} onClick={() => update({ mode: 'table' })}>
          {t('admin.coverage.table')}
        </button>
        <button
          type="button"
          aria-current={mode === 'analytics' ? 'page' : undefined}
          onClick={() => update({ mode: 'analytics' })}
        >
          {t('admin.coverage.analytics')}
        </button>
        <Link href="/admin/recipe-coverage/slots">{t('admin.coverage.slotDetails')}</Link>
      </div>

      {mode === 'board' ? (
        <div className="coverage-board-grid" data-testid="coverage-board-columns">
          {COLUMN_ORDER.map((status) => (
            <section key={status} className="coverage-board-column" data-testid={`coverage-column-${status}`}>
              <h2>
                {statusLabel(status, labels[status])} ({(columns[status] ?? []).length})
              </h2>
              {(columns[status] ?? []).map((slot) => (
                <article key={slot.id} className="coverage-slot-card">
                  <Link href={slot.detailHref ?? `/admin/recipe-coverage/slots?selected=${slot.id}`}>
                    {slot.displayName ?? slot.slotKey ?? slot.id.slice(0, 8)}
                  </Link>
                  <p>
                    {labelCoveragePriority(slot.priority)} · {labelMealType(slot.mealType)}
                  </p>
                  <p>
                    {slot.currentUniqueCount}/{slot.desiredCount}
                    {slot.dirty ? ` · ${t('admin.coverage.dirty')}` : ''}
                  </p>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : null}

      {mode === 'table' ? (
        <div className="admin-grid">
          <table data-testid="coverage-board-table">
            <thead>
              <tr>
                <th>{t('admin.coverage.column.slot')}</th>
                <th>{t('admin.coverage.status')}</th>
                <th>{t('admin.coverage.priority')}</th>
                <th>{t('admin.coverage.column.coverage')}</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id}>
                  <td>
                    <Link href={slot.detailHref ?? `/admin/recipe-coverage/slots?selected=${slot.id}`}>
                      {slot.displayName ?? slot.slotKey}
                    </Link>
                  </td>
                  <td>{slot.statusLabelRu ?? statusLabel(slot.status)}</td>
                  <td>{slot.priority ?? '—'}</td>
                  <td>
                    {slot.currentUniqueCount}/{slot.desiredCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {mode === 'analytics' ? (
        <section data-testid="coverage-analytics">
          {COLUMN_ORDER.map((status) => (
            <article key={status}>
              <h2>{statusLabel(status, labels[status])}</h2>
              <p>
                {byStatus[status] ?? 0} {t('admin.coverage.column.slot').toLowerCase()}
              </p>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
