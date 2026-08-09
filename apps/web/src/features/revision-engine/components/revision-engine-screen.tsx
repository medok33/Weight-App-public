'use client';

import { PlanRevisionPanel } from './plan-revision-panel';
import { useI18n } from '../../../i18n/locale-provider';

/** Standalone screen for STEP_100 route; panels are also embedded in meal/workout pages. */
export function RevisionEngineScreen() {
  const { t } = useI18n();
  return (
    <main>
      <h1 data-testid="revision-heading">{t('revision.pageTitle')}</h1>
      <p>{t('revision.pageHint')}</p>
      <p>{t('revision.usePlanPages')}</p>
    </main>
  );
}

export { PlanRevisionPanel };
