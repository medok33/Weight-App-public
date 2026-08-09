'use client';

import { useEffect, useState } from 'react';
import { getAIControl, setAIControl } from '../api/ai-assistant.client';
import type { AIControl } from '../model/ai-assistant.types';
import { useI18n } from '../../../i18n/locale-provider';

export function OwnerAIControlScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'error' | 'success'>('loading');
  const [control, setControl] = useState<AIControl | null>(null);

  useEffect(() => {
    getAIControl()
      .then((x) => {
        setControl(x);
        setState('success');
      })
      .catch(() => setState('error'));
  }, []);

  if (state === 'loading') {
    return (
      <main aria-busy="true">
        <h1>{t('owner.aiControl.title')}</h1>
        <p>{t('owner.aiControl.loading')}</p>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main role="alert">
        <h1>{t('owner.aiControl.title')}</h1>
        <p>{t('owner.aiControl.error')}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{t('owner.aiControl.title')}</h1>
      <p>
        {t('owner.aiControl.killSwitch', {
          status: control?.enabled ? t('owner.aiControl.on') : t('owner.aiControl.off'),
        })}
      </p>
      <button
        type="button"
        onClick={() => setAIControl(!control?.enabled).then(setControl).catch(() => undefined)}
      >
        {control?.enabled ? t('owner.aiControl.disable') : t('owner.aiControl.enable')}
      </button>
    </main>
  );
}
