'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-fetch';
import { useI18n } from '../../../i18n/locale-provider';
import type { MessageKey } from '../../../i18n/types';
import {
  abandonWorkoutSession,
  completeWorkoutSession,
  getWorkoutSession,
  skipWorkoutSessionExercise,
  unskipWorkoutSessionExercise,
  updateWorkoutSessionSet,
  WorkoutSessionIncompleteError,
} from '../api/workout-engine.client';
import type { WorkoutSession, WorkoutSessionExercise } from '../model/workout-engine.types';

const panelStyle = {
  border: '1px solid var(--ui-border, #d7d7d7)',
  borderRadius: '0.75rem',
  padding: '1rem',
  marginTop: '1rem',
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
} as const;

function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function displayName(exercise: WorkoutSessionExercise, locale: string): string {
  return locale === 'en' ? exercise.displayNameEn : exercise.displayNameRu;
}

function technique(exercise: WorkoutSessionExercise, locale: string): string | null {
  return locale === 'en' ? exercise.techniqueSummaryEn : exercise.techniqueSummaryRu;
}

function mistake(exercise: WorkoutSessionExercise, locale: string): string | null {
  return locale === 'en' ? exercise.commonMistakeEn : exercise.commonMistakeRu;
}

function easier(exercise: WorkoutSessionExercise, locale: string): string | null {
  return locale === 'en' ? exercise.easierVariantEn : exercise.easierVariantRu;
}

function targetLabel(exercise: WorkoutSessionExercise, t: (key: MessageKey) => string): string {
  if (exercise.targetDurationSeconds != null) {
    return `${exercise.targetSets} × ${exercise.targetDurationSeconds}${t('workout.session.secondsShort')}`;
  }
  // Exact planned reps = max ?? min (same as WorkoutSessionSet.targetReps).
  const exact = exercise.targetRepsMax ?? exercise.targetRepsMin;
  if (exact != null) {
    return `${exercise.targetSets} × ${exact}`;
  }
  return `${exercise.targetSets} ${t('workout.session.sets')}`;
}

export function WorkoutSessionScreen() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params.sessionId ?? '');
  const router = useRouter();
  const { t, locale } = useI18n();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [setLive, setSetLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [restLeft, setRestLeft] = useState<number | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  async function load() {
    try {
      const next = await getWorkoutSession(sessionId);
      setSession(next);
      setStatus('ready');
      setMessage(null);
      const firstOpen = next.exercises.findIndex(
        (item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS',
      );
      setExerciseIndex(firstOpen >= 0 ? firstOpen : 0);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        router.replace(`/login?next=${encodeURIComponent(`/workout-engine/session/${sessionId}`)}`);
        return;
      }
      if (error instanceof ApiError && error.code === 'FORBIDDEN') {
        setStatus('forbidden');
        return;
      }
      setStatus('error');
      setMessage(t('workout.session.loadError'));
    }
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') {
      setElapsed(session?.durationSeconds ?? 0);
      return;
    }
    const tick = () => {
      const started = new Date(session.startedAt).getTime();
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (restLeft == null) return;
    if (restLeft <= 0) {
      setRestLeft(null);
      return;
    }
    const id = window.setTimeout(() => setRestLeft((value) => (value == null ? null : value - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [restLeft]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [exerciseIndex, session?.id]);

  const exercise = useMemo(
    () => session?.exercises[exerciseIndex] ?? null,
    [session, exerciseIndex],
  );

  async function mutate(action: () => Promise<WorkoutSession>, opts?: { startRest?: number | null }) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      setSession(next);
      if (opts?.startRest != null && opts.startRest > 0) setRestLeft(opts.startRest);
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        router.replace(`/login?next=${encodeURIComponent(`/workout-engine/session/${sessionId}`)}`);
        return null;
      }
      setMessage(t('workout.session.actionError'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggleSet(setIndex: number, completed: boolean) {
    if (!session || !exercise) return;
    const set = exercise.sets.find((item) => item.setIndex === setIndex);
    const next = await mutate(
      () =>
        updateWorkoutSessionSet(session.id, exercise.id, setIndex, {
          completed,
          actualReps: completed
            ? (set?.actualReps ?? set?.targetReps ?? null)
            : set?.actualReps ?? null,
          actualDurationSeconds: completed
            ? (set?.actualDurationSeconds ?? set?.targetDurationSeconds ?? null)
            : set?.actualDurationSeconds ?? null,
        }),
      { startRest: completed ? exercise.restSeconds ?? null : null },
    );
    if (next) {
      setSetLive(
        completed
          ? t('workout.session.setMarked', { n: setIndex })
          : t('workout.session.setUnmarked', { n: setIndex }),
      );
      setConfirmComplete(false);
      setConfirmAbandon(false);
    }
  }

  async function onComplete() {
    if (!session) return;
    try {
      setBusy(true);
      setMessage(null);
      const next = await completeWorkoutSession(session.id, {
        confirmIncomplete: confirmComplete,
      });
      setSession(next);
      setConfirmComplete(false);
      setConfirmAbandon(false);
    } catch (error) {
      if (error instanceof WorkoutSessionIncompleteError) {
        setConfirmComplete(true);
        setConfirmAbandon(false);
        setMessage(
          t('workout.session.completeConfirm', { n: error.incompleteExercises }),
        );
        return;
      }
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        router.replace(`/login?next=${encodeURIComponent(`/workout-engine/session/${sessionId}`)}`);
        return;
      }
      setMessage(t('workout.session.actionError'));
    } finally {
      setBusy(false);
    }
  }

  async function onAbandon() {
    if (!session) return;
    if (!confirmAbandon) {
      setConfirmAbandon(true);
      setConfirmComplete(false);
      setMessage(t('workout.session.abandonConfirm'));
      return;
    }
    await mutate(() => abandonWorkoutSession(session.id));
    setConfirmAbandon(false);
  }

  if (status === 'loading') {
    return <p data-testid="workout-session-loading">{t('workout.loading')}</p>;
  }
  if (status === 'forbidden') {
    return <p data-testid="workout-session-forbidden">{t('workout.forbidden')}</p>;
  }
  if (status === 'error' || !session || !exercise) {
    return (
      <section data-testid="workout-session-error">
        <p>{message ?? t('workout.session.loadError')}</p>
        <button type="button" className="ui-cta" onClick={() => void load()}>
          {t('workout.retry')}
        </button>
      </section>
    );
  }

  const progress = `${session.completedExercises}/${session.totalExercises}`;
  const terminal = session.status !== 'ACTIVE';

  return (
    <section
      data-testid="workout-session"
      style={{
        maxWidth: '42rem',
        width: '100%',
        margin: '0 auto',
        padding: '1rem',
        boxSizing: 'border-box',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}
    >
      <p>
        <Link href="/workout-engine?tab=today">{t('workout.session.back')}</Link>
      </p>
      <h1 tabIndex={-1} ref={headingRef} data-testid="workout-session-title">
        {session.dayTitle || t('workout.session.title')}
      </h1>
      <p data-testid="workout-session-meta">
        {t(`workout.weekday.${session.effectiveDayIndex}` as MessageKey)} · {session.effectiveDate}
        {session.estimatedMinutes != null
          ? ` · ~${session.estimatedMinutes} ${t('workout.minutesShort')}`
          : null}
      </p>
      <p aria-live="polite" data-testid="workout-session-timer">
        {t('workout.session.elapsed')}: {formatElapsed(terminal ? (session.durationSeconds ?? elapsed) : elapsed)}
      </p>
      <p data-testid="workout-session-progress" aria-label={t('workout.session.progressLabel')}>
        {t('workout.session.progress')}: {progress}
      </p>
      <div aria-live="polite" data-testid="workout-session-set-live">
        {setLive}
      </div>
      <div aria-live="polite" data-testid="workout-session-live">
        {message ? <p role="status">{message}</p> : null}
        {restLeft != null ? (
          <p role="status">
            {t('workout.session.rest')}: {restLeft}
            <button type="button" style={{ marginLeft: '0.5rem' }} onClick={() => setRestLeft(null)}>
              {t('workout.session.skipRest')}
            </button>
          </p>
        ) : null}
      </div>

      {terminal ? (
        <div data-testid="workout-session-result" style={{ marginTop: '1rem' }}>
          <p>
            {session.status === 'COMPLETED'
              ? t('workout.session.completed')
              : t('workout.session.abandoned')}
          </p>
          <p>
            {t('workout.session.finalDuration')}: {formatElapsed(session.durationSeconds ?? elapsed)}
          </p>
          <Link className="ui-cta" href="/workout-engine?tab=today">
            {t('workout.session.back')}
          </Link>
        </div>
      ) : (
        <>
          <article
            data-testid={`workout-session-exercise-${exercise.orderIndex}`}
            style={panelStyle}
          >
            <p>
              {t('workout.session.exerciseOf', {
                current: exerciseIndex + 1,
                total: session.exercises.length,
              })}
            </p>
            <h2>{displayName(exercise, locale)}</h2>
            <p>{targetLabel(exercise, t)}</p>
            <p data-testid="workout-session-exercise-status">
              {t(`workout.session.exerciseStatus.${exercise.status}` as MessageKey)}
            </p>
            {technique(exercise, locale) ? (
              <p data-testid="workout-session-technique">
                <strong>{t('workout.session.technique')}: </strong>
                {technique(exercise, locale)}
              </p>
            ) : null}
            {mistake(exercise, locale) ? (
              <p data-testid="workout-session-mistake">
                <strong>{t('workout.session.mistake')}: </strong>
                {mistake(exercise, locale)}
              </p>
            ) : null}
            {easier(exercise, locale) ? (
              <p data-testid="workout-session-easier">
                <strong>{t('workout.session.easier')}: </strong>
                {easier(exercise, locale)}
              </p>
            ) : null}
            <div
              style={{
                padding: '1rem',
                background: 'var(--ui-surface-muted, #f3f3f3)',
                textAlign: 'center',
                marginBottom: '0.75rem',
              }}
              data-testid={exercise.media[0] ? 'workout-session-media' : 'workout-session-media-fallback'}
            >
              {exercise.media[0]?.altText || t('workout.session.mediaFallback')}
            </div>

            <ul style={{ listStyle: 'none', padding: 0 }}>
              {exercise.sets.map((set) => {
                const done = set.completedAt != null;
                return (
                  <li key={set.id} style={{ marginBottom: '0.5rem' }}>
                    <button
                      type="button"
                      className={done ? 'ui-cta' : undefined}
                      disabled={busy || exercise.status === 'SKIPPED'}
                      data-testid={`workout-session-set-${set.setIndex}`}
                      aria-pressed={done}
                      onClick={() => void toggleSet(set.setIndex, !done)}
                    >
                      {t('workout.session.set')} {set.setIndex}
                      {set.targetReps != null ? ` · ${set.targetReps}` : ''}
                      {set.targetDurationSeconds != null
                        ? ` · ${set.targetDurationSeconds}${t('workout.session.secondsShort')}`
                        : ''}
                      {done ? ` · ${t('workout.session.setDone')}` : ''}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                disabled={busy || exerciseIndex <= 0}
                data-testid="workout-session-prev"
                onClick={() => setExerciseIndex((value) => Math.max(0, value - 1))}
              >
                {t('workout.session.prev')}
              </button>
              <button
                type="button"
                disabled={busy || exerciseIndex >= session.exercises.length - 1}
                data-testid="workout-session-next"
                onClick={() =>
                  setExerciseIndex((value) => Math.min(session.exercises.length - 1, value + 1))
                }
              >
                {t('workout.session.next')}
              </button>
              {exercise.status === 'SKIPPED' ? (
                <button
                  type="button"
                  disabled={busy}
                  data-testid="workout-session-unskip"
                  onClick={() => void mutate(() => unskipWorkoutSessionExercise(session.id, exercise.id))}
                >
                  {t('workout.session.unskip')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  data-testid="workout-session-skip"
                  onClick={() => void mutate(() => skipWorkoutSessionExercise(session.id, exercise.id))}
                >
                  {t('workout.session.skip')}
                </button>
              )}
            </div>
          </article>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="ui-cta"
              disabled={busy}
              data-testid="workout-session-complete"
              onClick={() => void onComplete()}
            >
              {confirmComplete ? t('workout.session.completeConfirmCta') : t('workout.session.complete')}
            </button>
            <button
              type="button"
              disabled={busy}
              data-testid="workout-session-abandon"
              onClick={() => void onAbandon()}
            >
              {confirmAbandon ? t('workout.session.abandonConfirmCta') : t('workout.session.abandon')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
