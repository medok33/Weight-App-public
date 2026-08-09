'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUserGoal, getUserProfile, putUserGoal, putUserProfile } from '@/features/user-profile/api/user-profile.client';
import type { ActivityLevel, AppLocale } from '@/features/user-profile/model/user-profile.types';
import {
  CONTROLLED_ALLERGEN_CODES,
  CONTROLLED_DIETARY_CODES,
  profileAllergenKey,
  profileDietaryKey,
  toggleCode,
} from '@/features/user-profile/model/profile-controlled-codes';
import { useI18n } from '@/i18n/locale-provider';
import { useAuth } from '@/features/auth/components/auth-provider';
import { handleUnauthorized } from '@/lib/handle-unauthorized';
import { mapUnknownToUiError } from '@/lib/map-api-error';
import { LoadingState, InlineNotice } from '@/components/ui-state';
import { completeBetaOnboardingStep } from '../api/retention-onboarding.client';
import { getOnboardingCompletionStatus } from '../lib/onboarding-gate';
import './onboarding-wizard.css';

const TOTAL_STEPS = 5;

type WizardForm = {
  displayName: string;
  ageYears: string;
  heightCm: string;
  weightKg: string;
  activityLevel: ActivityLevel;
  locale: AppLocale;
  goalKind: string;
  goalTarget: string;
  targetDate: string;
  allergenCodes: string[];
  dietaryCodes: string[];
};

const emptyForm: WizardForm = {
  displayName: '',
  ageYears: '',
  heightCm: '',
  weightKg: '',
  activityLevel: 'moderate',
  locale: 'ru',
  goalKind: 'lose_weight',
  goalTarget: '',
  targetDate: '',
  allergenCodes: [],
  dietaryCodes: [],
};

function clampStep(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(TOTAL_STEPS, Math.max(1, Math.trunc(raw)));
}

export function OnboardingWizardScreen() {
  const { t, setLocale } = useI18n();
  const { clearSessionLocal } = useAuth();
  const router = useRouter();
  const [boot, setBoot] = useState<'loading' | 'ready' | 'done'>('loading');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardForm>(emptyForm);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);
  const errorId = useId();
  const headingId = useId();
  const progressId = useId();
  const firstErrorRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const completion = await getOnboardingCompletionStatus();
      if (completion === 'complete') {
        setBoot('done');
        return;
      }
      const [profile, goal] = await Promise.all([getUserProfile(), getUserGoal()]);
      let maxStep = 2;
      if (profile || goal) {
        setForm((current) => ({
          ...current,
          displayName: profile?.displayName ?? current.displayName,
          ageYears: profile ? String(profile.ageYears) : current.ageYears,
          heightCm: profile ? String(profile.heightCm) : current.heightCm,
          weightKg: profile ? String(profile.weightKg) : current.weightKg,
          activityLevel: profile?.activityLevel ?? current.activityLevel,
          locale: profile?.locale === 'en' ? 'en' : 'ru',
          goalKind: goal?.kind ?? current.goalKind,
          goalTarget: goal ? String(goal.target) : current.goalTarget,
          targetDate: goal?.targetDate ?? current.targetDate,
          allergenCodes: [...(profile?.allergenCodes ?? [])],
          dietaryCodes: [...(profile?.dietaryCodes ?? [])],
        }));
        if (profile && goal) maxStep = 5;
        else if (profile) maxStep = 3;
        else maxStep = 2;
        setStep(profile && !goal ? 3 : profile && goal ? 5 : 2);
      } else {
        // No server rows yet: welcome + profile form only (cannot jump to goal/finish).
        setStep(1);
        maxStep = 2;
      }
      // Honour ?step= only within the allowed range (cannot skip required saves).
      if (typeof window !== 'undefined') {
        const fromQuery = Number(new URLSearchParams(window.location.search).get('step'));
        if (fromQuery) setStep(Math.min(clampStep(fromQuery), Math.max(maxStep, 1)));
      }
      setBoot('ready');
    } catch (error: unknown) {
      const mapped = mapUnknownToUiError(error, { locale: 'ru' });
      if (mapped.kind === 'unauthenticated') {
        await handleUnauthorized({ clearSessionLocal, router, pathname: '/onboarding' });
        return;
      }
      setBoot('ready');
    }
  }, [clearSessionLocal, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (boot !== 'ready') return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(step));
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  }, [step, boot]);

  function validateProfile(): boolean {
    const next: Record<string, string> = {};
    if (!form.displayName.trim() || form.displayName.trim().length < 2) {
      next.displayName = t('onboarding.error.name');
    }
    const age = Number(form.ageYears);
    if (!form.ageYears || age < 14 || age > 100) next.ageYears = t('onboarding.error.age');
    const height = Number(form.heightCm);
    if (!form.heightCm || height < 120 || height > 230) next.heightCm = t('onboarding.error.height');
    const weight = Number(form.weightKg);
    if (!form.weightKg || weight < 35 || weight > 250) next.weightKg = t('onboarding.error.weight');
    setFieldErrors(next);
    setError(Object.keys(next).length ? t('onboarding.error.checkFields') : '');
    return Object.keys(next).length === 0;
  }

  function validateGoal(): boolean {
    const next: Record<string, string> = {};
    const target = Number(form.goalTarget);
    if (!form.goalTarget || !(target > 0) || target > 250) next.goalTarget = t('onboarding.error.goalTarget');
    if (!form.goalKind) next.goalKind = t('onboarding.error.goalKind');
    setFieldErrors(next);
    setError(Object.keys(next).length ? t('onboarding.error.checkFields') : '');
    return Object.keys(next).length === 0;
  }

  useEffect(() => {
    if (!error && Object.keys(fieldErrors).length === 0) return;
    queueMicrotask(() => firstErrorRef.current?.focus());
  }, [error, fieldErrors]);

  async function withAuthHandling(run: () => Promise<void>) {
    try {
      await run();
    } catch (err: unknown) {
      const mapped = mapUnknownToUiError(err, { locale: form.locale });
      if (mapped.kind === 'unauthenticated') {
        await handleUnauthorized({ clearSessionLocal, router, pathname: '/onboarding' });
        return;
      }
      setError(mapped.explanation || t('onboarding.error.save'));
    }
  }

  async function onContinue() {
    if (savingLock.current) return;
    setError('');
    if (step === 2 && !validateProfile()) return;
    if (step === 3 && !validateGoal()) return;

    if (step === 1) {
      savingLock.current = true;
      setSaving(true);
      await withAuthHandling(async () => {
        await completeBetaOnboardingStep('welcome').catch(() => undefined);
        setStep(2);
      });
      savingLock.current = false;
      setSaving(false);
      return;
    }

    if (step === 3) {
      savingLock.current = true;
      setSaving(true);
      await withAuthHandling(async () => {
        await putUserProfile({
          displayName: form.displayName.trim(),
          ageYears: Number(form.ageYears),
          heightCm: Number(form.heightCm),
          weightKg: Number(form.weightKg),
          activityLevel: form.activityLevel,
          locale: form.locale,
          allergenCodes: form.allergenCodes,
          dietaryCodes: form.dietaryCodes,
          intoleranceCodes: [],
          equipmentCodes: [],
          trainingLevel: null,
          workoutsPerWeek: null,
          dietaryPreferences: [],
          foodRestrictions: [],
          availableEquipment: [],
        });
        await putUserGoal({
          kind: form.goalKind,
          target: Number(form.goalTarget),
          unit: 'kg',
          targetDate: form.targetDate || null,
        });
        await setLocale(form.locale, { persist: false });
        await completeBetaOnboardingStep('profile_goal').catch(() => undefined);
        setStep(4);
      });
      savingLock.current = false;
      setSaving(false);
      return;
    }

    if (step === 4) {
      savingLock.current = true;
      setSaving(true);
      await withAuthHandling(async () => {
        const existing = await getUserProfile();
        if (existing) {
          await putUserProfile({
            displayName: existing.displayName,
            ageYears: existing.ageYears,
            heightCm: existing.heightCm,
            weightKg: existing.weightKg,
            activityLevel: existing.activityLevel,
            locale: existing.locale,
            trainingLevel: existing.trainingLevel ?? null,
            workoutsPerWeek: existing.workoutsPerWeek ?? null,
            allergenCodes: form.allergenCodes,
            dietaryCodes: form.dietaryCodes,
            intoleranceCodes: existing.intoleranceCodes ?? [],
            equipmentCodes: existing.equipmentCodes ?? [],
            dietaryPreferences: existing.dietaryPreferences ?? [],
            foodRestrictions: existing.foodRestrictions ?? [],
            availableEquipment: existing.availableEquipment ?? [],
          });
        }
        setStep(5);
      });
      savingLock.current = false;
      setSaving(false);
      return;
    }

    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
      return;
    }

    savingLock.current = true;
    setSaving(true);
    await withAuthHandling(async () => {
      const completion = await getOnboardingCompletionStatus();
      if (completion !== 'complete') {
        setError(t('onboarding.error.save'));
        setStep(completion === 'incomplete' ? 2 : step);
        return;
      }
      await completeBetaOnboardingStep('meal_plan_intro').catch(() => undefined);
      router.replace('/dashboard-today');
    });
    savingLock.current = false;
    setSaving(false);
  }

  function onBack() {
    if (savingLock.current) return;
    setError('');
    setFieldErrors({});
    setStep((s) => Math.max(1, s - 1));
  }

  function onSkipPreferences() {
    if (savingLock.current) return;
    setStep(5);
  }

  if (boot === 'loading') {
    return (
      <main className="wa-onboarding" data-testid="onboarding-wizard">
        <LoadingState message={t('common.loading')} testId="onboarding-loading" />
      </main>
    );
  }

  if (boot === 'done') {
    return (
      <main className="wa-onboarding" data-testid="onboarding-wizard">
        <h1 data-testid="onboarding-heading">{t('onboarding.alreadyTitle')}</h1>
        <p>{t('onboarding.alreadyBody')}</p>
        <button type="button" data-testid="onboarding-go-dashboard" onClick={() => router.replace('/dashboard-today')}>
          {t('onboarding.goDashboard')}
        </button>
      </main>
    );
  }

  const stepTitle =
    step === 1
      ? t('onboarding.step.welcome')
      : step === 2
        ? t('onboarding.step.profile')
        : step === 3
          ? t('onboarding.step.goal')
          : step === 4
            ? t('onboarding.step.preferences')
            : t('onboarding.step.finish');

  const primaryLabel =
    step === TOTAL_STEPS ? t('onboarding.finish') : t('onboarding.continue');

  return (
    <main className="wa-onboarding" data-testid="onboarding-wizard" aria-labelledby={headingId}>
      <h1 id={headingId} data-testid="onboarding-heading">
        {t('onboarding.title')}
      </h1>

      <div
        className="wa-onboarding-progress"
        data-testid="onboarding-progress"
        role="status"
        aria-live="polite"
        aria-labelledby={progressId}
      >
        <p id={progressId} className="wa-onboarding-progress-label">
          {t('onboarding.progress', { current: step, total: TOTAL_STEPS, name: stepTitle })}
        </p>
        <ol className="wa-onboarding-steps" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const n = i + 1;
            return (
              <li
                key={n}
                data-testid={`onboarding-step-dot-${n}`}
                data-state={n < step ? 'done' : n === step ? 'current' : 'todo'}
              >
                {n}
              </li>
            );
          })}
        </ol>
      </div>

      {error ? (
        <InlineNotice tone="error" message={error} testId="onboarding-error" />
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="sr-only">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <section data-testid="onboarding-step-welcome" aria-labelledby="onboarding-welcome-title">
          <h2 id="onboarding-welcome-title">{t('onboarding.welcomeTitle')}</h2>
          <p>{t('onboarding.welcomeBody')}</p>
        </section>
      ) : null}

      {step === 2 ? (
        <section data-testid="onboarding-step-profile" aria-labelledby="onboarding-profile-title">
          <h2 id="onboarding-profile-title">{t('onboarding.profileTitle')}</h2>
          <p>{t('onboarding.profileBody')}</p>
          <div className="wa-onboarding-fields">
            <label htmlFor="ob-name">{t('profile.name')}</label>
            <input
              id="ob-name"
              ref={(el) => {
                if (fieldErrors.displayName) firstErrorRef.current = el;
              }}
              data-testid="onboarding-name"
              value={form.displayName}
              onChange={(e) => setForm((c) => ({ ...c, displayName: e.target.value }))}
              required
              aria-invalid={fieldErrors.displayName ? true : undefined}
              aria-describedby={fieldErrors.displayName ? `${errorId}-name` : undefined}
            />
            {fieldErrors.displayName ? (
              <p id={`${errorId}-name`} className="wa-onboarding-field-error" role="alert">
                {fieldErrors.displayName}
              </p>
            ) : null}

            <label htmlFor="ob-age">{t('profile.age')}</label>
            <input
              id="ob-age"
              ref={(el) => {
                if (!fieldErrors.displayName && fieldErrors.ageYears) firstErrorRef.current = el;
              }}
              data-testid="onboarding-age"
              type="number"
              min={14}
              max={100}
              value={form.ageYears}
              onChange={(e) => setForm((c) => ({ ...c, ageYears: e.target.value }))}
              required
              aria-invalid={fieldErrors.ageYears ? true : undefined}
            />

            <label htmlFor="ob-height">{t('profile.height')}</label>
            <input
              id="ob-height"
              data-testid="onboarding-height"
              type="number"
              min={120}
              max={230}
              value={form.heightCm}
              onChange={(e) => setForm((c) => ({ ...c, heightCm: e.target.value }))}
              required
              aria-invalid={fieldErrors.heightCm ? true : undefined}
            />

            <label htmlFor="ob-weight">{t('profile.weight')}</label>
            <input
              id="ob-weight"
              data-testid="onboarding-weight"
              type="number"
              min={35}
              max={250}
              step="0.1"
              value={form.weightKg}
              onChange={(e) => setForm((c) => ({ ...c, weightKg: e.target.value }))}
              required
              aria-invalid={fieldErrors.weightKg ? true : undefined}
            />

            <label htmlFor="ob-activity">{t('profile.activity')}</label>
            <select
              id="ob-activity"
              data-testid="onboarding-activity"
              value={form.activityLevel}
              onChange={(e) => setForm((c) => ({ ...c, activityLevel: e.target.value as ActivityLevel }))}
            >
              <option value="sedentary">{t('profile.activitySedentary')}</option>
              <option value="light">{t('profile.activityLight')}</option>
              <option value="moderate">{t('profile.activityModerate')}</option>
              <option value="active">{t('profile.activityActive')}</option>
              <option value="very_active">{t('profile.activityVeryActive')}</option>
            </select>

            <label htmlFor="ob-locale">{t('profile.language')}</label>
            <select
              id="ob-locale"
              data-testid="onboarding-locale"
              value={form.locale}
              onChange={(e) => {
                const next = e.target.value as AppLocale;
                setForm((c) => ({ ...c, locale: next }));
                void setLocale(next, { persist: false });
              }}
            >
              <option value="ru">{t('profile.languageRu')}</option>
              <option value="en">{t('profile.languageEn')}</option>
            </select>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section data-testid="onboarding-step-goal" aria-labelledby="onboarding-goal-title">
          <h2 id="onboarding-goal-title">{t('onboarding.goalTitle')}</h2>
          <p>{t('onboarding.goalBody')}</p>
          <div className="wa-onboarding-fields">
            <label htmlFor="ob-goal-kind">{t('profile.goal')}</label>
            <select
              id="ob-goal-kind"
              ref={(el) => {
                if (fieldErrors.goalKind) firstErrorRef.current = el;
              }}
              data-testid="onboarding-goal-kind"
              value={form.goalKind}
              onChange={(e) => setForm((c) => ({ ...c, goalKind: e.target.value }))}
              required
              aria-invalid={fieldErrors.goalKind ? true : undefined}
            >
              <option value="lose_weight">{t('profile.goalLose')}</option>
              <option value="maintain">{t('profile.goalMaintain')}</option>
              <option value="gain_muscle">{t('profile.goalGain')}</option>
            </select>

            <label htmlFor="ob-goal-target">{t('profile.goalTarget')}</label>
            <input
              id="ob-goal-target"
              ref={(el) => {
                if (!fieldErrors.goalKind && fieldErrors.goalTarget) firstErrorRef.current = el;
              }}
              data-testid="onboarding-goal-target"
              type="number"
              min={35}
              max={250}
              step="0.1"
              value={form.goalTarget}
              onChange={(e) => setForm((c) => ({ ...c, goalTarget: e.target.value }))}
              required
              aria-invalid={fieldErrors.goalTarget ? true : undefined}
            />

            <label htmlFor="ob-goal-date">{t('profile.targetDate')}</label>
            <input
              id="ob-goal-date"
              data-testid="onboarding-goal-date"
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm((c) => ({ ...c, targetDate: e.target.value }))}
            />
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section data-testid="onboarding-step-preferences" aria-labelledby="onboarding-pref-title">
          <h2 id="onboarding-pref-title">{t('onboarding.preferencesTitle')}</h2>
          <p>{t('onboarding.preferencesBody')}</p>
          <fieldset data-testid="onboarding-allergens">
            <legend>{t('profile.allergensSection')}</legend>
            <div className="wa-onboarding-chips">
              {CONTROLLED_ALLERGEN_CODES.map((code) => (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={form.allergenCodes.includes(code)}
                    onChange={() =>
                      setForm((c) => ({ ...c, allergenCodes: toggleCode(c.allergenCodes, code) }))
                    }
                  />{' '}
                  {t(profileAllergenKey(code))}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset data-testid="onboarding-diet">
            <legend>{t('profile.dietarySection')}</legend>
            <div className="wa-onboarding-chips">
              {CONTROLLED_DIETARY_CODES.map((code) => (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={form.dietaryCodes.includes(code)}
                    onChange={() =>
                      setForm((c) => ({ ...c, dietaryCodes: toggleCode(c.dietaryCodes, code) }))
                    }
                  />{' '}
                  {t(profileDietaryKey(code))}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      ) : null}

      {step === 5 ? (
        <section data-testid="onboarding-step-finish" aria-labelledby="onboarding-finish-title">
          <h2 id="onboarding-finish-title">{t('onboarding.finishTitle')}</h2>
          <p>{t('onboarding.finishBody')}</p>
          <ul className="wa-onboarding-summary" data-testid="onboarding-summary">
            <li>
              {t('profile.name')}: {form.displayName}
            </li>
            <li>
              {t('profile.age')}: {form.ageYears}
            </li>
            <li>
              {t('profile.weight')}: {form.weightKg}
            </li>
            <li>
              {t('profile.goalTarget')}: {form.goalTarget}
            </li>
          </ul>
          <p>{t('onboarding.mealIntro')}</p>
        </section>
      ) : null}

      <div className="wa-onboarding-actions">
        {step > 1 ? (
          <button type="button" data-testid="onboarding-back" onClick={onBack} disabled={saving}>
            {t('onboarding.back')}
          </button>
        ) : (
          <span />
        )}
        <div className="wa-onboarding-actions-end">
          {step === 4 ? (
            <button type="button" data-testid="onboarding-skip" onClick={onSkipPreferences} disabled={saving}>
              {t('onboarding.skip')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="onboarding-continue"
            onClick={() => void onContinue()}
            disabled={saving}
            aria-busy={saving || undefined}
          >
            {saving ? t('common.saving') : primaryLabel}
          </button>
        </div>
      </div>
    </main>
  );
}
