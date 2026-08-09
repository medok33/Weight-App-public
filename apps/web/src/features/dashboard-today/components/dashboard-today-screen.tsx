'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getDashboardToday } from '../api/dashboard-today.client';
import {
  CARD_HREF,
  DASHBOARD_QUICK_ACTIONS,
  formatDashboardDate,
  formatGoalSummary,
  formatProgressSummary,
  hasPartialCardErrors,
  isNewUserDashboard,
  selectPrimaryCards,
  type DashboardPayload,
} from '../lib/dashboard-today.logic';
import { getActiveWorkoutSession } from '@/features/workout-engine/api/workout-engine.client';
import { getProgressSummary } from '@/features/progress/api/progress.client';
import { getUserGoal } from '@/features/user-profile/api/user-profile.client';
import {
  getActivityToday,
  type ActivityTodayResponse,
} from '@/features/activity/api/activity.client';
import {
  activitySourceLabelKey,
  formatStepsCount,
  formatSyncedAt,
} from '@/features/activity/lib/activity-today.logic';
import type { ProgressSummary } from '@/features/progress/model/progress.types';
import type { UserGoal } from '@/features/user-profile/model/user-profile.types';
import { useI18n } from '../../../i18n/locale-provider';
import type { MessageKey } from '../../../i18n/types';
import { useAuth } from '@/features/auth/components/auth-provider';
import { handleUnauthorized } from '@/lib/handle-unauthorized';
import { mapUnknownToUiError, type UiApiError } from '@/lib/map-api-error';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  InlineNotice,
  LoadingState,
  RetryAction,
} from '@/components/ui-state';
import './dashboard-today.css';

type ScreenStatus = 'loading' | 'success' | 'empty' | 'partial' | 'error' | 'forbidden';
type BlockStatus = 'loading' | 'ready' | 'empty' | 'error';

const CARD_TITLE_KEYS: Record<string, MessageKey> = {
  'meal-plan': 'card.mealPlan',
  workout: 'card.workout',
  nutrition: 'card.nutrition',
  'budget-today': 'card.budgetToday',
  'budget-week': 'card.budgetWeek',
};

const GOAL_KIND_KEYS: Record<string, MessageKey> = {
  lose_weight: 'profile.goalLose',
  maintain: 'profile.goalMaintain',
  gain_muscle: 'profile.goalGain',
};

const QA_LABEL_KEYS: Record<string, MessageKey> = {
  meal: 'dashboard.qa.meal',
  workout: 'dashboard.qa.workout',
  progress: 'dashboard.qa.progress',
  shopping: 'dashboard.qa.shopping',
  assistant: 'dashboard.qa.assistant',
  settings: 'dashboard.qa.settings',
};

export function DashboardTodayScreen() {
  const { t, tc, locale } = useI18n();
  const { clearSessionLocal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const requestId = useRef(0);
  const goalSeq = useRef(0);
  const progressSeq = useRef(0);
  const activitySeq = useRef(0);

  const [state, setState] = useState<{
    status: ScreenStatus;
    data?: DashboardPayload;
    error?: UiApiError;
  }>({ status: 'loading' });

  const [goalBlock, setGoalBlock] = useState<{
    status: BlockStatus;
    goal?: UserGoal | null;
    error?: UiApiError;
  }>({ status: 'loading' });

  const [progressBlock, setProgressBlock] = useState<{
    status: BlockStatus;
    summary?: ProgressSummary | null;
    error?: UiApiError;
  }>({ status: 'loading' });

  const [activityBlock, setActivityBlock] = useState<{
    status: BlockStatus;
    today?: ActivityTodayResponse | null;
    error?: UiApiError;
  }>({ status: 'loading' });

  const [activeWorkoutSessionId, setActiveWorkoutSessionId] = useState<string | null>(null);

  const handleOptionalAuthError = useCallback(
    async (error: unknown): Promise<boolean> => {
      const mapped = mapUnknownToUiError(error, { locale });
      if (mapped.kind !== 'unauthenticated') return false;
      await handleUnauthorized({
        clearSessionLocal,
        router,
        pathname: pathname || '/dashboard-today',
      });
      return true;
    },
    [clearSessionLocal, locale, pathname, router],
  );

  const loadGoalBlock = useCallback(async () => {
    const seq = ++goalSeq.current;
    setGoalBlock((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const goal = await getUserGoal();
      if (seq !== goalSeq.current) return;
      setGoalBlock({
        status: formatGoalSummary(goal) ? 'ready' : 'empty',
        goal,
      });
    } catch (error: unknown) {
      if (seq !== goalSeq.current) return;
      if (await handleOptionalAuthError(error)) return;
      setGoalBlock({
        status: 'error',
        error: mapUnknownToUiError(error, { locale }),
      });
    }
  }, [handleOptionalAuthError, locale]);

  const loadProgressBlock = useCallback(async () => {
    const seq = ++progressSeq.current;
    setProgressBlock((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const summary = await getProgressSummary();
      if (seq !== progressSeq.current) return;
      setProgressBlock({
        status: summary?.latest ? 'ready' : 'empty',
        summary,
      });
    } catch (error: unknown) {
      if (seq !== progressSeq.current) return;
      if (await handleOptionalAuthError(error)) return;
      setProgressBlock({
        status: 'error',
        error: mapUnknownToUiError(error, { locale }),
      });
    }
  }, [handleOptionalAuthError, locale]);

  const loadActivityBlock = useCallback(async () => {
    const seq = ++activitySeq.current;
    setActivityBlock((current) => ({ ...current, status: 'loading', error: undefined }));
    try {
      const today = await getActivityToday();
      if (seq !== activitySeq.current) return;
      setActivityBlock({
        status: today.dataState === 'SYNCED' ? 'ready' : 'empty',
        today,
      });
    } catch (error: unknown) {
      if (seq !== activitySeq.current) return;
      if (await handleOptionalAuthError(error)) return;
      setActivityBlock({
        status: 'error',
        error: mapUnknownToUiError(error, { locale }),
      });
    }
  }, [handleOptionalAuthError, locale]);

  const loadOptionalBlocks = useCallback(async () => {
    await Promise.all([loadGoalBlock(), loadProgressBlock(), loadActivityBlock()]);
  }, [loadGoalBlock, loadProgressBlock, loadActivityBlock]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    goalSeq.current += 1;
    progressSeq.current += 1;
    activitySeq.current += 1;
    setState({ status: 'loading' });
    setGoalBlock({ status: 'loading' });
    setProgressBlock({ status: 'loading' });
    setActivityBlock({ status: 'loading' });
    try {
      const [data, activeSession] = await Promise.all([
        getDashboardToday() as Promise<DashboardPayload>,
        getActiveWorkoutSession().catch(() => null),
      ]);
      if (id !== requestId.current) return;
      setActiveWorkoutSessionId(activeSession?.id ?? null);
      if (data.cards?.length && hasPartialCardErrors(data)) {
        setState({ status: 'partial', data });
      } else if (!data.cards?.length || isNewUserDashboard(data)) {
        setState({ status: 'empty', data });
      } else {
        setState({ status: 'success', data });
      }
      void loadOptionalBlocks();
    } catch (error: unknown) {
      if (id !== requestId.current) return;
      const mapped = mapUnknownToUiError(error, { locale });
      if (mapped.kind === 'unauthenticated') {
        await handleUnauthorized({
          clearSessionLocal,
          router,
          pathname: pathname || '/dashboard-today',
        });
        return;
      }
      if (mapped.kind === 'forbidden') {
        setState({ status: 'forbidden', error: mapped });
        return;
      }
      setState({ status: 'error', error: mapped });
    }
  }, [clearSessionLocal, loadOptionalBlocks, locale, pathname, router]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
      goalSeq.current += 1;
      progressSeq.current += 1;
      activitySeq.current += 1;
    };
  }, [load]);

  function cardTitle(card: { id: string; title: string }) {
    const key = CARD_TITLE_KEYS[card.id];
    return key ? t(key) : tc('card', card.title.replace(/^card\./, ''));
  }

  function cardValue(card: { id: string; status: string; value?: string }) {
    const raw = card.value ?? '';
    if (card.id === 'workout' && activeWorkoutSessionId) return t('workout.continue');
    if (card.id === 'meal-plan') {
      const [mealKey, done] = raw.split('|');
      const label = tc('meal', mealKey || 'not_planned');
      return done === 'done' ? `${label} ✓` : label;
    }
    if (card.id === 'workout') return tc('workout', raw || 'not_planned');
    return raw || t('common.ready');
  }

  function workoutHref() {
    return activeWorkoutSessionId
      ? `/workout-engine/session/${activeWorkoutSessionId}`
      : '/workout-engine';
  }

  function renderQuickActions(testId = 'dashboard-quick-actions') {
    return (
      <nav aria-label={t('dashboard.qa.label')} data-testid={testId}>
        <ul className="wa-dashboard-actions">
          {DASHBOARD_QUICK_ACTIONS.map((action) => (
            <li key={action.id}>
              <Link
                href={action.id === 'workout' ? workoutHref() : action.href}
                data-testid={action.testId}
              >
                {action.id === 'workout' && activeWorkoutSessionId
                  ? t('workout.continue')
                  : t(QA_LABEL_KEYS[action.id]!)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  function renderGoalBlock() {
    if (goalBlock.status === 'loading') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-goal-block">
          <h2>{t('dashboard.goalTitle')}</h2>
          <LoadingState message={t('common.loading')} testId="dashboard-goal-loading" />
        </section>
      );
    }
    if (goalBlock.status === 'error') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-goal-block">
          <h2>{t('dashboard.goalTitle')}</h2>
          <ErrorState
            title={goalBlock.error?.title ?? t('dashboard.goalError')}
            message={goalBlock.error?.explanation ?? t('dashboard.goalError')}
            testId="dashboard-goal-error"
            action={
              <RetryAction
                label={t('common.retry')}
                onRetry={() => void loadGoalBlock()}
                testId="dashboard-goal-retry"
              />
            }
          />
        </section>
      );
    }
    if (goalBlock.status === 'empty') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-goal-block">
          <h2>{t('dashboard.goalTitle')}</h2>
          <EmptyState
            title={t('dashboard.goalEmptyTitle')}
            message={t('dashboard.goalEmptyBody')}
            testId="dashboard-goal-empty"
            action={
              <Link className="ui-cta" href="/settings" data-testid="dashboard-goal-cta">
                {t('dashboard.goalEmptyCta')}
              </Link>
            }
          />
        </section>
      );
    }
    const kindKey = goalBlock.goal?.kind ? GOAL_KIND_KEYS[goalBlock.goal.kind] : undefined;
    const text = formatGoalSummary(goalBlock.goal, kindKey ? t(kindKey) : undefined);
    return (
      <section className="wa-dashboard-section" data-testid="dashboard-goal-block">
        <h2>{t('dashboard.goalTitle')}</h2>
        <p data-testid="dashboard-goal-value">{text}</p>
        <Link href="/settings" data-testid="dashboard-goal-link">
          {t('dashboard.goalEdit')}
        </Link>
      </section>
    );
  }

  function renderProgressBlock() {
    if (progressBlock.status === 'loading') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-progress-block">
          <h2>{t('dashboard.progressTitle')}</h2>
          <LoadingState message={t('common.loading')} testId="dashboard-progress-loading" />
        </section>
      );
    }
    if (progressBlock.status === 'error') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-progress-block">
          <h2>{t('dashboard.progressTitle')}</h2>
          <ErrorState
            title={progressBlock.error?.title ?? t('dashboard.progressError')}
            message={progressBlock.error?.explanation ?? t('dashboard.progressError')}
            testId="dashboard-progress-error"
            action={
              <RetryAction
                label={t('common.retry')}
                onRetry={() => void loadProgressBlock()}
                testId="dashboard-progress-retry"
              />
            }
          />
        </section>
      );
    }
    if (progressBlock.status === 'empty') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-progress-block">
          <h2>{t('dashboard.progressTitle')}</h2>
          <EmptyState
            title={t('dashboard.progressEmptyTitle')}
            message={t('dashboard.progressEmptyBody')}
            testId="dashboard-progress-empty"
            action={
              <Link className="ui-cta" href="/progress" data-testid="dashboard-progress-cta">
                {t('dashboard.progressEmptyCta')}
              </Link>
            }
          />
        </section>
      );
    }
    const formatted = formatProgressSummary(progressBlock.summary, locale === 'en' ? 'en' : 'ru');
    return (
      <section className="wa-dashboard-section" data-testid="dashboard-progress-block">
        <h2>{t('dashboard.progressTitle')}</h2>
        <p data-testid="dashboard-progress-latest">
          {t('dashboard.progressLatest')}: {formatted.latest}
        </p>
        {formatted.delta ? (
          <p data-testid="dashboard-progress-delta">{formatted.delta}</p>
        ) : null}
        <Link href="/progress" data-testid="dashboard-progress-link">
          {t('dashboard.progressOpen')}
        </Link>
      </section>
    );
  }

  function renderActivityBlock() {
    if (activityBlock.status === 'loading') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-activity-block">
          <h2>{t('activity.title')}</h2>
          <LoadingState message={t('common.loading')} testId="dashboard-activity-loading" />
        </section>
      );
    }
    if (activityBlock.status === 'error') {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-activity-block">
          <h2>{t('activity.title')}</h2>
          <ErrorState
            title={activityBlock.error?.title ?? t('activity.error')}
            message={activityBlock.error?.explanation ?? t('activity.error')}
            testId="dashboard-activity-error"
            action={
              <RetryAction
                label={t('common.retry')}
                onRetry={() => void loadActivityBlock()}
                testId="dashboard-activity-retry"
              />
            }
          />
        </section>
      );
    }

    const today = activityBlock.today;
    if (!today || today.dataState === 'NO_DATA' || today.steps == null) {
      return (
        <section className="wa-dashboard-section" data-testid="dashboard-activity-block">
          <h2>{t('activity.title')}</h2>
          <p data-testid="dashboard-activity-empty">{t('activity.noData')}</p>
        </section>
      );
    }

    const localeTag = locale === 'en' ? 'en' : 'ru';
    const stepsLabel = formatStepsCount(today.steps, localeTag);
    const sourceKey = activitySourceLabelKey(today.source);
    const sourceLabel = sourceKey ? t(sourceKey) : '';
    const hasTarget = today.targetSteps != null && today.remainingSteps != null;

    return (
      <section className="wa-dashboard-section" data-testid="dashboard-activity-block">
        <h2>{t('activity.title')}</h2>
        <p data-testid="dashboard-activity-steps">
          {hasTarget
            ? t('activity.stepsWithTarget', {
                steps: stepsLabel,
                target: formatStepsCount(today.targetSteps!, localeTag),
              })
            : t('activity.stepsOnly', { steps: stepsLabel })}
        </p>
        {hasTarget ? (
          <p data-testid="dashboard-activity-remaining">
            {t('activity.remaining', {
              remaining: formatStepsCount(today.remainingSteps!, localeTag),
            })}
          </p>
        ) : null}
        {sourceLabel ? (
          <p data-testid="dashboard-activity-source">
            {t('activity.syncedWith', { source: sourceLabel })}
          </p>
        ) : null}
        {today.lastSyncedAt ? (
          <p data-testid="dashboard-activity-updated">
            {t('activity.updatedAt', { time: formatSyncedAt(today.lastSyncedAt, localeTag) })}
          </p>
        ) : null}
      </section>
    );
  }

  if (state.status === 'loading') {
    return (
      <main className="wa-dashboard">
        <h1>{t('dashboard.title')}</h1>
        <LoadingState message={t('dashboard.loading')} testId="dashboard-loading" />
      </main>
    );
  }

  if (state.status === 'forbidden') {
    return (
      <main className="wa-dashboard">
        <h1>{t('dashboard.title')}</h1>
        <ForbiddenState
          title={state.error?.title ?? t('ui.forbiddenTitle')}
          message={state.error?.explanation ?? t('ui.forbiddenBody')}
          testId="dashboard-forbidden"
        />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="wa-dashboard">
        <h1>{t('dashboard.title')}</h1>
        <ErrorState
          title={state.error?.title ?? t('dashboard.error')}
          message={state.error?.explanation ?? t('dashboard.error')}
          testId="dashboard-error"
          action={
            <RetryAction
              label={state.error?.recovery ?? t('common.retry')}
              onRetry={() => void load()}
              testId="dashboard-retry"
            />
          }
        />
      </main>
    );
  }

  if (state.status === 'empty') {
    return (
      <main className="wa-dashboard">
        <h1 data-testid="dashboard-heading">{t('dashboard.title')}</h1>
        <p className="wa-dashboard-context">{t('dashboard.subtitle')}</p>
        <EmptyState
          title={t('dashboard.newUserTitle')}
          message={t('dashboard.newUserBody')}
          testId="dashboard-empty"
          action={
            <div className="wa-dashboard-empty-actions">
              <Link className="ui-cta" href="/meal-plan" data-testid="dashboard-empty-cta-meal">
                {t('dashboard.qa.meal')}
              </Link>
              <Link
                className="ui-cta"
                href={workoutHref()}
                data-testid={
                  activeWorkoutSessionId ? 'dashboard-empty-cta-workout-continue' : 'dashboard-empty-cta-workout'
                }
              >
                {activeWorkoutSessionId ? t('workout.continue') : t('dashboard.qa.workout')}
              </Link>
              <Link className="ui-cta" href="/settings" data-testid="dashboard-empty-cta">
                {t('dashboard.newUserCta')}
              </Link>
            </div>
          }
        />
        {renderQuickActions('dashboard-quick-actions-empty')}
        {renderActivityBlock()}
      </main>
    );
  }

  const nutrition = state.data?.nutrition;
  const budget = state.data?.budget;
  const primaryCards = selectPrimaryCards(state.data?.cards);
  const dateLabel = state.data?.date
    ? formatDashboardDate(state.data.date, locale === 'en' ? 'en' : 'ru')
    : '';

  return (
    <main className="wa-dashboard">
      <h1 data-testid="dashboard-heading">{t('dashboard.title')}</h1>
      <p className="wa-dashboard-context" data-testid="dashboard-date">
        {dateLabel || state.data?.date}
      </p>
      <p className="wa-dashboard-context">{t('dashboard.subtitle')}</p>

      {renderQuickActions()}

      {state.status === 'partial' ? (
        <InlineNotice
          tone="warning"
          message={t('dashboard.partial')}
          testId="dashboard-partial-notice"
        >
          <RetryAction
            label={t('common.retry')}
            onRetry={() => void load()}
            testId="dashboard-partial-retry"
          />
        </InlineNotice>
      ) : null}

      {renderGoalBlock()}
      {renderProgressBlock()}
      {renderActivityBlock()}

      {nutrition ? (
        <section className="wa-dashboard-section" data-testid="dashboard-nutrition-metrics">
          <h2>{t('card.nutrition')}</h2>
          <div className="wa-dashboard-metrics">
            <p data-testid="nutrition-planned">
              {t('dashboard.planned')}: {nutrition.plannedKcal} {t('unit.kcal')}
            </p>
            <p data-testid="nutrition-consumed">
              {t('dashboard.consumed')}: {nutrition.consumedKcal} {t('unit.kcal')}
            </p>
            <p data-testid="nutrition-remaining">
              {t('dashboard.remaining')}: {nutrition.remainingKcal} {t('unit.kcal')}
            </p>
            <p data-testid="nutrition-protein">
              {t('dashboard.protein')}: {nutrition.proteinConsumed}/{nutrition.proteinTarget}{' '}
              {tc('unit', 'g')}
            </p>
          </div>
          <Link href="/meal-plan" data-testid="dashboard-nutrition-link">
            {t('dashboard.openMealPlan')}
          </Link>
        </section>
      ) : null}

      <section className="wa-dashboard-section" aria-label={t('dashboard.todayBlocks')}>
        <div className="wa-dashboard-cards">
          {primaryCards.map((card) => {
            const href =
              card.id === 'workout' ? workoutHref() : CARD_HREF[card.id];
            const content = (
              <>
                <h2>{cardTitle(card)}</h2>
                <p>{card.status === 'error' ? t('dashboard.cardError') : cardValue(card)}</p>
              </>
            );
            if (!href || card.status === 'error') {
              return (
                <article
                  key={card.id}
                  className="wa-dashboard-card"
                  data-testid={`dashboard-card-${card.id}`}
                  aria-disabled={card.status === 'error' ? 'true' : undefined}
                >
                  {content}
                </article>
              );
            }
            return (
              <Link
                key={card.id}
                href={href}
                className="wa-dashboard-card"
                data-testid={`dashboard-card-${card.id}`}
              >
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      {budget ? (
        <section className="wa-dashboard-section" data-testid="dashboard-budget-metrics">
          <h2>{t('dashboard.budgetTitle')}</h2>
          <div className="wa-dashboard-metrics">
            <p data-testid="budget-today">
              {t('dashboard.budgetToday')}: {budget.todayCost} {t('unit.currency')}
            </p>
            <p data-testid="budget-week">
              {t('dashboard.budgetWeek')}: {budget.weekCost} {t('unit.currency')}
            </p>
          </div>
          <p className="wa-dashboard-context">{t('dashboard.budgetNote')}</p>
          <Link href="/shopping-list" data-testid="dashboard-budget-link">
            {t('dashboard.openShopping')}
          </Link>
        </section>
      ) : null}
    </main>
  );
}
