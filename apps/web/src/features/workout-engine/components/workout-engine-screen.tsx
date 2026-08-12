'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '@/lib/api-fetch';
import { useI18n } from '../../../i18n/locale-provider';
import type { MessageKey } from '../../../i18n/types';
import {
  applyWorkoutAdaptation,
  applyWorkoutReplacement,
  generateWorkoutPlan,
  getActiveWorkoutSession,
  previewWorkoutAdaptation,
  getWorkoutExercise,
  getWorkoutProfile,
  getWorkoutReplacementOptions,
  getWorkoutSetup,
  getWorkoutToday,
  getWorkoutWeek,
  revertWorkoutReplacement,
  startWorkoutSession,
  undoWorkoutAdaptation,
  updateWorkoutProfile,
  WorkoutActiveSessionError,
} from '../api/workout-engine.client';
import type {
  PreferredDuration,
  TrainingLevel,
  TrainingPlace,
  WorkoutEquipmentCode,
  WorkoutExerciseDetail,
  WorkoutAdaptation,
  WorkoutAdaptationIntent,
  WorkoutAdaptationPreview,
  WorkoutPlanDay,
  WorkoutPlanDayOverride,
  WorkoutPlanExercise,
  WorkoutProfile,
  WorkoutReplacementOption,
  WorkoutReplacementType,
  WorkoutSession,
  WorkoutSetupStatus,
  WorkoutToday,
  WorkoutWeek,
} from '../model/workout-engine.types';
import {
  buildChangeTodayOptions,
  type ChangeTodayOption,
} from '../model/change-today-options';
import {
  resolveTodayHubState,
  resolveWeekDayVisualStatus,
  type TodayHubState,
} from '../model/today-hub-state';
import { ChangeTodaySheet } from './change-today-sheet';

type Tab = 'today' | 'week' | 'plan';
type Status = 'loading' | 'ready' | 'error' | 'forbidden';

const TABS: Tab[] = ['today', 'week', 'plan'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const EQUIPMENT: WorkoutEquipmentCode[] = [
  'NONE', 'BODYWEIGHT', 'RESISTANCE_BAND', 'DUMBBELL', 'KETTLEBELL',
  'BENCH', 'PULLUP_BAR', 'GYM_MACHINES', 'BARBELL', 'CARDIO_MACHINE',
];
const ACTIVITIES = ['strength', 'walking', 'mobility', 'cardio'];
const panelStyle = {
  border: '1px solid var(--ui-border, #d7d7d7)',
  borderRadius: '0.75rem',
  padding: '1rem',
  marginBottom: '1rem',
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  boxSizing: 'border-box',
} as const;

function uiError(error: unknown, t: (key: MessageKey) => string): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHORIZED') return t('workout.unauthenticated');
    if (error.code === 'FORBIDDEN') return t('workout.forbidden');
    const map: Record<string, MessageKey> = {
      WORKOUT_SETUP_INCOMPLETE: 'workout.setupIncomplete',
      WORKOUT_CATALOG_INSUFFICIENT: 'workout.catalogInsufficient',
      WORKOUT_PLAN_GENERATE_IN_PROGRESS: 'workout.generateConflict',
      WORKOUT_REPLACEMENT_IN_PROGRESS: 'workout.generateConflict',
      WORKOUT_PLAN_VERSION_CONFLICT: 'workout.generateConflict',
      WORKOUT_PLAN_NOT_FOUND: 'workout.empty',
      WORKOUT_EXERCISE_NOT_FOUND: 'workout.exerciseError',
    };
    if (map[error.message]) return t(map[error.message]!);
  }
  return t('workout.error');
}

function toggle<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function exactReps(exercise: WorkoutPlanExercise): string | null {
  // Active USER prescription matches session seed policy: max ?? min.
  if (exercise.repsMax != null) return String(exercise.repsMax);
  if (exercise.repsMin != null) return String(exercise.repsMin);
  return null;
}

function prescriptionLabel(
  exercise: WorkoutPlanExercise,
  t: (key: MessageKey) => string,
): string {
  const sets = exercise.sets != null ? `${exercise.sets} ${t('workout.sets')}` : null;
  if (exercise.prescriptionMode === 'DURATION' || exercise.durationSecondsPerSet != null) {
    const duration =
      exercise.durationSecondsPerSet != null
        ? `${exercise.durationSecondsPerSet}${t('workout.secondsSuffix')}`
        : null;
    if (sets && duration) return ` · ${sets} × ${duration}`;
    if (duration) return ` · ${duration}`;
    return sets ? ` · ${sets}` : '';
  }
  const reps = exactReps(exercise);
  if (sets && reps) return ` · ${sets} × ${reps} ${t('workout.reps')}`;
  if (sets) return ` · ${sets}`;
  if (reps) return ` · ${reps} ${t('workout.reps')}`;
  return '';
}

export function WorkoutEngineScreen() {
  const { t, tc, locale } = useI18n();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>('today');
  const [status, setStatus] = useState<Status>('loading');
  const [today, setToday] = useState<WorkoutToday>();
  const [week, setWeek] = useState<WorkoutWeek>();
  const [setup, setSetup] = useState<WorkoutSetupStatus>();
  const [profile, setProfile] = useState<WorkoutProfile>();
  const [savedProfile, setSavedProfile] = useState<WorkoutProfile>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [planNeedsUpdate, setPlanNeedsUpdate] = useState(false);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [replacementDay, setReplacementDay] = useState<number | null>(null);
  const [replacementOptions, setReplacementOptions] = useState<WorkoutReplacementOption[]>([]);
  const [replacementIndex, setReplacementIndex] = useState(0);
  const [lastOverride, setLastOverride] = useState<WorkoutPlanDayOverride>();
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null);
  const [adaptationSessionId, setAdaptationSessionId] = useState<string>();
  const [adaptationPreview, setAdaptationPreview] = useState<WorkoutAdaptationPreview>();
  const [lastAdaptation, setLastAdaptation] = useState<WorkoutAdaptation>();
  const [exercise, setExercise] = useState<WorkoutExerciseDetail>();
  const [exerciseLoading, setExerciseLoading] = useState(false);
  const [changeTodayDay, setChangeTodayDay] = useState<number | null>(null);
  const [changeTodayOptions, setChangeTodayOptions] = useState<ChangeTodayOption[]>([]);
  const [changeBusyKey, setChangeBusyKey] = useState<string | null>(null);
  const [softError, setSoftError] = useState('');
  const generatingRef = useRef(false);
  const startingRef = useRef(false);
  const changingRef = useRef(false);
  const statusRef = useRef(status);
  const todayRef = useRef(today);
  const changeTodayTriggerRef = useRef<HTMLButtonElement>(null);
  statusRef.current = status;
  todayRef.current = today;

  function setTab(next: Tab) {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    if (statusRef.current === 'ready' || todayRef.current) {
      void load({ soft: true });
    }
  }

  async function load(opts?: { soft?: boolean }) {
    const soft = Boolean(opts?.soft) && (statusRef.current === 'ready' || Boolean(todayRef.current));
    if (!soft) {
      setStatus('loading');
      setMessage('');
      setSoftError('');
    }
    try {
      const [nextToday, nextWeek, nextProfile, nextSetup, nextActive] = await Promise.all([
        getWorkoutToday(),
        getWorkoutWeek(),
        getWorkoutProfile(),
        getWorkoutSetup(),
        getActiveWorkoutSession().catch(() => null),
      ]);
      setToday(nextToday);
      setWeek(nextWeek);
      setProfile(nextProfile);
      setSavedProfile(nextProfile);
      setSetup(nextSetup);
      setActiveSession(nextActive);
      setSoftError('');
      setStatus('ready');
    } catch (error) {
      const human = uiError(error, t);
      if (soft) {
        setSoftError(human);
        return;
      }
      setMessage(human);
      setStatus(error instanceof ApiError && error.code === 'FORBIDDEN' ? 'forbidden' : 'error');
    }
  }

  function openSession(sessionId: string) {
    router.push(`/workout-engine/session/${sessionId}`);
  }

  async function startTodaySession() {
    if (startingRef.current) return;
    if (activeSession?.status === 'ACTIVE') {
      openSession(activeSession.id);
      return;
    }
    startingRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const session = await startWorkoutSession(
        today?.dayIndex != null ? { dayIndex: today.dayIndex } : undefined,
      );
      setActiveSession(session);
      openSession(session.id);
    } catch (error) {
      if (error instanceof WorkoutActiveSessionError) {
        openSession(error.activeSessionId);
        return;
      }
      setMessage(t('workout.startError'));
    } finally {
      startingRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && TABS.includes(requested as Tab)) setTabState(requested as Tab);
    void load();
  }, []);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = TABS.indexOf(tab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (current + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next]!);
    document.getElementById(`workout-tab-${TABS[next]}`)?.focus();
  }

  async function refreshPlan() {
    try {
      const [nextToday, nextWeek] = await Promise.all([getWorkoutToday(), getWorkoutWeek()]);
      setToday(nextToday);
      setWeek(nextWeek);
      setSoftError('');
    } catch (error) {
      if (todayRef.current || week) {
        setSoftError(uiError(error, t));
        return;
      }
      throw error;
    }
  }

  async function generate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      await generateWorkoutPlan();
      await refreshPlan();
      setPlanNeedsUpdate(false);
      setMessage(t('workout.generateSuccess'));
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      generatingRef.current = false;
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!profile) return;
    setBusy(true);
    setMessage('');
    try {
      const significant = savedProfile
        ? JSON.stringify(profile) !== JSON.stringify(savedProfile)
        : true;
      const saved = await updateWorkoutProfile({
        trainingLevel: profile.trainingLevel,
        trainingPlace: profile.trainingPlace,
        workoutsPerWeek: profile.workoutsPerWeek,
        preferredDuration: profile.preferredDuration,
        availableDays: profile.availableDays,
        workoutEquipment: profile.workoutEquipment,
        preferredActivityTypes: profile.preferredActivityTypes,
        excludedExerciseKeys: profile.excludedExerciseKeys,
      });
      setProfile(saved);
      setSavedProfile(saved);
      setPlanNeedsUpdate(significant && Boolean(week?.days.length));
      setMessage(t('workout.profileSaved'));
      setSetup(await getWorkoutSetup());
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function openChangeToday(dayIndex: number, hubKind: TodayHubState['kind']) {
    setBusy(true);
    setMessage('');
    try {
      const allowPlanChanges = hubKind !== 'active';
      const replacements = allowPlanChanges
        ? await getWorkoutReplacementOptions(dayIndex)
        : [];
      setReplacementOptions(replacements);
      const options = buildChangeTodayOptions({
        replacements: replacements.map((item) => ({
          type: item.type,
          moveTargetDayIndex: item.moveTargetDayIndex ?? undefined,
        })),
        allowAdaptation: hubKind === 'active' || hubKind === 'scheduled',
      });
      setChangeTodayOptions(options);
      setChangeTodayDay(dayIndex);
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function openAdaptations(dayIndex: number) {
    setBusy(true);
    setMessage('');
    try {
      const session = activeSession?.status === 'ACTIVE'
        ? activeSession
        : await startWorkoutSession({ dayIndex });
      setActiveSession(session);
      setAdaptationSessionId(session.id);
      setAdaptationPreview(await previewWorkoutAdaptation(session.id, 'HOME'));
    } catch (error) {
      if (error instanceof WorkoutActiveSessionError) {
        setAdaptationSessionId(error.activeSessionId);
        setAdaptationPreview(await previewWorkoutAdaptation(error.activeSessionId, 'HOME'));
      } else {
        setMessage(uiError(error, t));
      }
    } finally {
      setBusy(false);
    }
  }

  async function selectChangeTodayOption(option: ChangeTodayOption) {
    if (changeTodayDay == null || changingRef.current) return;
    const dayIndex = changeTodayDay;
    if (option.kind === 'adaptation') {
      setChangeTodayDay(null);
      await openAdaptations(dayIndex);
      return;
    }
    if (!option.replacementType) return;
    if (typeof window !== 'undefined' && !window.confirm(t('workout.changeTodayConfirm'))) {
      return;
    }
    changingRef.current = true;
    setChangeBusyKey(option.id);
    setBusy(true);
    try {
      if (option.replacementType === 'MOVE_DAY' && option.moveTargetDayIndex == null) {
        setMessage(t('workout.error'));
        return;
      }
      const override = await applyWorkoutReplacement(dayIndex, {
        replacementType: option.replacementType,
        moveTargetDayIndex:
          option.replacementType === 'MOVE_DAY' ? option.moveTargetDayIndex : undefined,
      });
      setLastOverride(override);
      setChangeTodayDay(null);
      await refreshPlan();
      setMessage(t('workout.replacementApplied'));
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      changingRef.current = false;
      setChangeBusyKey(null);
      setBusy(false);
    }
  }

  async function selectAdaptationIntent(intent: WorkoutAdaptationIntent) {
    if (!adaptationSessionId) return;
    setBusy(true);
    try {
      setAdaptationPreview(await previewWorkoutAdaptation(adaptationSessionId, intent));
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function applyAdaptation(optionCode: string) {
    if (!adaptationSessionId || !adaptationPreview) return;
    const option = [adaptationPreview.recommended, ...adaptationPreview.alternatives]
      .find((item) => item?.optionCode === optionCode);
    if (!option) return;
    setBusy(true);
    try {
      const result = await applyWorkoutAdaptation(adaptationSessionId, {
        intent: adaptationPreview.intent,
        optionCode,
        expectedSessionVersion: adaptationPreview.sessionVersion,
        expectedCatalogReleaseId: adaptationPreview.catalogReleaseId,
        policyVersion: adaptationPreview.policyVersion,
        optionFingerprint: option.optionFingerprint,
        idempotencyKey: crypto.randomUUID(),
      });
      setLastAdaptation(result.adaptation);
      setAdaptationPreview(undefined);
      setMessage(t('workout.adaptationApplied'));
      await refreshPlan();
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function undoAdaptation() {
    if (!adaptationSessionId || !lastAdaptation) return;
    setBusy(true);
    try {
      await undoWorkoutAdaptation(adaptationSessionId, {
        expectedSessionVersion: lastAdaptation.sessionVersionAfter,
        adaptationId: lastAdaptation.id,
        idempotencyKey: crypto.randomUUID(),
      });
      setLastAdaptation(undefined);
      setMessage(t('workout.adaptationReverted'));
      await refreshPlan();
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function applyReplacement() {
    const option = replacementOptions[replacementIndex];
    if (replacementDay == null || !option) return;
    if (option.type === 'MOVE_DAY' && option.moveTargetDayIndex == null) {
      setMessage(t('workout.error'));
      return;
    }
    setBusy(true);
    try {
      const override = await applyWorkoutReplacement(replacementDay, {
        replacementType: option.type,
        moveTargetDayIndex:
          option.type === 'MOVE_DAY' ? option.moveTargetDayIndex : undefined,
      });
      setLastOverride(override);
      await refreshPlan();
      setMessage(t('workout.replacementApplied'));
      setReplacementDay(null);
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function undoReplacement() {
    if (!lastOverride) return;
    setBusy(true);
    try {
      await revertWorkoutReplacement(lastOverride.id);
      setLastOverride(undefined);
      await refreshPlan();
      setMessage(t('workout.replacementReverted'));
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function showExercise(key: string) {
    setExerciseLoading(true);
    setMessage('');
    try {
      setExercise(await getWorkoutExercise(key));
    } catch (error) {
      setMessage(uiError(error, t));
    } finally {
      setExerciseLoading(false);
    }
  }

  if (status === 'loading') {
    return <main aria-busy="true" data-testid="workout-engine-loading"><h1>{t('workout.title')}</h1><p>{t('workout.loading')}</p></main>;
  }
  if (status === 'forbidden' || status === 'error') {
    return (
      <main role="alert" data-testid={`workout-engine-${status}`}>
        <h1>{t('workout.title')}</h1><p>{message}</p>
        {status === 'error' ? <button className="ui-cta" type="button" onClick={() => void load()}>{t('workout.retry')}</button> : null}
      </main>
    );
  }

  const dateLabel = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'ru', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());

  const todaySession = today?.todaySession ?? null;
  const hub = resolveTodayHubState({
    hasPlanDay: Boolean(today?.day),
    isRestDay: Boolean(today?.day?.isRestDay),
    exerciseCount: today?.day?.exercises.length ?? 0,
    todaySession: todaySession
      ? {
          id: todaySession.id,
          status: todaySession.status,
          completedExercises: todaySession.completedExercises,
          totalExercises: todaySession.totalExercises,
          durationSeconds: todaySession.durationSeconds,
        }
      : null,
    activeSessionId: activeSession?.status === 'ACTIVE' ? activeSession.id : null,
  });

  const primarySessionId =
    hub.primary === 'continue'
      ? (hub.sessionId ?? (activeSession?.status === 'ACTIVE' ? activeSession.id : null))
      : null;

  function formatDuration(seconds?: number | null) {
    if (seconds == null || seconds < 0) return null;
    const mins = Math.round(seconds / 60);
    return `${mins} ${t('workout.minutesShort')}`;
  }

  return (
    <main data-testid="workout-engine-main" style={{ maxWidth: '52rem' }}>
      <h1 data-testid="workout-heading">{t('workout.title')}</h1>
      <div role="tablist" aria-label={t('workout.tabsLabel')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        {TABS.map((item) => (
          <button
            key={item}
            id={`workout-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`workout-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? 'ui-cta' : undefined}
            data-testid={`workout-tab-${item}`}
            onClick={() => setTab(item)}
            onKeyDown={onTabKeyDown}
          >
            {t(`workout.tab.${item}` as MessageKey)}
          </button>
        ))}
      </div>

      <div aria-live="polite" data-testid="workout-live">
        {message ? <p>{message} {lastOverride ? <button type="button" disabled={busy} data-testid="workout-replacement-undo" onClick={() => void undoReplacement()}>{t('workout.undo')}</button> : null} {lastAdaptation ? <button type="button" disabled={busy} data-testid="workout-adaptation-undo" onClick={() => void undoAdaptation()}>{t('workout.undo')}</button> : null}</p> : null}
        {softError ? (
          <p role="status" data-testid="workout-soft-error">
            {softError}{' '}
            <button
              type="button"
              className="ui-button-secondary"
              data-testid="workout-soft-retry"
              disabled={busy}
              onClick={() => void load({ soft: true })}
            >
              {t('workout.retry')}
            </button>
          </p>
        ) : null}
      </div>

      {tab === 'today' ? (
        <section id="workout-panel-today" role="tabpanel" aria-labelledby="workout-tab-today" data-testid="workout-today">
          <h2>{t('workout.todayTitle')}</h2>
          <p style={{ textTransform: 'capitalize' }}>{dateLabel}</p>

          {!today?.day && hub.kind !== 'active' && hub.kind !== 'completed' ? (
            <EmptyPlan setup={setup} onPlan={() => setTab('plan')} t={t} />
          ) : null}

          {hub.kind === 'completed' ? (
            <div style={panelStyle} data-testid="workout-today-completed">
              <h3>{t('workout.completedTitle')}</h3>
              <p>{t('workout.completedSummary')}</p>
              {todaySession?.durationSeconds != null ? (
                <p>{t('workout.completedDuration')}: {formatDuration(todaySession.durationSeconds)}</p>
              ) : null}
              {todaySession?.completedExercises != null && todaySession.totalExercises != null ? (
                <p>{t('workout.exerciseCount')}: {todaySession.completedExercises}/{todaySession.totalExercises}</p>
              ) : null}
              <button
                type="button"
                className="ui-button-secondary"
                data-testid="workout-view-week"
                onClick={() => setTab('week')}
              >
                {t('workout.viewWeek')}
              </button>
            </div>
          ) : null}

          {today?.day && hub.kind !== 'completed' ? (
            <DayCard
              day={today.day}
              locale={locale}
              t={t}
              tc={tc}
              onExercise={showExercise}
              statusLabel={
                hub.kind === 'active'
                  ? t('workout.status.inProgress')
                  : hub.kind === 'rest'
                    ? t('workout.status.rest')
                    : t('workout.status.today')
              }
              expanded
            >
              {hub.primary === 'continue' && primarySessionId ? (
                <button
                  type="button"
                  className="ui-cta"
                  data-testid="workout-continue"
                  disabled={busy}
                  onClick={() => openSession(primarySessionId)}
                >
                  {t('workout.continue')}
                </button>
              ) : null}
              {hub.primary === 'start' ? (
                <button
                  type="button"
                  className="ui-cta"
                  data-testid="workout-start"
                  disabled={busy}
                  onClick={() => void startTodaySession()}
                >
                  {t('workout.start')}
                </button>
              ) : null}
              {hub.showChangeToday ? (
                <button
                  ref={changeTodayTriggerRef}
                  type="button"
                  className="ui-button-secondary"
                  data-testid={`workout-change-today-${today.day.dayIndex}`}
                  disabled={busy}
                  onClick={() => void openChangeToday(today.day!.dayIndex, hub.kind)}
                >
                  {t('workout.changeToday')}
                </button>
              ) : null}
              {hub.showWeekLink ? (
                <button
                  type="button"
                  className="ui-button-secondary"
                  data-testid="workout-view-week"
                  onClick={() => setTab('week')}
                >
                  {t('workout.viewWeek')}
                </button>
              ) : null}
            </DayCard>
          ) : null}

          {!today?.day && hub.primary === 'continue' && primarySessionId ? (
            <p style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="ui-cta"
                data-testid="workout-continue"
                disabled={busy}
                onClick={() => openSession(primarySessionId)}
              >
                {t('workout.continue')}
              </button>
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === 'week' ? (
        <section id="workout-panel-week" role="tabpanel" aria-labelledby="workout-tab-week" data-testid="workout-week">
          <h2>{t('workout.weekTitle')}</h2>
          {!week?.days.length ? <EmptyPlan setup={setup} onPlan={() => setTab('plan')} t={t} /> : (
            <div data-testid="workout-plan">
              <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {week.days.map((day) => {
                  const visual = resolveWeekDayVisualStatus({
                    dayIndex: day.dayIndex,
                    todayIndex: today?.dayIndex ?? day.dayIndex,
                    isRestDay: day.isRestDay,
                    todaySessionStatus: day.dayIndex === today?.dayIndex
                      ? (todaySession?.status ?? (activeSession?.status === 'ACTIVE' ? 'ACTIVE' : null))
                      : null,
                  });
                  const statusKey = (
                    visual === 'in_progress'
                      ? 'workout.status.inProgress'
                      : visual === 'today'
                        ? 'workout.status.today'
                        : visual === 'completed'
                          ? 'workout.status.completed'
                          : visual === 'rest'
                            ? 'workout.status.rest'
                            : visual === 'moved'
                              ? 'workout.status.moved'
                              : visual === 'scheduled'
                                ? 'workout.status.scheduled'
                                : 'workout.status.upcoming'
                  ) as MessageKey;
                  const isToday = day.dayIndex === today?.dayIndex;
                  return (
                    <li
                      key={day.dayIndex}
                      data-testid={`workout-day-${day.dayIndex}`}
                      style={{
                        ...panelStyle,
                        borderColor: isToday ? 'var(--wa-accent, #2a6)' : undefined,
                      }}
                    >
                      <button
                        type="button"
                        aria-expanded={openDay === day.dayIndex}
                        onClick={() => setOpenDay(openDay === day.dayIndex ? null : day.dayIndex)}
                        style={{
                          display: 'flex',
                          width: '100%',
                          flexWrap: 'wrap',
                          gap: '0.35rem 0.75rem',
                          alignItems: 'baseline',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      >
                        <strong>{t(`workout.weekday.${day.dayIndex}` as MessageKey)}</strong>
                        <span data-testid={`workout-day-status-${day.dayIndex}`}>{t(statusKey)}</span>
                        <span>{day.isRestDay ? t('workout.restDay') : dayLabel(day, locale, t)}</span>
                      </button>
                      <p style={{ margin: '0.35rem 0 0' }}>{dayMeta(day, t)}</p>
                      {openDay === day.dayIndex ? (
                        <DayCard
                          day={day}
                          locale={locale}
                          t={t}
                          tc={tc}
                          onExercise={showExercise}
                          statusLabel={t(statusKey)}
                          expanded
                        >
                          {isToday && hub.showChangeToday ? (
                            <button
                              type="button"
                              data-testid={`workout-change-today-${day.dayIndex}`}
                              disabled={busy}
                              onClick={() => void openChangeToday(day.dayIndex, hub.kind)}
                            >
                              {t('workout.changeToday')}
                            </button>
                          ) : null}
                        </DayCard>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'plan' ? (
        <section id="workout-panel-plan" role="tabpanel" aria-labelledby="workout-tab-plan" data-testid="workout-my-plan">
          <h2>{t('workout.myPlanTitle')}</h2>
          {profile ? (
            <ProfileForm profile={profile} setProfile={setProfile} busy={busy} t={t} onSave={saveProfile} />
          ) : <p>{t('workout.error')}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="ui-cta" data-testid="workout-generate" disabled={busy || !setup?.ready} onClick={() => void generate()}>
              {busy ? t('workout.generating') : planNeedsUpdate || week?.days.length ? t('workout.updatePlan') : t('workout.generate')}
            </button>
          </div>
          {!setup?.ready ? <p>{t('workout.goalSettingsHint')} <Link href="/settings">{t('workout.openSettings')}</Link></p> : null}
        </section>
      ) : null}

      <ChangeTodaySheet
        open={changeTodayDay != null}
        dayIso={String(changeTodayDay ?? '')}
        options={changeTodayOptions}
        busyKey={changeBusyKey}
        returnFocusRef={changeTodayTriggerRef}
        onClose={() => {
          if (!changeBusyKey) setChangeTodayDay(null);
        }}
        onSelect={(option) => void selectChangeTodayOption(option)}
      />

      {replacementDay != null ? (
        <ReplacementPanel
          option={replacementOptions[replacementIndex]}
          count={replacementOptions.length}
          busy={busy}
          t={t}
          onApply={applyReplacement}
          onNext={() => setReplacementIndex((replacementIndex + 1) % replacementOptions.length)}
          onClose={() => setReplacementDay(null)}
        />
      ) : null}
      {adaptationSessionId && adaptationPreview ? (
        <AdaptationPanel
          preview={adaptationPreview}
          busy={busy}
          onIntent={selectAdaptationIntent}
          onApply={applyAdaptation}
          onClose={() => setAdaptationPreview(undefined)}
        />
      ) : null}

      {exercise || exerciseLoading ? (
        <ExercisePanel exercise={exercise} loading={exerciseLoading} locale={locale} t={t} tc={tc} onClose={() => setExercise(undefined)} />
      ) : null}
    </main>
  );
}

function EmptyPlan(props: { setup?: WorkoutSetupStatus; onPlan: () => void; t: (key: MessageKey) => string }) {
  const ready = Boolean(props.setup?.ready);
  return (
    <div data-testid={ready ? 'workout-engine-empty' : 'workout-engine-setup'} style={panelStyle}>
      <p>{ready ? props.t('workout.emptyHint') : props.t('workout.setupRequired')}</p>
      {ready ? (
        <button type="button" className="ui-cta" onClick={props.onPlan}>{props.t('workout.openMyPlan')}</button>
      ) : (
        <p>
          <Link href="/settings" data-testid="workout-open-settings">{props.t('workout.openSettings')}</Link>
        </p>
      )}
    </div>
  );
}

function dayLabel(day: WorkoutPlanDay, locale: string, t: (key: MessageKey) => string) {
  if (locale !== 'en' && day.dayTitle) return day.dayTitle;
  const key = day.exercises[0]?.exerciseKey;
  if (key === 'recovery_walk' || key === 'treadmill_walk') return t('workout.walk');
  return t('workout.session');
}

function dayMeta(day: WorkoutPlanDay, t: (key: MessageKey) => string) {
  const values: string[] = [];
  if (day.trainingPlace) values.push(t(`workout.place.${day.trainingPlace}` as MessageKey));
  if (day.estimatedMinutes != null) values.push(`~${day.estimatedMinutes} ${t('workout.minutesShort')}`);
  return values.join(' · ');
}

function DayCard(props: {
  day: WorkoutPlanDay;
  locale: string;
  t: (key: MessageKey) => string;
  tc: (namespace: 'workout', key: string) => string;
  onExercise: (key: string) => void;
  statusLabel?: string;
  expanded: boolean;
  children?: React.ReactNode;
}) {
  const { day, t } = props;
  return (
    <article style={panelStyle}>
      <h3>{day.isRestDay ? t('workout.restDay') : dayLabel(day, props.locale, t)}</h3>
      {props.statusLabel ? <p data-testid={`workout-day-card-status-${day.dayIndex}`}>{props.statusLabel}</p> : null}
      <p>{dayMeta(day, t)}</p>
      {day.isRestDay ? <p>{t('workout.restDayHint')}</p> : (
        <ul>
          {day.exercises.map((item) => (
            <li key={`${item.exerciseOrder}-${item.exerciseKey ?? item.exerciseName}`} style={{ marginBottom: '0.5rem' }}>
              <strong>{props.tc('workout', item.exerciseKey ?? item.exerciseName)}</strong>
              {prescriptionLabel(item, t)}
              <br />
              <button
                type="button"
                className="ui-button-secondary"
                disabled={!item.exerciseKey}
                onClick={() => item.exerciseKey && props.onExercise(item.exerciseKey)}
              >
                {t('workout.showTechnique')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.children ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
          {props.children}
        </div>
      ) : null}
    </article>
  );
}

function ProfileForm(props: {
  profile: WorkoutProfile;
  setProfile: (profile: WorkoutProfile) => void;
  busy: boolean;
  t: (key: MessageKey) => string;
  onSave: () => void;
}) {
  const { profile, setProfile, t } = props;
  const update = <K extends keyof WorkoutProfile>(key: K, value: WorkoutProfile[K]) =>
    setProfile({ ...profile, [key]: value });
  return (
    <form onSubmit={(event) => { event.preventDefault(); void props.onSave(); }}>
      <label>{t('workout.trainingLevel')}
        <select data-testid="workout-profile-level" value={profile.trainingLevel} onChange={(event) => update('trainingLevel', event.target.value as TrainingLevel)}>
          {(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as TrainingLevel[]).map((value) => <option key={value} value={value}>{t(`workout.level.${value}` as MessageKey)}</option>)}
        </select>
      </label>
      <label>{t('workout.trainingPlace')}
        <select data-testid="workout-profile-place" value={profile.trainingPlace} onChange={(event) => update('trainingPlace', event.target.value as TrainingPlace)}>
          {(['HOME', 'GYM', 'MIXED'] as TrainingPlace[]).map((value) => <option key={value} value={value}>{t(`workout.place.${value}` as MessageKey)}</option>)}
        </select>
      </label>
      <label>{t('workout.workoutsPerWeek')}
        <select data-testid="workout-profile-frequency" value={profile.workoutsPerWeek} onChange={(event) => update('workoutsPerWeek', Number(event.target.value))}>
          {[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>{t('workout.preferredDuration')}
        <select value={profile.preferredDuration} onChange={(event) => update('preferredDuration', event.target.value as PreferredDuration)}>
          {(['SHORT', 'STANDARD', 'LONG'] as PreferredDuration[]).map((value) => <option key={value} value={value}>{t(`workout.duration.${value}` as MessageKey)}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>{t('workout.availableDays')}</legend>
        {DAYS.map((day) => <label key={day} style={{ display: 'inline-block', marginRight: '0.75rem' }}><input data-testid={`workout-profile-day-${day}`} type="checkbox" checked={profile.availableDays.includes(day)} onChange={() => update('availableDays', toggle(profile.availableDays, day).sort())} /> {t(`workout.weekday.${day}` as MessageKey)}</label>)}
      </fieldset>
      <fieldset>
        <legend>{t('workout.equipment')}</legend>
        {EQUIPMENT.map((item) => <label key={item} style={{ display: 'block' }}><input type="checkbox" checked={profile.workoutEquipment.includes(item)} onChange={() => update('workoutEquipment', toggle(profile.workoutEquipment, item))} /> {t(`workout.equipment.${item}` as MessageKey)}</label>)}
      </fieldset>
      <fieldset>
        <legend>{t('workout.activities')}</legend>
        {ACTIVITIES.map((item) => <label key={item} style={{ display: 'inline-block', marginRight: '0.75rem' }}><input type="checkbox" checked={profile.preferredActivityTypes.includes(item)} onChange={() => update('preferredActivityTypes', toggle(profile.preferredActivityTypes, item))} /> {t(`workout.activity.${item}` as MessageKey)}</label>)}
      </fieldset>
      <label>{t('workout.excludedExercises')}
        <input value={profile.excludedExerciseKeys.join(', ')} onChange={(event) => update('excludedExerciseKeys', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder={t('workout.excludedPlaceholder')} />
      </label>
      <p><button className="ui-cta" type="submit" data-testid="workout-profile-save" disabled={props.busy || profile.availableDays.length === 0}>{t('workout.saveProfile')}</button></p>
    </form>
  );
}

const ADAPTATION_INTENTS: Array<{ code: WorkoutAdaptationIntent; label: string }> = [
  { code: 'HOME', label: 'Провести дома' },
  { code: 'SHORTER', label: 'Сделать короче' },
  { code: 'LIGHTER', label: 'Сделать легче' },
  { code: 'WALK_RECOVERY', label: 'Прогулка или восстановление' },
  { code: 'MOVE_DAY', label: 'Перенести на другой день' },
];

function AdaptationPanel(props: {
  preview: WorkoutAdaptationPreview;
  busy: boolean;
  onIntent: (intent: WorkoutAdaptationIntent) => void;
  onApply: (optionCode: string) => void;
  onClose: () => void;
}) {
  const options = [props.preview.recommended, ...props.preview.alternatives].filter(
    (option): option is NonNullable<typeof option> => Boolean(option),
  );
  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="adaptation-title" style={panelStyle} data-testid="workout-adaptation-panel">
      <h2 id="adaptation-title">Изменить тренировку</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {ADAPTATION_INTENTS.map((intent) => (
          <button key={intent.code} type="button" disabled={props.busy} aria-pressed={props.preview.intent === intent.code} onClick={() => void props.onIntent(intent.code)}>
            {intent.label}
          </button>
        ))}
      </div>
      {props.preview.unavailableReasonRu ? <p>{props.preview.unavailableReasonRu}</p> : null}
      {options.map((option) => (
        <article key={option.optionCode} style={{ ...panelStyle, marginTop: '0.75rem', marginBottom: 0 }}>
          <h3>{option.titleRu} {option.recommended ? <small>Рекомендуем</small> : null}</h3>
          <p>{option.summaryRu}</p>
          <p>~{option.estimatedMinutesBefore.min}–{option.estimatedMinutesBefore.max} → ~{option.estimatedMinutesAfter.min}–{option.estimatedMinutesAfter.max} мин</p>
          <p>{option.goalImpact.summaryRu}</p>
          <small>{option.goalImpact.disclaimerRu}</small>
          <p><button type="button" className="ui-cta" disabled={props.busy} onClick={() => void props.onApply(option.optionCode)}>Применить</button></p>
        </article>
      ))}
      <p><button type="button" disabled={props.busy} onClick={props.onClose}>Закрыть</button></p>
    </aside>
  );
}

function ReplacementPanel(props: {
  option?: WorkoutReplacementOption;
  count: number;
  busy: boolean;
  t: (key: MessageKey) => string;
  onApply: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const type = props.option?.type as WorkoutReplacementType | undefined;
  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="replacement-title" style={panelStyle} data-testid="workout-replacement-panel">
      <h2 id="replacement-title">{props.t('workout.replacementTitle')}</h2>
      <p>{type ? props.t(`workout.replacement.${type}` as MessageKey) : props.t('workout.replacementEmpty')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="ui-cta" disabled={!type || props.busy} onClick={() => void props.onApply()}>{props.t('workout.apply')}</button>
        <button type="button" disabled={props.count < 2 || props.busy} onClick={props.onNext}>{props.t('workout.otherOption')}</button>
        <button type="button" onClick={props.onClose}>{props.t('workout.close')}</button>
      </div>
    </aside>
  );
}

function ExercisePanel(props: {
  exercise?: WorkoutExerciseDetail;
  loading: boolean;
  locale: string;
  t: (key: MessageKey) => string;
  tc: (namespace: 'workout', key: string) => string;
  onClose: () => void;
}) {
  const ex = props.exercise;
  const localized = (ru?: string | null, en?: string | null) => props.locale === 'en' ? en : ru;
  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="exercise-title" style={panelStyle} data-testid="workout-exercise-panel">
      <h2 id="exercise-title">{ex ? localized(ex.displayNameRu, ex.displayNameEn) || props.tc('workout', ex.key) : props.t('workout.exerciseLoading')}</h2>
      {props.loading ? <p>{props.t('workout.exerciseLoading')}</p> : ex ? (
        <>
          <div style={{ padding: '1rem', background: 'var(--ui-surface-muted, #f3f3f3)', textAlign: 'center' }}>{props.t('workout.imageFallback')}</div>
          {ex.estimatedMinutes != null ? <p>~{ex.estimatedMinutes} {props.t('workout.minutesShort')}</p> : null}
          <p><strong>{props.t('workout.technique')}:</strong> {localized(ex.techniqueSummaryRu, ex.techniqueSummaryEn) || props.t('workout.noTechnique')}</p>
          <p><strong>{props.t('workout.commonMistake')}:</strong> {localized(ex.commonMistakeRu, ex.commonMistakeEn) || props.t('workout.noTechnique')}</p>
          {ex.easierVariantKey ? <p><strong>{props.t('workout.easierVariant')}:</strong> {props.tc('workout', ex.easierVariantKey)}</p> : null}
        </>
      ) : null}
      <button type="button" onClick={props.onClose}>{props.t('workout.close')}</button>
    </aside>
  );
}
