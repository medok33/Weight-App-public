'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../../i18n/locale-provider';
import type { AdminMessageKey } from '../../../i18n/admin-message-keys';
import { labelOrEnum } from '../../../i18n/admin-label';

type Candidate = {
  id: string;
  classification: string;
  score: string | number;
  status: string;
  leftRecipeName: string;
  rightRecipeName: string;
  leftVersionNumber: number;
  rightVersionNumber: number;
  reasonsJson?: Array<{ code: string; detail: string }>;
};

const STATUS_KEYS: Record<string, AdminMessageKey> = {
  OPEN: 'admin.duplicates.status.OPEN',
  CONFIRMED_DUPLICATE: 'admin.duplicates.status.CONFIRMED_DUPLICATE',
  CONFIRMED_VARIANT: 'admin.duplicates.status.CONFIRMED_VARIANT',
  DISMISSED: 'admin.duplicates.status.DISMISSED',
};

const CLASS_KEYS: Record<string, AdminMessageKey> = {
  EXACT_DUPLICATE: 'admin.duplicates.class.EXACT_DUPLICATE',
  NEAR_DUPLICATE: 'admin.duplicates.class.NEAR_DUPLICATE',
  FAMILY_VARIANT: 'admin.duplicates.class.FAMILY_VARIANT',
  POSSIBLE_DUPLICATE: 'admin.duplicates.class.POSSIBLE_DUPLICATE',
};

export function RecipeDuplicatesScreen() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Candidate[]>([]);
  const [status, setStatus] = useState(searchParams.get('status') ?? 'OPEN');
  const [classification, setClassification] = useState(searchParams.get('classification') ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'forbidden' | 'error' | 'success'>('loading');
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [note, setNote] = useState('Проверено владельцем');

  async function reload() {
    setState('loading');
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (classification) params.set('classification', classification);
    const response = await fetch(`/api/admin/recipe-duplicates?${params}`, { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      setState('forbidden');
      return;
    }
    if (!response.ok) {
      setState('error');
      return;
    }
    const data = (await response.json()) as { items: Candidate[] };
    const list = data.items ?? [];
    setItems(list);
    const wanted = searchParams.get('candidateId');
    const found = wanted ? list.find((item) => item.id === wanted) ?? null : null;
    setSelected(found ?? list[0] ?? null);
    setState('success');
  }

  useEffect(() => {
    void reload();
  }, [status, classification, searchParams.toString()]);

  async function resolve(code: string) {
    if (!selected) return;
    const response = await fetch(`/api/admin/recipe-duplicates/${selected.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolutionCode: code, resolutionNote: note }),
    });
    setMessage(response.ok ? t('admin.duplicates.resolved') : await response.text());
    await reload();
  }

  if (state === 'loading') {
    return <main aria-busy="true">{t('admin.duplicates.loading')}</main>;
  }
  if (state === 'forbidden') {
    return <main data-testid="admin-recipe-duplicates-forbidden">{t('admin.duplicates.forbidden')}</main>;
  }
  if (state === 'error') {
    return <main role="alert">{t('admin.duplicates.unavailable')}</main>;
  }

  return (
    <main data-testid="admin-recipe-duplicates" style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <p>
        <Link href="/admin/recipes">{t('admin.common.backToRecipes')}</Link>
      </p>
      <h1>{t('admin.duplicates.title')}</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>
          {t('admin.duplicates.filterStatus')}
          <select data-testid="dup-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(STATUS_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(STATUS_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.duplicates.filterClassification')}
          <select
            data-testid="dup-filter-class"
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          >
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(CLASS_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(CLASS_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message ? <p role="status">{message}</p> : null}
      <ul data-testid="dup-candidate-list" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => (
          <li key={item.id} style={{ borderBottom: '1px solid #ddd', padding: '0.75rem 0' }}>
            <button type="button" onClick={() => setSelected(item)}>
              {labelOrEnum(t, item.classification, CLASS_KEYS)} · {Number(item.score).toFixed(2)} ·{' '}
              {item.leftRecipeName} v{item.leftVersionNumber} ↔ {item.rightRecipeName} v{item.rightVersionNumber}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <section data-testid="dup-candidate-detail">
          <h2>{t('admin.duplicates.comparison')}</h2>
          <p>
            {selected.leftRecipeName} v{selected.leftVersionNumber} vs {selected.rightRecipeName} v
            {selected.rightVersionNumber}
          </p>
          <ul>
            {(selected.reasonsJson ?? []).map((reason) => (
              <li key={reason.code}>
                {reason.detail || reason.code}
              </li>
            ))}
          </ul>
          <label>
            {t('admin.common.note')}
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid="dup-confirm-duplicate" onClick={() => void resolve('CONFIRMED_DUPLICATE')}>
              {t('admin.duplicates.confirmDuplicate')}
            </button>
            <button type="button" data-testid="dup-confirm-variant" onClick={() => void resolve('CONFIRMED_VARIANT')}>
              {t('admin.duplicates.confirmVariant')}
            </button>
            <button type="button" data-testid="dup-dismiss" onClick={() => void resolve('DISMISSED')}>
              {t('admin.duplicates.dismiss')}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
