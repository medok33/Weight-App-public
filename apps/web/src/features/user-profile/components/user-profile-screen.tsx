'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { getUserGoal, getUserProfile, putUserGoal, putUserProfile } from '../api/user-profile.client';
import { regenerateMealPlan } from '../../meal-plan/api/meal-plan.client';
import type { ActivityLevel, AppLocale, ProfileFormValues, TrainingLevel } from '../model/user-profile.types';
import { splitCsv } from '../model/user-profile.types';
import type { ProfileStructureStatus } from '../model/profile-controlled-codes';
import {
  CONTROLLED_ALLERGEN_CODES,
  CONTROLLED_DIETARY_CODES,
  CONTROLLED_EQUIPMENT_CODES,
  CONTROLLED_INTOLERANCE_CODES,
  profileAllergenKey,
  profileDietaryKey,
  profileEquipmentKey,
  profileIntoleranceKey,
  toggleCode,
} from '../model/profile-controlled-codes';
import {
  isProfileFormDirty,
  serializeProfileForm,
  validateProfileForm,
  type ProfileFieldErrorKey,
} from '../lib/profile-form.logic';
import { useI18n } from '../../../i18n/locale-provider';
import type { MessageKey } from '../../../i18n/types';
import { useAuth } from '@/features/auth/components/auth-provider';
import { handleUnauthorized } from '@/lib/handle-unauthorized';
import { mapUnknownToUiError, type UiApiError } from '@/lib/map-api-error';
import {
  ErrorState,
  ForbiddenState,
  InlineNotice,
  LoadingState,
  RetryAction,
} from '@/components/ui-state';
import { ActivityConnectionsPanel } from '@/features/activity/components/activity-connections-panel';
import './user-profile-screen.css';

const emptyForm: ProfileFormValues = {
  displayName: '',
  ageYears: '',
  heightCm: '',
  weightKg: '',
  goalKind: 'lose_weight',
  goalTarget: '',
  targetDate: '',
  activityLevel: 'moderate',
  trainingLevel: '',
  workoutsPerWeek: '',
  allergenCodes: [],
  dietaryCodes: [],
  intoleranceCodes: [],
  equipmentCodes: [],
  dietaryPreferencesNote: '',
  foodRestrictionsNote: '',
  equipmentNote: '',
  locale: 'ru',
  legacyStructureConfirmed: false,
};

const FIELD_ERROR_KEYS: Record<ProfileFieldErrorKey, MessageKey> = {
  displayName: 'profile.error.name',
  ageYears: 'profile.error.age',
  heightCm: 'profile.error.height',
  weightKg: 'profile.error.weight',
  goalKind: 'profile.error.goalKind',
  goalTarget: 'profile.error.goalTarget',
  workoutsPerWeek: 'profile.error.workouts',
  legacy: 'profile.legacyStructureConfirm',
};

function needsLegacyConfirmation(status?: ProfileStructureStatus): boolean {
  return status === 'LEGACY_UNSTRUCTURED' || status === 'MIXED';
}

function profileToForm(
  profile: NonNullable<Awaited<ReturnType<typeof getUserProfile>>>,
  goal: Awaited<ReturnType<typeof getUserGoal>>,
): ProfileFormValues {
  const nextLocale = profile.locale === 'en' ? 'en' : 'ru';
  return {
    displayName: profile.displayName ?? '',
    ageYears: String(profile.ageYears),
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    goalKind: goal?.kind ?? 'lose_weight',
    goalTarget: goal ? String(goal.target) : '',
    targetDate: goal?.targetDate ?? '',
    activityLevel: profile.activityLevel ?? 'moderate',
    trainingLevel: (profile.trainingLevel as TrainingLevel) ?? '',
    workoutsPerWeek: profile.workoutsPerWeek != null ? String(profile.workoutsPerWeek) : '',
    allergenCodes: [...(profile.allergenCodes ?? [])],
    dietaryCodes: [...(profile.dietaryCodes ?? [])],
    intoleranceCodes: [...(profile.intoleranceCodes ?? [])],
    equipmentCodes: [...(profile.equipmentCodes ?? [])],
    dietaryPreferencesNote: (profile.dietaryPreferences ?? []).join(', '),
    foodRestrictionsNote: (profile.foodRestrictions ?? []).join(', '),
    equipmentNote: (profile.availableEquipment ?? []).join(', '),
    locale: nextLocale,
    legacyStructureConfirmed: !needsLegacyConfirmation(profile.profileStructureStatus),
  };
}

function ControlledCodeGroup(props: {
  title: string;
  testId: string;
  codes: readonly string[];
  selected: string[];
  labelFor: (code: string) => string;
  onToggle: (code: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset data-testid={props.testId} disabled={props.disabled}>
      <legend>{props.title}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
        {props.codes.map((code) => (
          <label key={code} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={props.selected.includes(code)}
              onChange={() => props.onToggle(code)}
              data-testid={`${props.testId}-${code}`}
            />
            {props.labelFor(code)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';
type SaveStatus = 'idle' | 'saving' | 'success' | 'error' | 'validation';
type SectionLoad = 'ok' | 'error' | 'empty';

export function UserProfileScreen() {
  const { t, locale, setLocale } = useI18n();
  const { clearSessionLocal, user, logout, status: authStatus } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const formId = useId();
  const savingLock = useRef(false);
  const requestId = useRef(0);
  const saveRequestId = useRef(0);
  const baselineRef = useRef<string | null>(null);
  const firstErrorRef = useRef<HTMLElement | null>(null);
  const preferredProductIdsRef = useRef<string[]>([]);
  const dislikedProductIdsRef = useRef<string[]>([]);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const [form, setForm] = useState<ProfileFormValues>({ ...emptyForm, locale });
  const [profileStructureStatus, setProfileStructureStatus] = useState<ProfileStructureStatus | undefined>();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<UiApiError | undefined>();
  const [profileSection, setProfileSection] = useState<SectionLoad>('ok');
  const [goalSection, setGoalSection] = useState<SectionLoad>('ok');
  const [sectionError, setSectionError] = useState<UiApiError | undefined>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | undefined>();
  const [sideError, setSideError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileFieldErrorKey, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    setDirty(isProfileFormDirty(form, baselineRef.current));
  }, [form]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const activeLocale = localeRef.current;
    setLoadStatus('loading');
    setLoadError(undefined);
    setSectionError(undefined);
    try {
      const [profileResult, goalResult] = await Promise.allSettled([getUserProfile(), getUserGoal()]);
      if (id !== requestId.current) return;

      let profile: Awaited<ReturnType<typeof getUserProfile>> = null;
      let goal: Awaited<ReturnType<typeof getUserGoal>> = null;
      let profileState: SectionLoad = 'empty';
      let goalState: SectionLoad = 'empty';
      let localSectionError: UiApiError | undefined;

      if (profileResult.status === 'fulfilled') {
        profile = profileResult.value;
        profileState = profile ? 'ok' : 'empty';
      } else {
        const mapped = mapUnknownToUiError(profileResult.reason, { locale: activeLocale });
        if (mapped.kind === 'unauthenticated') throw profileResult.reason;
        // 403 on a single source stays sectional — do not block the whole page or logout.
        profileState = 'error';
        localSectionError = mapped;
      }

      if (goalResult.status === 'fulfilled') {
        goal = goalResult.value;
        goalState = goal ? 'ok' : 'empty';
      } else {
        const mapped = mapUnknownToUiError(goalResult.reason, { locale: activeLocale });
        if (mapped.kind === 'unauthenticated') throw goalResult.reason;
        goalState = 'error';
        localSectionError = localSectionError ?? mapped;
      }

      setProfileSection(profileState);
      setGoalSection(goalState);
      setSectionError(localSectionError);

      if (profile) {
        preferredProductIdsRef.current = [...(profile.preferredProductIds ?? [])];
        dislikedProductIdsRef.current = [...(profile.dislikedProductIds ?? [])];
        setProfileStructureStatus(profile.profileStructureStatus);
        const next = profileToForm(profile, goal);
        setForm(next);
        baselineRef.current = serializeProfileForm(next);
        void setLocale(profile.locale === 'en' ? 'en' : 'ru', { persist: false });
      } else {
        preferredProductIdsRef.current = [];
        dislikedProductIdsRef.current = [];
        const next = {
          ...emptyForm,
          locale: activeLocale,
          goalKind: goal?.kind ?? emptyForm.goalKind,
          goalTarget: goal ? String(goal.target) : '',
          targetDate: goal?.targetDate ?? '',
        };
        setForm(next);
        baselineRef.current = serializeProfileForm(next);
      }
      setLoadStatus('ready');
    } catch (error: unknown) {
      if (id !== requestId.current) return;
      const mapped = mapUnknownToUiError(error, { locale: localeRef.current });
      if (mapped.kind === 'unauthenticated') {
        await handleUnauthorized({
          clearSessionLocal,
          router,
          pathname: pathname || '/settings',
        });
        return;
      }
      if (mapped.kind === 'forbidden') {
        setLoadStatus('forbidden');
        setLoadError(mapped);
        return;
      }
      setLoadStatus('error');
      setLoadError(mapped);
    }
  }, [clearSessionLocal, pathname, router, setLocale]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  function markField(
    name: ProfileFieldErrorKey,
    el: HTMLElement | null,
    errors: Partial<Record<ProfileFieldErrorKey, string>>,
  ) {
    if (errors[name] && !firstErrorRef.current) firstErrorRef.current = el;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingLock.current) return;
    setSideError(undefined);
    firstErrorRef.current = null;

    const nextErrors: Partial<Record<ProfileFieldErrorKey, string>> = {};
    const flags = validateProfileForm(form);
    for (const key of Object.keys(flags) as ProfileFieldErrorKey[]) {
      nextErrors[key] = t(FIELD_ERROR_KEYS[key]);
    }
    if (needsLegacyConfirmation(profileStructureStatus) && !form.legacyStructureConfirmed) {
      nextErrors.legacy = t('profile.legacyStructureConfirm');
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveStatus('validation');
      setSaveMessage(t('profile.validationError'));
      queueMicrotask(() => firstErrorRef.current?.focus());
      return;
    }

    savingLock.current = true;
    const thisSave = ++saveRequestId.current;
    setSaveStatus('saving');
    setSaveMessage(t('common.saving'));
    try {
      await putUserProfile({
        displayName: form.displayName.trim(),
        ageYears: Number(form.ageYears),
        heightCm: Number(form.heightCm),
        weightKg: Number(form.weightKg),
        activityLevel: form.activityLevel,
        locale: form.locale,
        trainingLevel: form.trainingLevel || null,
        workoutsPerWeek: form.workoutsPerWeek === '' ? null : Number(form.workoutsPerWeek),
        allergenCodes: form.allergenCodes,
        dietaryCodes: form.dietaryCodes,
        intoleranceCodes: form.intoleranceCodes,
        equipmentCodes: form.equipmentCodes,
        dietaryPreferences: splitCsv(form.dietaryPreferencesNote),
        foodRestrictions: splitCsv(form.foodRestrictionsNote),
        availableEquipment: splitCsv(form.equipmentNote),
        preferredProductIds: preferredProductIdsRef.current,
        dislikedProductIds: dislikedProductIdsRef.current,
      });
      await putUserGoal({
        kind: form.goalKind,
        target: Number(form.goalTarget),
        unit: 'kg',
        targetDate: form.targetDate || null,
      });
      await setLocale(form.locale, { persist: false });

      try {
        const mealPlanTask = regenerateMealPlan();
        let timer: number | undefined;
        try {
          await Promise.race([
            mealPlanTask,
            new Promise<never>((_, reject) => {
              timer = window.setTimeout(() => reject(new Error('meal-plan-timeout')), 20_000);
            }),
          ]);
        } finally {
          if (timer !== undefined) window.clearTimeout(timer);
          void mealPlanTask.catch(() => undefined);
        }
      } catch {
        if (thisSave === saveRequestId.current) {
          setSideError(t('profile.mealPlanUpdateError'));
        }
      }

      if (thisSave !== saveRequestId.current) return;

      const [profile, goal] = await Promise.all([getUserProfile(), getUserGoal()]);
      if (thisSave !== saveRequestId.current) return;
      if (profile) {
        preferredProductIdsRef.current = [...(profile.preferredProductIds ?? [])];
        dislikedProductIdsRef.current = [...(profile.dislikedProductIds ?? [])];
        setProfileStructureStatus(profile.profileStructureStatus);
        const next = profileToForm(profile, goal);
        setForm(next);
        baselineRef.current = serializeProfileForm(next);
        setProfileSection('ok');
        setGoalSection(goal ? 'ok' : 'empty');
      }
      setFieldErrors({});
      setSaveStatus('success');
      setSaveMessage(t('profile.saved'));
    } catch (error: unknown) {
      if (thisSave !== saveRequestId.current) return;
      const mapped = mapUnknownToUiError(error, { locale });
      if (mapped.kind === 'unauthenticated') {
        await handleUnauthorized({
          clearSessionLocal,
          router,
          pathname: pathname || '/settings',
        });
        return;
      }
      if (mapped.kind === 'forbidden') {
        setSaveStatus('error');
        setSaveMessage(mapped.explanation);
        return;
      }
      if (mapped.kind === 'validation') {
        setSaveStatus('validation');
        setSaveMessage(mapped.explanation);
        return;
      }
      setSaveStatus('error');
      setSaveMessage(mapped.explanation || t('profile.saveError'));
    } finally {
      if (thisSave === saveRequestId.current) {
        savingLock.current = false;
      }
    }
  }

  async function onLanguageChange(next: AppLocale) {
    setForm((current) => ({ ...current, locale: next }));
    // Preview only — persist with Save (backend SoT).
    await setLocale(next, { persist: false });
  }

  async function onLogout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logout();
      router.replace('/login');
    } finally {
      setLogoutBusy(false);
    }
  }

  const showLegacyPrompt = needsLegacyConfirmation(profileStructureStatus);
  const formBusy = saveStatus === 'saving';

  if (loadStatus === 'loading') {
    return (
      <main className="wa-settings">
        <h1>{t('profile.title')}</h1>
        <LoadingState message={t('common.loading')} testId="profile-loading" />
      </main>
    );
  }

  if (loadStatus === 'forbidden') {
    return (
      <main className="wa-settings">
        <h1>{t('profile.title')}</h1>
        <ForbiddenState
          title={loadError?.title ?? t('ui.forbiddenTitle')}
          message={loadError?.explanation ?? t('ui.forbiddenBody')}
          testId="profile-forbidden"
        />
      </main>
    );
  }

  if (loadStatus === 'error') {
    return (
      <main className="wa-settings">
        <h1>{t('profile.title')}</h1>
        <ErrorState
          title={loadError?.title ?? t('profile.loadError')}
          message={loadError?.explanation ?? t('profile.loadError')}
          testId="profile-load-error"
          action={
            <RetryAction
              label={loadError?.recovery ?? t('common.retry')}
              onRetry={() => void load()}
              testId="profile-load-retry"
            />
          }
        />
      </main>
    );
  }

  const saveTone =
    saveStatus === 'error' || saveStatus === 'validation'
      ? 'error'
      : saveStatus === 'success'
        ? 'success'
        : saveStatus === 'saving'
          ? 'info'
          : 'info';

  const roleLabel = user?.role ?? '—';
  const tierLabel = user?.tier ?? 'FREE';
  const emailLabel = user?.email?.trim() ? user.email : t('settings.account.emailMissing');

  return (
    <main className="wa-settings">
      <h1 data-testid="profile-heading">{t('profile.title')}</h1>
      <p className="wa-settings-lead">{t('profile.subtitle')}</p>

      <section className="wa-settings-section" data-testid="settings-account-section" aria-labelledby={`${formId}-account`}>
        <h2 id={`${formId}-account`}>{t('settings.account.title')}</h2>
        <dl className="wa-settings-readonly">
          <dt>{t('settings.account.email')}</dt>
          <dd data-testid="settings-account-email">{emailLabel}</dd>
          <dt>{t('settings.account.role')}</dt>
          <dd data-testid="settings-account-role">{roleLabel}</dd>
          <dt>{t('settings.account.tier')}</dt>
          <dd data-testid="settings-account-tier">{tierLabel}</dd>
        </dl>
        <p className="wa-settings-lead">{t('settings.account.readOnlyNote')}</p>
      </section>

      {sectionError ? (
        <InlineNotice
          tone="warning"
          message={sectionError.explanation || t('settings.partialLoad')}
          testId="settings-partial-notice"
        >
          <RetryAction label={t('common.retry')} onRetry={() => void load()} testId="settings-partial-retry" />
        </InlineNotice>
      ) : null}

      {showLegacyPrompt ? (
        <p role="note" data-testid="profile-legacy-structure-prompt">
          {t('profile.legacyStructurePrompt')}
        </p>
      ) : null}
      {saveMessage ? (
        <InlineNotice tone={saveTone} message={saveMessage} testId="profile-status">
          {saveStatus === 'error' ? (
            <RetryAction
              label={t('common.retry')}
              onRetry={() => {
                const formEl = document.querySelector<HTMLFormElement>('[data-testid="profile-form"]');
                formEl?.requestSubmit();
              }}
              testId="profile-save-retry"
            />
          ) : null}
        </InlineNotice>
      ) : null}
      {sideError ? <InlineNotice tone="warning" message={sideError} testId="profile-side-error" /> : null}

      <form onSubmit={onSubmit} data-testid="profile-form" noValidate aria-busy={formBusy || undefined}>
        <div className={formBusy ? 'wa-settings-form-busy' : undefined}>
        <section
          className="wa-settings-section"
          id="app-settings"
          data-testid="settings-app-section"
          aria-labelledby={`${formId}-app`}
        >
          <h2 id={`${formId}-app`}>{t('settings.app.title')}</h2>
          <div className="wa-settings-fields">
            <label>
              {t('profile.language')}
              <select
                name="locale"
                data-testid="profile-locale"
                value={form.locale}
                onChange={(e) => void onLanguageChange(e.target.value as AppLocale)}
              >
                <option value="ru">{t('profile.languageRu')}</option>
                <option value="en">{t('profile.languageEn')}</option>
              </select>
            </label>
          </div>
          <p className="wa-settings-lead">{t('settings.app.localeHint')}</p>
        </section>

        <section
          className="wa-settings-section"
          id="profile"
          data-testid="settings-profile-section"
          aria-labelledby={`${formId}-profile`}
        >
          <h2 id={`${formId}-profile`}>{t('settings.profile.title')}</h2>
          {profileSection === 'error' ? (
            <InlineNotice tone="warning" message={t('settings.profile.loadWarn')} testId="settings-profile-warn" />
          ) : null}
          <div className="wa-settings-fields">
            <label>
              {t('profile.name')}
              <input
                name="displayName"
                data-testid="profile-name"
                value={form.displayName}
                aria-invalid={fieldErrors.displayName ? true : undefined}
                aria-describedby={fieldErrors.displayName ? `${formId}-name-err` : undefined}
                ref={(el) => markField('displayName', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))}
                autoComplete="name"
                required
                minLength={2}
              />
              {fieldErrors.displayName ? (
                <p id={`${formId}-name-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.displayName}
                </p>
              ) : null}
            </label>
            <label>
              {t('profile.age')}
              <input
                name="ageYears"
                data-testid="profile-age"
                type="number"
                min={14}
                max={100}
                value={form.ageYears}
                aria-invalid={fieldErrors.ageYears ? true : undefined}
                aria-describedby={fieldErrors.ageYears ? `${formId}-age-err` : undefined}
                ref={(el) => markField('ageYears', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, ageYears: e.target.value }))}
                required
              />
              {fieldErrors.ageYears ? (
                <p id={`${formId}-age-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.ageYears}
                </p>
              ) : null}
            </label>
            <label>
              {t('profile.height')}
              <input
                name="heightCm"
                data-testid="profile-height"
                type="number"
                min={120}
                max={230}
                value={form.heightCm}
                aria-invalid={fieldErrors.heightCm ? true : undefined}
                aria-describedby={fieldErrors.heightCm ? `${formId}-height-err` : undefined}
                ref={(el) => markField('heightCm', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, heightCm: e.target.value }))}
                required
              />
              {fieldErrors.heightCm ? (
                <p id={`${formId}-height-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.heightCm}
                </p>
              ) : null}
            </label>
            <label>
              {t('profile.weight')}
              <input
                name="weightKg"
                data-testid="profile-weight"
                type="number"
                min={35}
                max={250}
                step="0.1"
                value={form.weightKg}
                aria-invalid={fieldErrors.weightKg ? true : undefined}
                aria-describedby={fieldErrors.weightKg ? `${formId}-weight-err` : undefined}
                ref={(el) => markField('weightKg', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, weightKg: e.target.value }))}
                required
              />
              {fieldErrors.weightKg ? (
                <p id={`${formId}-weight-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.weightKg}
                </p>
              ) : null}
            </label>
            <label>
              {t('profile.activity')}
              <select
                name="activityLevel"
                data-testid="profile-activity"
                value={form.activityLevel}
                onChange={(e) =>
                  setForm((current) => ({ ...current, activityLevel: e.target.value as ActivityLevel }))
                }
              >
                <option value="sedentary">{t('profile.activitySedentary')}</option>
                <option value="light">{t('profile.activityLight')}</option>
                <option value="moderate">{t('profile.activityModerate')}</option>
                <option value="active">{t('profile.activityActive')}</option>
                <option value="very_active">{t('profile.activityVeryActive')}</option>
              </select>
            </label>
            <label>
              {t('profile.trainingLevel')}
              <select
                name="trainingLevel"
                data-testid="profile-training-level"
                value={form.trainingLevel}
                onChange={(e) =>
                  setForm((current) => ({ ...current, trainingLevel: e.target.value as TrainingLevel }))
                }
              >
                <option value="">{t('profile.trainingLevelUnset')}</option>
                <option value="BEGINNER">{t('profile.trainingBeginner')}</option>
                <option value="INTERMEDIATE">{t('profile.trainingIntermediate')}</option>
                <option value="ADVANCED">{t('profile.trainingAdvanced')}</option>
              </select>
            </label>
            <label>
              {t('profile.workoutsPerWeek')}
              <input
                name="workoutsPerWeek"
                data-testid="profile-workouts-per-week"
                type="number"
                min={0}
                max={14}
                value={form.workoutsPerWeek}
                aria-invalid={fieldErrors.workoutsPerWeek ? true : undefined}
                aria-describedby={fieldErrors.workoutsPerWeek ? `${formId}-workouts-err` : undefined}
                ref={(el) => markField('workoutsPerWeek', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, workoutsPerWeek: e.target.value }))}
              />
              {fieldErrors.workoutsPerWeek ? (
                <p id={`${formId}-workouts-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.workoutsPerWeek}
                </p>
              ) : null}
            </label>
          </div>
        </section>

        <section
          className="wa-settings-section"
          id="goal"
          data-testid="settings-goal-section"
          aria-labelledby={`${formId}-goal`}
        >
          <h2 id={`${formId}-goal`}>{t('settings.goal.title')}</h2>
          {goalSection === 'error' ? (
            <InlineNotice tone="warning" message={t('settings.goal.loadWarn')} testId="settings-goal-warn" />
          ) : null}
          <div className="wa-settings-fields">
            <label>
              {t('profile.goal')}
              <select
                name="goalKind"
                data-testid="profile-goal-kind"
                value={form.goalKind}
                aria-invalid={fieldErrors.goalKind ? true : undefined}
                aria-describedby={fieldErrors.goalKind ? `${formId}-goal-kind-err` : undefined}
                ref={(el) => markField('goalKind', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, goalKind: e.target.value }))}
              >
                <option value="lose_weight">{t('profile.goalLose')}</option>
                <option value="maintain">{t('profile.goalMaintain')}</option>
                <option value="gain_muscle">{t('profile.goalGain')}</option>
              </select>
              {fieldErrors.goalKind ? (
                <p id={`${formId}-goal-kind-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.goalKind}
                </p>
              ) : null}
            </label>
            <label>
              {t('profile.goalTarget')}
              <input
                name="goalTarget"
                data-testid="profile-goal-target"
                type="number"
                min={1}
                max={250}
                step="0.1"
                value={form.goalTarget}
                aria-invalid={fieldErrors.goalTarget ? true : undefined}
                aria-describedby={fieldErrors.goalTarget ? `${formId}-goal-target-err` : undefined}
                ref={(el) => markField('goalTarget', el, fieldErrors)}
                onChange={(e) => setForm((current) => ({ ...current, goalTarget: e.target.value }))}
                required
              />
              {fieldErrors.goalTarget ? (
                <p id={`${formId}-goal-target-err`} className="wa-settings-field-error" role="alert">
                  {fieldErrors.goalTarget}
                </p>
              ) : null}
            </label>
            <label>
              {t('profile.targetDate')}
              <input
                name="targetDate"
                data-testid="profile-target-date"
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm((current) => ({ ...current, targetDate: e.target.value }))}
              />
            </label>
          </div>
        </section>

        <section
          className="wa-settings-section"
          data-testid="settings-preferences-section"
          aria-labelledby={`${formId}-prefs`}
        >
          <h2 id={`${formId}-prefs`}>{t('settings.preferences.title')}</h2>
          <ControlledCodeGroup
            title={t('profile.allergensSection')}
            testId="profile-allergens"
            codes={CONTROLLED_ALLERGEN_CODES}
            selected={form.allergenCodes}
            labelFor={(code) => t(profileAllergenKey(code))}
            disabled={formBusy}
            onToggle={(code) => {
              flushSync(() => {
                setForm((f) => ({ ...f, allergenCodes: toggleCode(f.allergenCodes, code) }));
              });
            }}
          />
          <ControlledCodeGroup
            title={t('profile.dietarySection')}
            testId="profile-dietary-codes"
            codes={CONTROLLED_DIETARY_CODES}
            selected={form.dietaryCodes}
            labelFor={(code) => t(profileDietaryKey(code))}
            disabled={formBusy}
            onToggle={(code) => {
              flushSync(() => {
                setForm((f) => ({ ...f, dietaryCodes: toggleCode(f.dietaryCodes, code) }));
              });
            }}
          />
          <ControlledCodeGroup
            title={t('profile.intolerancesSection')}
            testId="profile-intolerances"
            codes={CONTROLLED_INTOLERANCE_CODES}
            selected={form.intoleranceCodes}
            labelFor={(code) => t(profileIntoleranceKey(code))}
            disabled={formBusy}
            onToggle={(code) => {
              flushSync(() => {
                setForm((f) => ({ ...f, intoleranceCodes: toggleCode(f.intoleranceCodes, code) }));
              });
            }}
          />
          <ControlledCodeGroup
            title={t('profile.equipmentSection')}
            testId="profile-equipment-codes"
            codes={CONTROLLED_EQUIPMENT_CODES}
            selected={form.equipmentCodes}
            labelFor={(code) => t(profileEquipmentKey(code))}
            disabled={formBusy}
            onToggle={(code) => {
              flushSync(() => {
                setForm((f) => ({ ...f, equipmentCodes: toggleCode(f.equipmentCodes, code) }));
              });
            }}
          />
          <div className="wa-settings-fields">
            <label>
              {t('profile.dietaryPreferencesNote')}
              <input
                name="dietaryPreferencesNote"
                data-testid="profile-dietary-preferences"
                value={form.dietaryPreferencesNote}
                onChange={(e) =>
                  setForm((current) => ({ ...current, dietaryPreferencesNote: e.target.value }))
                }
                placeholder={t('profile.csvHint')}
              />
            </label>
            <label>
              {t('profile.foodRestrictionsNote')}
              <input
                name="foodRestrictionsNote"
                data-testid="profile-food-restrictions"
                value={form.foodRestrictionsNote}
                onChange={(e) =>
                  setForm((current) => ({ ...current, foodRestrictionsNote: e.target.value }))
                }
                placeholder={t('profile.csvHint')}
              />
            </label>
            <label>
              {t('profile.equipmentNote')}
              <input
                name="equipmentNote"
                data-testid="profile-available-equipment"
                value={form.equipmentNote}
                onChange={(e) => setForm((current) => ({ ...current, equipmentNote: e.target.value }))}
                placeholder={t('profile.csvHint')}
              />
            </label>
          </div>
        </section>

        {showLegacyPrompt ? (
          <label data-testid="profile-legacy-structure-confirm">
            <input
              type="checkbox"
              checked={form.legacyStructureConfirmed}
              aria-invalid={fieldErrors.legacy ? true : undefined}
              aria-describedby={fieldErrors.legacy ? `${formId}-legacy-err` : undefined}
              ref={(el) => markField('legacy', el, fieldErrors)}
              onChange={(e) =>
                setForm((current) => ({ ...current, legacyStructureConfirmed: e.target.checked }))
              }
            />
            {t('profile.legacyStructureConfirm')}
            {fieldErrors.legacy ? (
              <p id={`${formId}-legacy-err`} className="wa-settings-field-error" role="alert">
                {fieldErrors.legacy}
              </p>
            ) : null}
          </label>
        ) : null}
        </div>

        <div className="wa-settings-actions">
          <button
            type="submit"
            data-testid="profile-save"
            disabled={formBusy || !dirty}
          >
            {formBusy ? t('common.saving') : t('common.save')}
          </button>
          {dirty ? (
            <span className="wa-settings-lead" data-testid="settings-dirty-hint">
              {t('settings.unsavedHint')}
            </span>
          ) : null}
        </div>
      </form>

      <ActivityConnectionsPanel formId={formId} />

      <section
        className="wa-settings-section"
        data-testid="settings-security-section"
        aria-labelledby={`${formId}-security`}
      >
        <h2 id={`${formId}-security`}>{t('settings.security.title')}</h2>
        <p className="wa-settings-lead">{t('settings.security.body')}</p>
        <div className="wa-settings-actions">
          <button
            type="button"
            data-testid="settings-logout"
            onClick={() => void onLogout()}
            disabled={logoutBusy || authStatus !== 'authenticated'}
          >
            {logoutBusy ? t('common.loading') : t('auth.logout')}
          </button>
        </div>
      </section>
    </main>
  );
}
