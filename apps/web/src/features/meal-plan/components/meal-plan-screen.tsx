'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getMealPlan, getMealPlanDay } from '../api/meal-plan.client';
import type { MealPlanDayDetail, MealPlanSummary } from '../model/meal-plan.types';
import { useI18n } from '../../../i18n/locale-provider';
import { apiErrorMessage } from '@/lib/api-fetch';
import { PlanRevisionPanel } from '../../revision-engine/components/plan-revision-panel';
import { MealSubstitutionPanel } from './meal-substitution-panel';
import type { MessageKey } from '../../../i18n/types';

function mealTypeKey(mealType: string): MessageKey {
  const key = `meal.mealType.${mealType}` as MessageKey;
  return key;
}

export function MealPlanScreen() {
  const { t, tc } = useI18n();
  const [plan, setPlan] = useState<MealPlanSummary | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [day, setDay] = useState<MealPlanDayDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'empty' | 'success'>('loading');
  const [message, setMessage] = useState<string | undefined>();

  async function loadPlan() {
    const next = await getMealPlan();
    if (!next.days?.length) {
      setStatus('empty');
      setPlan(null);
      return;
    }
    setPlan(next);
    setStatus('success');
  }

  async function loadDay(index: number, planId?: string) {
    const detail = await getMealPlanDay(index, planId);
    setDay(detail);
  }

  useEffect(() => {
    loadPlan()
      .catch((error: unknown) => {
        setStatus('error');
        setMessage(apiErrorMessage(error));
      });
  }, [t]);

  useEffect(() => {
    if (!plan) return;
    loadDay(dayIndex, plan.planId).catch((error: unknown) => {
      setStatus('error');
      setMessage(apiErrorMessage(error));
    });
  }, [plan?.planId, dayIndex]);

  if (status === 'loading') {
    return (
      <main aria-busy="true">
        <h1>{t('meal.title')}</h1>
        <p>{t('meal.loading')}</p>
      </main>
    );
  }
  if (status === 'error') {
    return (
      <main role="alert">
        <h1>{t('meal.title')}</h1>
        <p>{message}</p>
      </main>
    );
  }
  if (status === 'empty' || !plan) {
    return (
      <main>
        <h1>{t('meal.title')}</h1>
        <p>{t('meal.empty')}</p>
      </main>
    );
  }

  return (
    <main>
      <h1 data-testid="meal-heading">{t('meal.title')}</h1>
      <p data-testid="meal-plan-version">
        {t('meal.version')} {plan.version}
        {plan.personalized ? ` · ${t('meal.personalized')}` : ''}
      </p>
      {plan.targetKcal ? (
        <p data-testid="meal-plan-targets">
          {t('meal.target')} {plan.targetKcal} {t('unit.kcal')} · {plan.proteinG ?? 0}г {t('meal.proteinLabel')} ·{' '}
          {plan.fatG ?? 0}г {t('meal.fatLabel')} · {plan.carbsG ?? 0}г {t('meal.carbsLabel')}
        </p>
      ) : (
        <p data-testid="meal-plan-targets">{t('meal.fillProfile')}</p>
      )}

      <div data-testid="meal-day-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0' }}>
        {plan.days.map((item) => (
          <button
            key={item.dayIndex}
            type="button"
            data-testid={`meal-day-tab-${item.dayIndex}`}
            aria-pressed={item.dayIndex === dayIndex}
            onClick={() => setDayIndex(item.dayIndex)}
          >
            {t('meal.selectDay')} {item.dayIndex + 1}
          </button>
        ))}
      </div>

      {day ? (
        <section data-testid="meal-day-detail">
          <h2 data-testid={`meal-day-${day.dayIndex}`}>
            {t('meal.day')} {day.dayIndex + 1}
          </h2>
          <p data-testid="meal-day-target">
            {t('meal.dayTarget')}: {Math.round(day.target.calories)} {t('unit.kcal')} · Б {Math.round(day.target.proteinG)} · Ж{' '}
            {Math.round(day.target.fatG)} · У {Math.round(day.target.carbsG)}
          </p>
          <p data-testid="meal-day-planned">
            {t('meal.dayPlanned')}: {Math.round(day.planned.calories)} {t('unit.kcal')} · Б {Math.round(day.planned.proteinG)} · Ж{' '}
            {Math.round(day.planned.fatG)} · У {Math.round(day.planned.carbsG)} · {day.mealCount} приёмов
          </p>
          {day.calorieMismatch ? (
            <p role="status" data-testid="meal-day-mismatch">
              {t('meal.mismatch')}: {day.mismatchMessage}
            </p>
          ) : null}

          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
            {day.items.map((item) => (
              <li
                key={item.mealItemId}
                data-testid={`meal-card-${item.mealItemId}`}
                style={{ border: '1px solid #d7e0d7', borderRadius: '12px', padding: '1rem' }}
              >
                <p data-testid={`meal-card-type-${item.mealItemId}`}>
                  {t(mealTypeKey(item.mealType))}
                  {item.plannedTime ? ` · ${item.plannedTime}` : ''}
                </p>
                <h3 data-testid={`meal-card-name-${item.mealItemId}`}>{tc('meal', item.dishName)}</h3>
                <p>
                  {t('meal.portion')}: {item.portionLabel}
                </p>
                <p data-testid={`meal-card-macros-${item.mealItemId}`}>
                  {Math.round(item.calories)} {t('unit.kcal')} · Б {item.proteinG} · Ж {item.fatG} · У {item.carbsG}
                </p>
                <p>
                  {t('meal.cookTime')}:{' '}
                  {item.totalMinutes != null ? `${item.totalMinutes} мин` : t('meal.noData')}
                </p>
                <p data-testid={`meal-card-cost-${item.mealItemId}`}>
                  {t('meal.cost')}:{' '}
                  {item.cost.consumedCostRub != null
                    ? `${item.cost.consumedCostRub.toFixed(0)} ${t('unit.currency')} (${t('meal.costConsumed')})`
                    : t('meal.costMissing')}
                  {item.cost.status === 'partial' ? ` · ${t('meal.costPartial')}` : ''}
                </p>
                {item.allergens.length ? (
                  <p data-testid={`meal-card-allergens-${item.mealItemId}`}>
                    {t('meal.allergens')}: {item.allergens.join(', ')}
                  </p>
                ) : null}
                {item.dietaryTags.length ? <p>{t('meal.dietary')}: {item.dietaryTags.join(', ')}</p> : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <Link href={`/meal-plan/items/${item.mealItemId}`} data-testid={`meal-card-details-${item.mealItemId}`}>
                    {t('meal.details')}
                  </Link>
                  <MealSubstitutionPanel
                    mealItemId={item.mealItemId}
                    dishName={item.dishName}
                    ingredientProductIds={item.substitutionReady?.ingredientProductIds ?? []}
                    ingredients={item.substitutionReady?.ingredients ?? []}
                    onConfirmed={async () => {
                      await loadPlan();
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PlanRevisionPanel
        planId={plan.planId}
        planKind="meal"
        currentVersion={plan.version}
        onConfirmed={loadPlan}
      />
    </main>
  );
}
