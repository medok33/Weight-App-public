'use client';

import { useId, useState } from 'react';
import {
  cancelPlanRevision,
  confirmPlanRevision,
  previewPlanRevision,
  revisionErrorMessage,
} from '../api/revision-engine.client';
import type { PlanKind, PreviewRevisionResponse } from '../model/revision-engine.types';
import { useI18n } from '../../../i18n/locale-provider';

type Props = {
  planId?: string;
  planKind: PlanKind;
  currentVersion?: number;
  onConfirmed?: () => void | Promise<void>;
};

type UiStatus = 'idle' | 'loading' | 'preview' | 'success' | 'error' | 'forbidden' | 'conflict';

function createIdempotencyKey(planKind: PlanKind): string {
  return `rev-${planKind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PlanRevisionPanel({ planId, planKind, currentVersion, onConfirmed }: Props) {
  const { t } = useI18n();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PreviewRevisionResponse | null>(null);
  const [status, setStatus] = useState<UiStatus>('idle');
  const [message, setMessage] = useState<string | undefined>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey(planKind));
  const [confirming, setConfirming] = useState(false);

  if (!planId) return null;

  function openPanel() {
    setIdempotencyKey(createIdempotencyKey(planKind));
    setPreview(null);
    setMessage(undefined);
    setStatus('idle');
    setOpen(true);
  }

  async function showPreview() {
    if (!reason.trim()) {
      setMessage('Укажите корректную причину изменения');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setMessage(undefined);
    try {
      const next = await previewPlanRevision(planId!, { planKind, reason });
      setPreview(next);
      setStatus('preview');
    } catch (error) {
      setPreview(null);
      const text = revisionErrorMessage(error, t('revision.previewError'));
      setMessage(text);
      setStatus(text.includes('доступа') ? 'forbidden' : 'error');
    }
  }

  async function confirm() {
    if (!preview || confirming) return;
    setConfirming(true);
    setStatus('loading');
    try {
      const result = await confirmPlanRevision(
        planId!,
        { planKind, confirmationToken: preview.confirmationToken },
        idempotencyKey,
      );
      setMessage(
        result.idempotentReplay
          ? t('revision.replaySuccess')
          : `${t('revision.success')} v${result.activeVersion}`,
      );
      setStatus('success');
      setPreview(null);
      setOpen(false);
      setIdempotencyKey(createIdempotencyKey(planKind));
      await onConfirmed?.();
    } catch (error) {
      const text = revisionErrorMessage(error, t('revision.confirmError'));
      setMessage(text);
      setStatus(text.includes('Конфликт') || text.includes('ключ') ? 'conflict' : 'error');
    } finally {
      setConfirming(false);
    }
  }

  async function cancel() {
    try {
      await cancelPlanRevision(planId!, planKind);
    } catch {
      // cancel is best-effort analytics
    }
    setPreview(null);
    setStatus('idle');
    setOpen(false);
    setMessage(undefined);
  }

  return (
    <section data-testid={`revision-panel-${planKind}`} style={{ marginTop: '1.5rem' }}>
      {!open ? (
        <div>
          <button type="button" data-testid="revision-open" onClick={openPanel}>
            {t('revision.open')}
          </button>
          {message ? (
            <p role="alert" data-testid="revision-message">
              {message}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <h2>{t('revision.title')}</h2>
          {currentVersion != null ? (
            <p data-testid="revision-source-version">
              {t('revision.currentVersion')} {currentVersion}
            </p>
          ) : null}
          <label htmlFor={reasonId}>{t('revision.reason')}</label>
          <textarea
            id={reasonId}
            data-testid="revision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              data-testid="revision-preview"
              onClick={showPreview}
              disabled={status === 'loading' || confirming}
            >
              {t('revision.showChanges')}
            </button>
            <button type="button" data-testid="revision-cancel" onClick={cancel}>
              {t('revision.cancel')}
            </button>
          </div>

          {status === 'loading' ? <p aria-busy="true">{t('revision.loading')}</p> : null}
          {message && status !== 'preview' ? (
            <p role="alert" data-testid="revision-message">
              {message}
            </p>
          ) : null}

          {preview ? (
            <div data-testid="revision-preview-result" style={{ marginTop: '1rem' }}>
              <p>{preview.summary}</p>
              <p data-testid="revision-proposed-version">
                {t('revision.proposedVersion')} {preview.proposedVersion}
              </p>
              {preview.warnings.length ? (
                <ul data-testid="revision-warnings">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <h3>{t('revision.changes')}</h3>
              {preview.changedItems.length === 0 ? (
                <p>{t('revision.noChanges')}</p>
              ) : (
                <ul>
                  {preview.changedItems.map((item) => (
                    <li key={item.path} data-testid="revision-change-item">
                      <strong>{item.path}</strong>: {item.previousValue} → {item.proposedValue}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  data-testid="revision-confirm"
                  onClick={confirm}
                  disabled={status === 'loading' || confirming}
                >
                  {t('revision.confirm')}
                </button>
                <button type="button" data-testid="revision-discard" onClick={cancel}>
                  {t('revision.discard')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
