'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/locale-provider';
import type { AdminMessageKey } from '../../../i18n/admin-message-keys';
import { labelOrEnum } from '../../../i18n/admin-label';

type PilotReadiness = {
  implementationStatus?: string;
  liveExecutionStatus?: string;
  fixtureMode?: string;
  parserVersion?: string | null;
  contractVersion?: string | null;
  networkCalls?: number;
  publicationRights?: string;
  imageReuseRights?: string;
  circuitState?: string;
  enabled?: boolean;
  rightsStatus?: string;
  collectionMode?: string;
};

type SourceRow = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  adapterType: string;
  rightsStatus: string;
  rightsStatusLabelRu?: string;
  collectionMode: string;
  parserVersion: string;
  contractVersion?: string;
  rateLimitPerMinute: number;
  enabled: boolean;
  healthStatus: string;
  reviewExpiresAt: string | null;
  evidenceCount: number;
  blockingReason: string | null;
  policyReason: string | null;
  dataClass: string;
  allowedTransitions?: string[];
  evidence?: Array<{ id: string; evidenceType: string; decision: string; notes?: string | null }>;
  execution?: { eligibility: string; reason: string };
  pilotReadiness?: PilotReadiness;
};

const MODE_KEYS: Record<string, AdminMessageKey> = {
  DISABLED: 'admin.sources.mode.DISABLED',
  PUBLIC_FEED: 'admin.sources.mode.PUBLIC_FEED',
  MANUAL_REFERENCE_ONLY: 'admin.sources.mode.MANUAL_REFERENCE_ONLY',
  NOT_CONFIGURED: 'admin.sources.mode.NOT_CONFIGURED',
  TEST_DETERMINISTIC: 'admin.sources.mode.TEST_DETERMINISTIC',
  FOOD_RU: 'admin.sources.mode.FOOD_RU',
  IAMCOOK: 'admin.sources.mode.IAMCOOK',
  RUSSIANFOOD: 'admin.sources.mode.RUSSIANFOOD',
  CONTROLLED_HTML_RESEARCH: 'admin.sources.mode.CONTROLLED_HTML_RESEARCH',
  API: 'admin.sources.mode.API',
  LICENSED_FEED: 'admin.sources.mode.LICENSED_FEED',
  MANUAL_ENTRY: 'admin.sources.mode.MANUAL_ENTRY',
};

const RIGHTS_KEYS: Record<string, AdminMessageKey> = {
  PUBLIC_RESEARCH_ALLOWED: 'admin.sources.rights.PUBLIC_RESEARCH_ALLOWED',
  MANUAL_RESEARCH_ONLY: 'admin.sources.rights.MANUAL_RESEARCH_ONLY',
  ACTIVE_LICENSED: 'admin.sources.rights.ACTIVE_LICENSED',
  SUSPENDED: 'admin.sources.rights.SUSPENDED',
  DISABLED_BY_TERMS: 'admin.sources.rights.DISABLED_BY_TERMS',
  DISABLED_BY_REFUSAL: 'admin.sources.rights.DISABLED_BY_REFUSAL',
};

const EVIDENCE_TYPE_KEYS: Record<string, AdminMessageKey> = {
  OWNER_DECISION: 'admin.sources.evidenceType.OWNER_DECISION',
  TERMS_REVIEW: 'admin.sources.evidenceType.TERMS_REVIEW',
  PUBLICATION_POLICY: 'admin.sources.evidenceType.PUBLICATION_POLICY',
  CONTRACT: 'admin.sources.evidenceType.CONTRACT',
  REFUSAL: 'admin.sources.evidenceType.REFUSAL',
};

export function RecipeSourcesScreen() {
  const { t } = useI18n();
  const [items, setItems] = useState<SourceRow[]>([]);
  const [selected, setSelected] = useState<SourceRow | null>(null);
  const [state, setState] = useState<'loading' | 'forbidden' | 'error' | 'success'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createUrl, setCreateUrl] = useState('https://example.com');
  const [evidenceType, setEvidenceType] = useState('OWNER_DECISION');
  const [evidenceNotes, setEvidenceNotes] = useState('Проверены условия для ограниченного исследования');
  const [reviewStatus, setReviewStatus] = useState('PUBLIC_RESEARCH_ALLOWED');
  const [reviewReason, setReviewReason] = useState('Одобрено владельцем');

  function rightsLabel(row: Pick<SourceRow, 'rightsStatus' | 'rightsStatusLabelRu'>) {
    return row.rightsStatusLabelRu ?? labelOrEnum(t, row.rightsStatus, RIGHTS_KEYS);
  }

  function modeLabel(mode: string) {
    return labelOrEnum(t, mode, MODE_KEYS);
  }

  async function reload() {
    setState('loading');
    try {
      const response = await fetch('/api/admin/recipe-sources', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) throw new Error('load_failed');
      const data = (await response.json()) as { items: SourceRow[] };
      setItems(data.items ?? []);
      setState('success');
      if (selected) {
        const detail = await fetch(`/api/admin/recipe-sources/${selected.id}`, { cache: 'no-store' });
        if (detail.ok) setSelected((await detail.json()) as SourceRow);
      }
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function openSource(id: string) {
    const response = await fetch(`/api/admin/recipe-sources/${id}`, { cache: 'no-store' });
    if (!response.ok) {
      setMessage(await response.text());
      return;
    }
    setSelected((await response.json()) as SourceRow);
  }

  async function createSource() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/recipe-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: createCode,
          name: createName,
          baseUrl: createUrl,
          adapterType: 'NOT_CONFIGURED',
          collectionMode: 'DISABLED',
          dataClass: 'PRODUCTION',
        }),
      });
      setMessage(response.ok ? t('admin.sources.created') : await response.text());
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function addEvidence() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evidenceType,
          decision: 'ALLOW',
          notes: evidenceNotes,
        }),
      });
      setMessage(response.ok ? t('admin.sources.evidenceAdded') : await response.text());
      await openSource(selected.id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toStatus: reviewStatus,
          reason: reviewReason,
          collectionMode:
            reviewStatus === 'MANUAL_RESEARCH_ONLY' ? 'MANUAL_REFERENCE_ONLY' : 'PUBLIC_FEED',
          reviewExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        }),
      });
      setMessage(response.ok ? t('admin.sources.reviewDone') : await response.text());
      await openSource(selected.id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/enable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'OWNER enable after review' }),
      });
      setMessage(response.ok ? t('admin.sources.enabled') : await response.text());
      await openSource(selected.id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/disable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'OWNER suspend/disable' }),
      });
      setMessage(response.ok ? t('admin.sources.disabled') : await response.text());
      await openSource(selected.id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function healthCheck() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/health-check`, {
        method: 'POST',
      });
      setMessage(await response.text());
      await openSource(selected.id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function fixtureSearch() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/fixture-search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ primaryProductIds: ['synthetic'], resultLimit: 3 }),
      });
      setMessage(response.ok ? t('admin.sources.fixtureSearchDone') : await response.text());
      await openSource(selected.id);
    } finally {
      setBusy(false);
    }
  }

  async function liveProbe() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-sources/${selected.id}/live-probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setMessage(response.ok ? t('admin.sources.liveProbeDone') : await response.text());
      await openSource(selected.id);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <main className="admin-workspace" aria-busy="true">
        {t('admin.sources.loading')}
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main className="admin-workspace" data-testid="admin-recipe-sources-forbidden">
        {t('admin.sources.forbidden')}
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main className="admin-workspace" role="alert">
        {t('admin.sources.unavailable')}
      </main>
    );
  }

  return (
    <main className="admin-workspace" data-testid="admin-recipe-sources">
      <p>
        <Link href="/admin/content">{t('admin.common.backToContent')}</Link>
      </p>
      <h1>{t('nav.adminRecipeSources')}</h1>
      <p data-testid="recipe-sources-note">{t('admin.sources.note')}</p>
      {message ? (
        <p role="status" data-testid="recipe-sources-message">
          {message}
        </p>
      ) : null}

      <section data-testid="recipe-sources-create" className="admin-toolbar">
        <h2>{t('admin.sources.create')}</h2>
        <label>
          {t('admin.sources.col.code')}
          <input data-testid="source-create-code" value={createCode} onChange={(e) => setCreateCode(e.target.value)} />
        </label>
        <label>
          {t('admin.sources.col.name')}
          <input data-testid="source-create-name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
        </label>
        <label>
          {t('admin.sources.col.url')}
          <input data-testid="source-create-url" value={createUrl} onChange={(e) => setCreateUrl(e.target.value)} />
        </label>
        <button type="button" data-testid="source-create-submit" disabled={busy} onClick={() => void createSource()}>
          {t('admin.common.create')}
        </button>
      </section>

      <div className="admin-grid">
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table data-testid="recipe-sources-table">
            <thead>
              <tr>
                <th>{t('admin.sources.col.code')}</th>
                <th>{t('admin.sources.col.name')}</th>
                <th>{t('admin.sources.col.url')}</th>
                <th>{t('admin.sources.col.adapter')}</th>
                <th>{t('admin.sources.col.rights')}</th>
                <th>{t('admin.sources.col.mode')}</th>
                <th>{t('admin.sources.col.enabled')}</th>
                <th>{t('admin.sources.col.parser')}</th>
                <th>{t('admin.sources.col.rate')}</th>
                <th>{t('admin.sources.col.review')}</th>
                <th>{t('admin.sources.col.health')}</th>
                <th>{t('admin.sources.col.evidence')}</th>
                <th>{t('admin.sources.col.block')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-testid={`source-row-${item.code}`}>
                  <td>
                    <button type="button" onClick={() => void openSource(item.id)}>
                      {item.code}
                    </button>
                  </td>
                  <td>{item.name}</td>
                  <td>{item.baseUrl}</td>
                  <td>{modeLabel(item.adapterType)}</td>
                  <td>{rightsLabel(item)}</td>
                  <td>{modeLabel(item.collectionMode)}</td>
                  <td>{item.enabled ? t('admin.common.yes') : t('admin.common.no')}</td>
                  <td>{item.parserVersion}</td>
                  <td>{item.rateLimitPerMinute}</td>
                  <td>{item.reviewExpiresAt ? new Date(item.reviewExpiresAt).toLocaleDateString('ru-RU') : '—'}</td>
                  <td>{item.healthStatus}</td>
                  <td>{item.evidenceCount}</td>
                  <td>{item.blockingReason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <section data-testid="recipe-source-detail">
            <h2>
              {selected.name} · {selected.code}
            </h2>
            <p>
              {t('admin.sources.col.rights')}: {rightsLabel(selected)} · {t('admin.sources.col.mode')}:{' '}
              {modeLabel(selected.collectionMode)} · {t('admin.sources.col.enabled')}:{' '}
              {selected.enabled ? t('admin.common.yes') : t('admin.common.no')}
            </p>
            <p data-testid="source-blocking-reason">
              {t('admin.sources.blocking')}: {selected.blockingReason ?? selected.execution?.reason ?? '—'}
            </p>
            <p>
              {t('admin.sources.policy')}: {selected.policyReason ?? '—'}
            </p>
            {selected.code === 'food_ru' ||
            selected.code === 'iamcook' ||
            selected.code === 'russianfood' ||
            selected.adapterType === 'FOOD_RU' ||
            selected.adapterType === 'IAMCOOK' ||
            selected.adapterType === 'RUSSIANFOOD' ? (
              <section data-testid="food-ru-pilot-readiness">
                <h3>{t('admin.sources.pilot.title')}</h3>
                <p data-testid="food-ru-implementation">
                  {selected.pilotReadiness?.implementationStatus === 'IMPLEMENTED'
                    ? t('admin.sources.pilot.implemented')
                    : t('admin.sources.pilot.notImplemented')}
                </p>
                <p data-testid="food-ru-fixture-mode">
                  {selected.pilotReadiness?.fixtureMode === 'AVAILABLE'
                    ? t('admin.sources.pilot.fixtureAvailable')
                    : t('admin.sources.pilot.fixtureUnavailable')}
                </p>
                <p data-testid="food-ru-live-status">{t('admin.sources.pilot.liveBlocked')}</p>
                <p data-testid="multi-source-continuous">{t('admin.sources.pilot.continuousDisabled')}</p>
                <p data-testid="food-ru-network-calls">
                  {t('admin.sources.pilot.networkCalls')}: {selected.pilotReadiness?.networkCalls ?? 0}
                </p>
                <details>
                  <summary>{t('admin.common.technicalDetails')}</summary>
                  <p>
                    {t('admin.sources.pilot.parser')}:{' '}
                    {selected.pilotReadiness?.parserVersion ?? selected.parserVersion}
                  </p>
                  <p>
                    {t('admin.sources.pilot.contract')}:{' '}
                    {selected.pilotReadiness?.contractVersion ?? selected.contractVersion ?? '—'}
                  </p>
                  <p>
                    {t('admin.sources.pilot.circuit')}: {selected.pilotReadiness?.circuitState ?? '—'}
                  </p>
                  <p>
                    {t('admin.sources.pilot.rightsPublication')}: {t('admin.sources.pilot.notConfirmed')}
                  </p>
                  <p>
                    {t('admin.sources.pilot.rightsImages')}: {t('admin.sources.pilot.notConfirmed')}
                  </p>
                </details>
              </section>
            ) : null}
            <details>
              <summary>{t('admin.common.technicalDetails')}</summary>
              <p>
                {t('admin.sources.transitions')}: {(selected.allowedTransitions ?? []).join(', ') || '—'}
              </p>
              <p>{selected.id}</p>
            </details>

            <h3>{t('admin.sources.evidence')}</h3>
            <ul data-testid="source-evidence-list">
              {(selected.evidence ?? []).map((e) => (
                <li key={e.id}>
                  {labelOrEnum(t, e.evidenceType, EVIDENCE_TYPE_KEYS)} · {e.decision} · {e.notes ?? ''}
                </li>
              ))}
            </ul>
            <div className="admin-toolbar">
              <select
                data-testid="source-evidence-type"
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value)}
              >
                {Object.keys(EVIDENCE_TYPE_KEYS).map((code) => (
                  <option key={code} value={code}>
                    {t(EVIDENCE_TYPE_KEYS[code])}
                  </option>
                ))}
              </select>
              <input
                data-testid="source-evidence-notes"
                value={evidenceNotes}
                onChange={(e) => setEvidenceNotes(e.target.value)}
              />
              <button type="button" data-testid="source-evidence-add" disabled={busy} onClick={() => void addEvidence()}>
                {t('admin.sources.addEvidence')}
              </button>
            </div>

            <h3>{t('admin.sources.reviewEnable')}</h3>
            <div className="admin-toolbar">
              <select
                data-testid="source-review-status"
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value)}
              >
                {Object.keys(RIGHTS_KEYS).map((code) => (
                  <option key={code} value={code}>
                    {t(RIGHTS_KEYS[code])}
                  </option>
                ))}
              </select>
              <input
                data-testid="source-review-reason"
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
              />
              <button type="button" data-testid="source-review-submit" disabled={busy} onClick={() => void review()}>
                {t('admin.sources.review')}
              </button>
              <button type="button" data-testid="source-enable" disabled={busy} onClick={() => void enable()}>
                {t('admin.sources.enable')}
              </button>
              <button type="button" data-testid="source-disable" disabled={busy} onClick={() => void disable()}>
                {t('admin.sources.disable')}
              </button>
              <button
                type="button"
                data-testid="source-health-check"
                disabled={busy}
                onClick={() => void healthCheck()}
              >
                {t('admin.sources.healthCheck')}
              </button>
              {(selected.adapterType === 'FOOD_RU' ||
                selected.adapterType === 'IAMCOOK' ||
                selected.adapterType === 'RUSSIANFOOD' ||
                selected.adapterType === 'TEST_DETERMINISTIC') &&
              selected.dataClass !== 'PRODUCTION' ? (
                <button
                  type="button"
                  data-testid="source-fixture-search"
                  disabled={busy}
                  onClick={() => void fixtureSearch()}
                >
                  {t('admin.sources.fixtureSearch')}
                </button>
              ) : null}
              {selected.code === 'food_ru' ||
              selected.code === 'iamcook' ||
              selected.code === 'russianfood' ||
              selected.adapterType === 'FOOD_RU' ||
              selected.adapterType === 'IAMCOOK' ||
              selected.adapterType === 'RUSSIANFOOD' ? (
                <button
                  type="button"
                  data-testid="source-live-probe"
                  disabled={busy}
                  onClick={() => void liveProbe()}
                >
                  {t('admin.sources.liveProbe')}
                </button>
              ) : null}
            </div>
            <p data-testid="source-no-parse-actions">{t('admin.sources.noParseActions')}</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
