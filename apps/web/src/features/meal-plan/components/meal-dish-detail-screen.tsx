'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getMealItemDetails } from '../api/meal-plan.client';
import type { MealDishDetail } from '../model/meal-plan.types';
import { useI18n } from '../../../i18n/locale-provider';
import { apiErrorMessage } from '@/lib/api-fetch';
import type { MessageKey } from '../../../i18n/types';

function mealTypeKey(mealType: string): MessageKey {
  return `meal.mealType.${mealType}` as MessageKey;
}

export function MealDishDetailScreen({ itemId }: { itemId: string }) {
  const { t, tc, locale } = useI18n();
  const [detail, setDetail] = useState<MealDishDetail | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    getMealItemDetails(itemId)
      .then(setDetail)
      .catch((err: unknown) => setError(apiErrorMessage(err, locale)));
  }, [itemId, locale]);

  if (error) {
    return (
      <main role="alert">
        <h1>{t('meal.details')}</h1>
        <p>{error}</p>
        <Link href="/meal-plan">{t('meal.backToPlan')}</Link>
      </main>
    );
  }
  if (!detail) {
    return (
      <main aria-busy="true">
        <h1>{t('meal.details')}</h1>
        <p>{t('meal.loading')}</p>
      </main>
    );
  }

  return (
    <main data-testid="meal-dish-detail">
      <p>
        <Link href="/meal-plan" data-testid="meal-dish-back">
          {t('meal.backToPlan')}
        </Link>
      </p>
      <h1 data-testid="meal-dish-name">{tc('meal', detail.dishName)}</h1>
      <p data-testid="meal-dish-slot">
        {t(mealTypeKey(detail.mealType))}
        {detail.plannedTime ? ` · ${detail.plannedTime}` : ''}
      </p>
      {detail.description ? <p data-testid="meal-dish-description">{detail.description}</p> : <p>{t('meal.noData')}</p>}
      <p data-testid="meal-dish-portion">
        {t('meal.portion')}: {detail.portionLabel}
      </p>
      <p data-testid="meal-dish-macros">
        {Math.round(detail.calories)} {t('unit.kcal')} · {t('meal.macro.protein')} {detail.proteinG} ·{' '}
        {t('meal.macro.fat')} {detail.fatG} · {t('meal.macro.carbs')} {detail.carbsG}
      </p>
      <p data-testid="meal-dish-time">
        {t('meal.cookTime')}:{' '}
        {detail.prepMinutes != null || detail.cookMinutes != null
          ? `${t('meal.time.prep')} ${detail.prepMinutes ?? t('meal.noData')}, ${t('meal.time.cook')} ${
              detail.cookMinutes ?? t('meal.noData')
            }, ${t('meal.time.total')} ${detail.totalMinutes ?? t('meal.noData')} ${t('unit.minutesShort')}`
          : t('meal.noData')}
      </p>
      <p>
        {t('meal.costConsumed')}:{' '}
        <span data-testid="meal-dish-cost-consumed">
          {detail.cost.consumedCostRub != null ? `${detail.cost.consumedCostRub.toFixed(0)} ${t('unit.currency')}` : t('meal.noData')}
        </span>
      </p>
      <p>
        {t('meal.costPackages')}:{' '}
        <span data-testid="meal-dish-cost-packages">
          {detail.cost.packageCostRub != null ? `${detail.cost.packageCostRub.toFixed(0)} ${t('unit.currency')}` : t('meal.noData')}
        </span>
      </p>
      {detail.cost.status === 'partial' ? <p data-testid="meal-dish-cost-partial">{t('meal.costPartial')}</p> : null}
      {detail.cost.status === 'missing' ? <p data-testid="meal-dish-cost-missing">{t('meal.costMissing')}</p> : null}

      <h2>{t('meal.ingredients')}</h2>
      <ul data-testid="meal-dish-ingredients">
        {detail.ingredients.map((ingredient) => (
          <li key={`${ingredient.productId}-${ingredient.amount}`}>
            {tc('product', ingredient.displayName)}: {ingredient.amount} {ingredient.unit} · {Math.round(ingredient.calories)} {t('unit.kcal')}
            {ingredient.consumedCostRub != null ? ` · ${ingredient.consumedCostRub.toFixed(0)} ${t('unit.currency')}` : ` · ${t('meal.noData')}`}
            {ingredient.priceSourceLabel || ingredient.priceSource ? (
              <span data-testid="meal-dish-ingredient-price-source">
                {' '}
                · {ingredient.priceSourceLabel ?? ingredient.priceSource}
                {ingredient.retailer ? ` / ${ingredient.retailer}` : ''}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <h2>{t('meal.recipe')}</h2>
      <ol data-testid="meal-dish-steps">
        {detail.steps.map((step) => (
          <li key={step.stepIndex}>
            {step.instruction}
            {step.durationMinutes != null ? ` (${step.durationMinutes} ${t('unit.minutesShort')})` : ''}
            {step.temperatureC != null ? ` · ${step.temperatureC}°C` : ''}
          </li>
        ))}
      </ol>

      {detail.allergens.length ? (
        <p data-testid="meal-dish-allergens">
          {t('meal.allergens')}: {detail.allergens.join(', ')}
        </p>
      ) : null}
      {detail.dietaryTags.length ? (
        <p data-testid="meal-dish-dietary">
          {t('meal.dietary')}: {detail.dietaryTags.join(', ')}
        </p>
      ) : null}

      <h2>{t('meal.dayShare')}</h2>
      <p data-testid="meal-dish-day-share">
        {detail.daySharePercent.calories}% {t('unit.kcal')} · {t('meal.macro.protein')} {detail.daySharePercent.proteinG}% ·{' '}
        {t('meal.macro.fat')} {detail.daySharePercent.fatG}% · {t('meal.macro.carbs')} {detail.daySharePercent.carbsG}%
      </p>

      <button type="button" disabled data-testid="meal-dish-replace">
        {t('meal.replaceLater')}
      </button>
    </main>
  );
}
