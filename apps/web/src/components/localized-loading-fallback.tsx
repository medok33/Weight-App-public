'use client';

import { LoadingState } from './ui-state';
import { useI18n } from '@/i18n/locale-provider';
import type { MessageKey } from '@/i18n/types';

export function LocalizedLoadingFallback({ titleKey }: { titleKey?: MessageKey }) {
  const { t } = useI18n();
  return (
    <main aria-busy="true">
      {titleKey ? <h1>{t(titleKey)}</h1> : null}
      <LoadingState message={t('common.loading')} />
    </main>
  );
}
