'use client';

import { useEffect, useState } from 'react';
import { getFeatureFlags, setFeatureFlag } from '../api/feature-flags.client';
import type { FeatureFlag } from '../model/feature-flags.types';
import { useI18n } from '../../../i18n/locale-provider';

export function FeatureFlagsScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'forbidden' | 'error' | 'empty' | 'success'>('loading');
  const [items, setItems] = useState<FeatureFlag[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getFeatureFlags()
      .then((r) => {
        setItems(r.items);
        setState(r.items.length ? 'success' : 'empty');
      })
      .catch((e) => setState(e instanceof Error && e.message === 'OWNER_ACCESS_FORBIDDEN' ? 'forbidden' : 'error'));
  }, []);

  async function toggle(flag: FeatureFlag) {
    setMessage(t('common.saving'));
    try {
      const next = await setFeatureFlag(flag.key, !flag.enabled);
      setItems((current) => current.map((item) => (item.key === next.key ? next : item)));
      setMessage(t('admin.flags.saved'));
    } catch {
      setMessage(t('admin.flags.saveError'));
    }
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true">
        <h1>{t('admin.flags.title')}</h1>
        <p>{t('admin.flags.loading')}</p>
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main role="alert">
        <h1>{t('admin.flags.title')}</h1>
        <p>{t('admin.flags.forbidden')}</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert">
        <h1>{t('admin.flags.title')}</h1>
        <p>{t('admin.flags.error')}</p>
      </main>
    );
  }
  if (state === 'empty') {
    return (
      <main>
        <h1>{t('admin.flags.title')}</h1>
        <p>{t('admin.flags.empty')}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{t('admin.flags.title')}</h1>
      <ul>
        {items.map((flag) => (
          <li key={flag.key}>
            <span>
              {flag.key}: {flag.enabled ? t('admin.flags.enabled') : t('admin.flags.disabled')}
            </span>
            <button type="button" onClick={() => toggle(flag)}>
              {flag.enabled ? t('admin.flags.disable') : t('admin.flags.enable')}
            </button>
          </li>
        ))}
      </ul>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
