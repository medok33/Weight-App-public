'use client';

import { useState } from 'react';
import { requestDestructiveReauth } from '../api/destructive-reauth.client';
import { useI18n } from '../../../i18n/locale-provider';

export function DestructiveReauthScreen() {
  const { t } = useI18n();
  const [action, setAction] = useState('owner.delete-user');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'forbidden' | 'error' | 'success'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    try {
      const result = await requestDestructiveReauth(action, confirmation);
      setMessage(t('owner.reauth.successExpires', { expiresAt: result.expiresAt }));
      setState('success');
    } catch (error) {
      setState(
        error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN' ? 'forbidden' : 'error',
      );
    }
  }

  return (
    <main>
      <h1>{t('owner.reauth.title')}</h1>
      <form onSubmit={submit}>
        <label htmlFor="destructive-action">{t('owner.reauth.action')}</label>
        <input
          id="destructive-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <label htmlFor="destructive-confirmation">{t('owner.reauth.confirmLabel')}</label>
        <input
          id="destructive-confirmation"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <button type="submit" disabled={state === 'loading'}>
          {t('owner.reauth.submit')}
        </button>
      </form>
      {state === 'loading' ? <p aria-busy="true">{t('owner.reauth.checking')}</p> : null}
      {state === 'forbidden' ? <p role="alert">{t('owner.reauth.forbidden')}</p> : null}
      {state === 'error' ? <p role="alert">{t('owner.reauth.error')}</p> : null}
      {state === 'success' ? <p role="status">{message}</p> : null}
    </main>
  );
}
