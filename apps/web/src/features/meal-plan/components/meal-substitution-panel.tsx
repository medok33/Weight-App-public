'use client';

import { useId, useState } from 'react';
import {
  cancelMealSubstitution,
  confirmMealSubstitution,
  listMealSubstitutions,
  previewMealSubstitution,
} from '../api/substitution.client';
import type { SubstitutionCandidate, SubstitutionPreview } from '../model/substitution.types';
import { useI18n } from '../../../i18n/locale-provider';
import { apiErrorMessage } from '@/lib/api-fetch';
import { revisionErrorMessage } from '../../revision-engine/api/revision-engine.client';

type Props = {
  mealItemId: string;
  dishName: string;
  ingredientProductIds?: string[];
  ingredients?: Array<{
    productId: string;
    displayName: string;
    amount: number;
    unit: string;
    label: string;
  }>;
  onConfirmed: () => void | Promise<void>;
};

function classLabel(classification: string, t: (key: never) => string): string {
  if (classification === 'EQUIVALENT') return t('sub.classEquivalent' as never);
  if (classification === 'ADJUSTABLE') return t('sub.classAdjustable' as never);
  if (classification === 'CONFLICTING') return t('sub.classConflicting' as never);
  return classification;
}

function provenanceLabel(provenance: string | undefined): string {
  if (provenance === 'CURATED_PRODUCT_SUBSTITUTION') return 'Проверенная замена';
  if (provenance === 'HEURISTIC_CATALOG_MATCH') return 'Подобрано по составу';
  return 'Подобрано по составу';
}

export function MealSubstitutionPanel({
  mealItemId,
  dishName,
  ingredientProductIds = [],
  ingredients = [],
  onConfirmed,
}: Props) {
  const { t, tc } = useI18n();
  const idempotencySeed = useId();
  const options =
    ingredients.length > 0
      ? ingredients
      : ingredientProductIds.map((id) => ({
          productId: id,
          displayName: id,
          amount: 0,
          unit: 'g',
          label: id,
        }));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'dish' | 'ingredient'>('dish');
  const [ingredientId, setIngredientId] = useState(options[0]?.productId ?? '');
  const [candidates, setCandidates] = useState<SubstitutionCandidate[]>([]);
  const [noMessage, setNoMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SubstitutionPreview | null>(null);
  const [compensation, setCompensation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => `sub-${idempotencySeed.replace(/:/g, '')}-${Date.now()}`);

  async function openPanel() {
    setOpen(true);
    setPreview(null);
    setMessage(null);
    await loadCandidates('dish');
  }

  async function loadCandidates(nextMode: 'dish' | 'ingredient', replaceProductId?: string) {
    setBusy(true);
    setMessage(null);
    setMode(nextMode);
    const productId =
      nextMode === 'ingredient' ? (replaceProductId ?? ingredientId) || undefined : undefined;
    if (nextMode === 'ingredient' && replaceProductId) {
      setIngredientId(replaceProductId);
    }
    try {
      const result = await listMealSubstitutions(mealItemId, nextMode, productId);
      setCandidates(result.candidates);
      setNoMessage(result.noCandidatesMessage);
    } catch (error) {
      setMessage(apiErrorMessage(error));
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  }

  async function selectCandidate(candidate: SubstitutionCandidate) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await previewMealSubstitution(mealItemId, {
        candidateId: candidate.candidateId,
        compensation: compensation,
      });
      setPreview(next);
      if (!compensation && next.compensationOptions[0]) {
        setCompensation(next.compensationOptions[0]);
      }
    } catch (error) {
      setMessage(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (preview) {
      await cancelMealSubstitution(mealItemId, preview.revisionPlanId).catch(() => undefined);
    }
    setPreview(null);
    setOpen(false);
    setMessage(null);
  }

  async function confirm() {
    if (!preview || confirming) return;
    setConfirming(true);
    setMessage(null);
    try {
      const result = await confirmMealSubstitution(
        preview.revisionPlanId,
        preview.confirmationToken,
        idempotencyKey,
      );
      const ok = result.idempotentReplay ? t('revision.replaySuccess') : t('sub.success');
      setMessage(ok);
      setPreview(null);
      setOpen(false);
      await onConfirmed();
    } catch (error) {
      setMessage(revisionErrorMessage(error, t('revision.confirmError')));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div>
      {!open ? (
        <button type="button" data-testid={`meal-card-replace-${mealItemId}`} onClick={() => void openPanel()}>
          {t('meal.replace')}
        </button>
      ) : null}
      {message ? (
        <p role="status" data-testid="substitution-message">
          {message}
        </p>
      ) : null}
      {open ? (
    <section
      data-testid="substitution-panel"
      aria-labelledby="substitution-panel-title"
      style={{
        marginTop: '0.75rem',
        border: '1px solid #c5d4c5',
        borderRadius: 12,
        padding: '0.75rem',
        maxWidth: '100%',
      }}
    >
      <h4 id="substitution-panel-title" data-testid="substitution-title">
        {t('sub.title')}: {tc('meal', dishName)}
      </h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          type="button"
          data-testid="substitution-mode-dish"
          aria-pressed={mode === 'dish'}
          onClick={() => void loadCandidates('dish')}
        >
          {t('sub.replaceDish')}
        </button>
        <button
          type="button"
          data-testid="substitution-mode-ingredient"
          aria-pressed={mode === 'ingredient'}
          onClick={() => void loadCandidates('ingredient')}
          disabled={!options.length && !ingredientId}
        >
          {t('sub.replaceIngredient')}
        </button>
        {mode === 'ingredient' && options.length ? (
          <select
            data-testid="substitution-ingredient-select"
            value={ingredientId}
            onChange={(e) => {
              const nextId = e.target.value;
              setIngredientId(nextId);
              void loadCandidates('ingredient', nextId);
            }}
          >
            {options.map((item) => (
              <option key={item.productId} value={item.productId} data-testid={`substitution-ingredient-option-${item.productId}`}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}
        {mode === 'ingredient' ? (
          <button
            type="button"
            data-testid="substitution-reload-ingredient"
            onClick={() => void loadCandidates('ingredient', ingredientId || undefined)}
          >
            {t('sub.load')}
          </button>
        ) : null}
      </div>

          {busy ? <p data-testid="substitution-loading">{t('sub.loading')}</p> : null}

      {!preview ? (
        <>
          {noMessage ? (
            <div data-testid="substitution-empty">
              <p>{noMessage}</p>
              <ul>
                <li>{t('sub.hintCriteria')}</li>
                <li>{t('sub.hintDeviation')}</li>
                <li>{t('sub.hintOtherIngredient')}</li>
                <li>{t('sub.hintKeep')}</li>
              </ul>
            </div>
          ) : (
            <ul data-testid="substitution-candidates" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
              {candidates.map((candidate) => (
                <li
                  key={candidate.candidateId}
                  data-testid={`substitution-candidate-${candidate.classification}`}
                  data-candidate-product-id={candidate.productId ?? undefined}
                  style={{ border: '1px solid #dde6dd', borderRadius: 8, padding: '0.5rem' }}
                >
                  <p>
                    <strong data-testid="substitution-candidate-name">{tc('meal', candidate.name)}</strong>
                  </p>
                  {candidate.provenance ? (
                    <p data-testid="substitution-candidate-provenance">
                      {provenanceLabel(candidate.provenance)}
                      {candidate.suggestedAmountGrams != null
                        ? ` · ${candidate.suggestedAmountGrams} г`
                        : ''}
                    </p>
                  ) : null}
                  {candidate.reasons?.length ? (
                    <p data-testid="substitution-candidate-reasons" style={{ fontSize: '0.85rem', opacity: 0.85 }}>
                      {candidate.reasons.slice(0, 2).join(' ')}
                    </p>
                  ) : null}
                  <p data-testid="substitution-candidate-class">{classLabel(candidate.classification, t)}</p>
                  <p>
                    {Math.round(candidate.calories)} {t('unit.kcal')} · Б {candidate.proteinG} · Ж {candidate.fatG} · У{' '}
                    {candidate.carbsG}
                  </p>
                  <p>
                    {t('meal.portion')}: {candidate.suggestedPortionGrams} г · Δ{' '}
                    {candidate.nutrientDelta.caloriesPct}% {t('unit.kcal')}
                  </p>
                  <p>
                    {t('meal.cost')}:{' '}
                    {candidate.consumedCostRub != null
                      ? `${candidate.consumedCostRub.toFixed(0)} ${t('unit.currency')}`
                      : t('meal.costMissing')}
                  </p>
                  <button
                    type="button"
                    data-testid="substitution-select"
                    onClick={() => void selectCandidate(candidate)}
                  >
                    {t('sub.compare')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" data-testid="substitution-close" onClick={() => void discard()}>
            {t('revision.cancel')}
          </button>
        </>
      ) : (
        <div data-testid="substitution-preview">
          <h5>{t('sub.beforeAfter')}</h5>
          <p data-testid="substitution-before">
            {t('sub.before')}: {tc('meal', preview.before.dishName)} · {Math.round(preview.before.macros.calories)}{' '}
            {t('unit.kcal')} · {preview.before.portionGrams} г
          </p>
          <p data-testid="substitution-after">
            {t('sub.after')}: {tc('meal', preview.after.dishName)} · {Math.round(preview.after.macros.calories)}{' '}
            {t('unit.kcal')} · {preview.after.portionGrams} г
          </p>
          <p data-testid="substitution-day-impact">
            {t('sub.dayImpact')}: {Math.round(preview.dayBalance.before.calories)} →{' '}
            {Math.round(preview.dayBalance.after.calories)} / {Math.round(preview.dayBalance.target.calories)}
          </p>
          <p data-testid="substitution-goal">
            {t('sub.goalImpact')}: {preview.goalImpact.message}
          </p>
          {preview.warnings.length ? (
            <p role="status" data-testid="substitution-warning">
              {preview.warnings[0]}
            </p>
          ) : null}
          {preview.compensationOptions.length ? (
            <label>
              {t('sub.compensation')}
              <select
                data-testid="substitution-compensation"
                value={compensation ?? ''}
                onChange={(e) => setCompensation(e.target.value || null)}
              >
                {preview.compensationOptions.map((option) => (
                  <option key={option} value={option}>
                    {t(`sub.comp.${option}` as never)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" data-testid="substitution-confirm" disabled={confirming} onClick={() => void confirm()}>
              {t('revision.confirm')}
            </button>
            <button type="button" data-testid="substitution-discard" onClick={() => void discard()}>
              {t('revision.discard')}
            </button>
          </div>
        </div>
      )}
    </section>
      ) : null}
    </div>
  );
}
