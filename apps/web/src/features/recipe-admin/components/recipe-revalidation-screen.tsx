'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../../i18n/locale-provider';
import type { AdminMessageKey } from '../../../i18n/admin-message-keys';
import { labelOrEnum } from '../../../i18n/admin-label';

type TaskRow = {
  id: string;
  recipeVersionId: string;
  recipeId: string;
  recipeName: string;
  versionNumber: number;
  productId: string;
  productName: string;
  reasonCode: string;
  severity: string;
  status: string;
  occurrenceCount: number;
  lifecycleStatus: string | null;
  validationStatus: string | null;
  usedInHistoricalPlan: boolean;
  lastDetectedAt: string;
  resolutionNote?: string | null;
};

const STATUS_KEYS: Record<string, AdminMessageKey> = {
  OPEN: 'admin.revalidation.status.OPEN',
  RESOLVED: 'admin.revalidation.status.RESOLVED',
  DISMISSED: 'admin.revalidation.status.DISMISSED',
};

const SEVERITY_KEYS: Record<string, AdminMessageKey> = {
  WARNING: 'admin.revalidation.severity.WARNING',
  HIGH: 'admin.revalidation.severity.HIGH',
  CRITICAL: 'admin.revalidation.severity.CRITICAL',
};

export function RecipeRevalidationScreen() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<TaskRow[]>([]);
  const [status, setStatus] = useState(searchParams.get('status') ?? 'OPEN');
  const [severity, setSeverity] = useState(searchParams.get('severity') ?? '');
  const [reason, setReason] = useState(searchParams.get('reason') ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('taskId'));
  const [note, setNote] = useState('Проверено владельцем');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (severity) params.set('severity', severity);
    if (reason) params.set('reason', reason);
    return params.toString();
  }, [status, severity, reason]);

  async function reload() {
    setState('loading');
    try {
      const response = await fetch(`/api/admin/recipe-revalidation?${query}`, { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) throw new Error('load_failed');
      const data = (await response.json()) as { items: TaskRow[] };
      const list = data.items ?? [];
      setItems(list);
      const wanted = searchParams.get('taskId');
      if (wanted && list.some((item) => item.id === wanted)) setSelectedId(wanted);
      else if (!selectedId && list[0]) setSelectedId(list[0].id);
      setState('success');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    void reload();
  }, [query, searchParams.toString()]);

  async function resolve(taskId: string, resolutionCode: string) {
    setMessage(null);
    const response = await fetch(`/api/admin/recipe-revalidation/${taskId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolutionCode, resolutionNote: note }),
    });
    const text = await response.text();
    setMessage(response.ok ? t('admin.revalidation.resolved') : text);
    await reload();
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true">
        {t('admin.revalidation.loading')}
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main data-testid="admin-recipe-revalidation-forbidden">{t('admin.revalidation.forbidden')}</main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert">{t('admin.revalidation.unavailable')}</main>
    );
  }

  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <main data-testid="admin-recipe-revalidation" style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <p>
        <Link href="/admin/recipes">{t('admin.common.backToRecipes')}</Link>
      </p>
      <h1>{t('admin.revalidation.title')}</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label>
          {t('admin.revalidation.filterStatus')}
          <select data-testid="reval-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(STATUS_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(STATUS_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.revalidation.filterSeverity')}
          <select
            data-testid="reval-filter-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(SEVERITY_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(SEVERITY_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.revalidation.filterReason')}
          <input
            data-testid="reval-filter-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      {message ? (
        <p role="status" data-testid="reval-message">
          {message}
        </p>
      ) : null}
      <ul data-testid="reval-task-list" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.id}
            style={{
              borderBottom: '1px solid #ddd',
              padding: '0.75rem 0',
              background: item.id === selectedId ? '#eef6ff' : undefined,
            }}
            data-testid={`reval-task-${item.id}`}
            data-selected={item.id === selectedId ? 'true' : 'false'}
          >
            <button type="button" onClick={() => setSelectedId(item.id)}>
              {labelOrEnum(t, item.severity, SEVERITY_KEYS)} · {item.reasonCode} · {item.recipeName} v
              {item.versionNumber}
            </button>
            <div style={{ fontSize: '0.85rem' }}>
              {t('admin.revalidation.product')}: {item.productName} · {item.lifecycleStatus ?? '—'} /{' '}
              {item.validationStatus ?? '—'} · {item.occurrenceCount} {t('admin.revalidation.occurrences')}
              {item.usedInHistoricalPlan ? ` · ${t('admin.revalidation.usedInHistorical')}` : ''}
              <br />
              {t('admin.revalidation.detected')} {String(item.lastDetectedAt)}
            </div>
          </li>
        ))}
      </ul>
      {selected ? (
        <section data-testid="reval-task-detail" style={{ marginTop: 16 }}>
          <h2>{t('admin.revalidation.taskDetail')}</h2>
          <p>
            {selected.recipeName} v{selected.versionNumber} · {selected.reasonCode} ·{' '}
            {labelOrEnum(t, selected.severity, SEVERITY_KEYS)}
          </p>
          <p>
            {t('admin.revalidation.product')}: {selected.productName}
          </p>
          <details>
            <summary>{t('admin.common.technicalDetails')}</summary>
            <p>{selected.productId}</p>
          </details>
          <p>
            {t('admin.revalidation.versionValidation')}: {selected.validationStatus} ·{' '}
            {t('admin.revalidation.historicalPlan')}: {selected.usedInHistoricalPlan ? t('admin.common.yes') : t('admin.common.no')}
          </p>
          <label>
            {t('admin.revalidation.resolutionNote')}
            <input
              data-testid="reval-resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              data-testid="reval-confirm-current"
              onClick={() => void resolve(selected.id, 'CONFIRM_CURRENT_VERSION')}
            >
              {t('admin.revalidation.confirmCurrent')}
            </button>
            <button
              type="button"
              data-testid="reval-create-corrected"
              onClick={() => void resolve(selected.id, 'CREATE_CORRECTED_VERSION')}
            >
              {t('admin.revalidation.createCorrected')}
            </button>
            <button
              type="button"
              data-testid="reval-suspend"
              onClick={() => void resolve(selected.id, 'SUSPEND_VERSION')}
            >
              {t('admin.revalidation.suspend')}
            </button>
            <button
              type="button"
              data-testid="reval-archive"
              onClick={() => void resolve(selected.id, 'ARCHIVE_VERSION')}
            >
              {t('admin.revalidation.archive')}
            </button>
            <button type="button" data-testid="reval-dismiss" onClick={() => void resolve(selected.id, 'DISMISS')}>
              {t('admin.revalidation.dismiss')}
            </button>
          </div>
          <p>
            <Link href={`/admin/recipes/${selected.recipeId}`} data-testid="reval-open-recipe">
              {t('admin.revalidation.openWorkspace')}
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
