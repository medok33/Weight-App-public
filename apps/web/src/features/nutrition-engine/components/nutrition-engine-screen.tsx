'use client';

import type { NutritionSummary } from '../model/nutrition-engine.types';
import { useI18n } from '@/i18n/locale-provider';

export function NutritionEngineScreen({ summary }: { summary?: NutritionSummary }) {
  const { t } = useI18n();
  if (!summary) {
    return <main aria-busy="true"><h1>{t('nutrition.title')}</h1><p>{t('nutrition.loading')}</p></main>;
  }
  return (
    <main>
      <h1>{t('nutrition.title')}</h1>
      <p>{summary.explanation}</p>
      <p>{t('nutrition.dailyTarget', { kcal: summary.targetKcal })}</p>
    </main>
  );
}
