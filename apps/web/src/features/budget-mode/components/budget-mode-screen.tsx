'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/locale-provider';
import { getBudgetPreferences, setBudgetPreferences } from '../api/budget-mode.client';
import type { BudgetMode, BudgetScreenState } from '../model/budget-mode.types';

export function BudgetModeScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<BudgetScreenState>('loading');
  const [mode, setMode] = useState<BudgetMode>('balanced');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getBudgetPreferences()
      .then(({ mode: next }) => {
        setMode(next);
        setState('success');
      })
      .catch((error) =>
        setState(error instanceof Error && error.message === 'BUDGET_MODE_FORBIDDEN' ? 'forbidden' : 'error'),
      );
  }, []);

  async function save() {
    try {
      await setBudgetPreferences({ mode });
      setMessage(t('budget.saved'));
    } catch {
      setMessage(t('budget.saveError'));
    }
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true" data-testid="budget-mode-screen">
        <h1>{t('budget.title')}</h1>
        <p>{t('budget.loading')}</p>
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main role="alert" data-testid="budget-mode-screen">
        <h1>{t('budget.title')}</h1>
        <p>{t('budget.forbidden')}</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert" data-testid="budget-mode-screen">
        <h1>{t('budget.title')}</h1>
        <p>{t('budget.unavailable')}</p>
      </main>
    );
  }

  return (
    <main data-testid="budget-mode-screen">
      <h1>{t('budget.title')}</h1>
      <p data-testid="budget-safety-note">{t('budget.safetyNote')}</p>
      <label>
        {t('budget.preference')}
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as BudgetMode)}
          data-testid="budget-mode-select"
        >
          <option value="balanced">{t('budget.option.balanced')}</option>
          <option value="frugal">{t('budget.option.frugal')}</option>
          <option value="flexible">{t('budget.option.flexible')}</option>
        </select>
      </label>
      <p data-testid="budget-tradeoff">{t(`budget.tradeoff.${mode}`)}</p>
      <button onClick={() => void save()} type="button" data-testid="budget-save">
        {t('budget.save')}
      </button>
      {message ? (
        <p role="status" data-testid="budget-save-message">
          {message}
        </p>
      ) : null}
    </main>
  );
}
