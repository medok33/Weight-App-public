'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createExportJob,
  createShareLink,
  getDownloadLink,
  getShareAdapters,
  listExportJobs,
  revokeShareLink,
} from '../api/export-share.client';
import type { ExportJobView, ShareAdapter, ShareLinkView } from '../model/export-share.types';
import { useI18n } from '@/i18n/locale-provider';
import type { MessageKey } from '@/i18n/types';

type UiState = 'loading' | 'idle' | 'empty' | 'error' | 'forbidden' | 'success';

const DOCUMENTS = [
  { type: 'meal_plan_pdf' as const, labelKey: 'export.mealPlanPdf' as const },
  { type: 'shopping_list_print' as const, labelKey: 'export.shoppingPrint' as const },
];

export function ExportShareScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<UiState>('loading');
  const [jobs, setJobs] = useState<ExportJobView[]>([]);
  const [active, setActive] = useState<ExportJobView | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [share, setShare] = useState<ShareLinkView | null>(null);
  const [adapters, setAdapters] = useState<ShareAdapter[]>([]);
  const [, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listExportJobs();
      setJobs(list);
      setState(list.length ? 'success' : 'empty');
    } catch (error) {
      setState(error instanceof Error && error.message === 'FORBIDDEN' ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(type: 'meal_plan_pdf' | 'shopping_list_print') {
    setState('loading');
    setMessage(null);
    setDownloadPath(null);
    setShare(null);
    setAdapters([]);
    try {
      const created = await createExportJob(type, `web-${type}-${Date.now()}`);
      setActive(created);
      await refresh();
      if (created.status === 'succeeded') {
        const link = await getDownloadLink(created.id);
        setDownloadPath(link.path);
        const links = await getShareAdapters(created.id);
        setAdapters(links);
        setState('success');
      } else if (created.status === 'failed') {
        setMessage(created.errorCode ?? 'EXPORT_FAILED');
        setState('error');
      } else {
        setState('idle');
      }
    } catch {
      setMessage('EXPORT_CREATE_FAILED');
      setState('error');
    }
  }

  async function onShare() {
    if (!active?.id) return;
    try {
      const created = await createShareLink(active.id, 60);
      setShare(created);
    } catch {
      setMessage('SHARE_CREATE_FAILED');
      setState('error');
    }
  }

  async function onRevoke() {
    if (!share?.id) return;
    try {
      await revokeShareLink(share.id);
      setShare({ ...share, revokedAt: new Date().toISOString() });
    } catch {
      setMessage('SHARE_REVOKE_FAILED');
    }
  }

  if (state === 'forbidden') {
    return (
      <main role="alert" data-testid="documents-forbidden">
        <h1>{t('export.title')}</h1>
        <p>{t('export.signIn')}</p>
      </main>
    );
  }

  return (
    <main data-testid="export-share-screen">
      <h1 data-testid="documents-heading">{t('export.title')}</h1>
      <section data-testid="documents-catalog">
        <h2>{t('export.available')}</h2>
        <ul>
          {DOCUMENTS.map((doc) => (
            <li key={doc.type}>
              <button type="button" data-testid={`export-doc-${doc.type}`} onClick={() => run(doc.type)}>
                {t(doc.labelKey)}
              </button>
            </li>
          ))}
        </ul>
        <p>
          <a href="/api/export-share/shopping-print" data-testid="export-shopping-preview" target="_blank" rel="noreferrer">
            {t('export.shoppingPreview')}
          </a>
        </p>
      </section>

      {state === 'loading' ? <p data-testid="export-loading">{t('export.creating')}</p> : null}
      {state === 'error' ? (
        <p role="alert" data-testid="export-error">
          {t('export.error')}
        </p>
      ) : null}

      {active ? (
        <section data-testid="export-active-job">
          <h2>{t('export.current')}</h2>
          <p data-testid="export-job-status">
            {t(`export.type.${active.type}` as MessageKey)} · {t(`export.status.${active.status}` as MessageKey)}
            {active.result?.fileName ? ` · ${active.result.fileName}` : ''}
          </p>
          {downloadPath ? (
            <p>
              <a href={`/api${downloadPath}`} data-testid="export-download-link" target="_blank" rel="noreferrer">
                {t('export.download')}
              </a>
            </p>
          ) : null}
          {active.status === 'succeeded' ? (
            <p>
              <button type="button" data-testid="export-create-share" onClick={() => void onShare()}>
                {t('export.createShare')}
              </button>
            </p>
          ) : null}
          {share ? (
            <p data-testid="export-share-link">
              {t('export.shareToken')}: {share.token.slice(0, 8)}… · {t('export.shareExpires')}: {share.expiresAt}
              {share.revokedAt ? ` (${t('export.shareRevoked')})` : ''}{' '}
              {!share.revokedAt ? (
                <button type="button" data-testid="export-revoke-share" onClick={() => void onRevoke()}>
                  {t('export.revoke')}
                </button>
              ) : null}
            </p>
          ) : null}
          <ul data-testid="export-share-adapters">
            {adapters.map((adapter) => (
              <li key={adapter.channel}>
                <a href={adapter.url} data-testid={`export-share-${adapter.channel}`}>
                  {['email', 'telegram'].includes(adapter.channel)
                    ? t(`export.channel.${adapter.channel}` as MessageKey)
                    : adapter.channel}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section data-testid="export-jobs-list">
        <h2>{t('export.recent')}</h2>
        {jobs.length === 0 ? <p data-testid="documents-empty">{t('export.empty')}</p> : null}
        <ul>
          {jobs.map((job) => (
            <li key={job.id} data-testid={`export-job-${job.id}`}>
              {t(`export.type.${job.type}` as MessageKey)} · {t(`export.status.${job.status}` as MessageKey)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
