/**
 * WORKOUT-V2-01E — pure Today hub state resolution (one primary action).
 */

export type TodayHubPrimary =
  | 'continue'
  | 'start'
  | 'none';

export type TodayHubKind =
  | 'loading'
  | 'error'
  | 'active'
  | 'scheduled'
  | 'completed'
  | 'rest'
  | 'empty';

export type TodaySessionSummary = {
  id: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  completedExercises?: number | null;
  totalExercises?: number | null;
  durationSeconds?: number | null;
};

export type TodayHubInput = {
  loading?: boolean;
  error?: boolean;
  hasPlanDay: boolean;
  isRestDay: boolean;
  exerciseCount: number;
  todaySession: TodaySessionSummary | null;
  /** Legacy active session from GET /sessions/active (may duplicate todaySession). */
  activeSessionId?: string | null;
};

export type TodayHubState = {
  kind: TodayHubKind;
  primary: TodayHubPrimary;
  showChangeToday: boolean;
  showWeekLink: boolean;
  sessionId: string | null;
};

export function resolveTodayHubState(input: TodayHubInput): TodayHubState {
  if (input.loading) {
    return {
      kind: 'loading',
      primary: 'none',
      showChangeToday: false,
      showWeekLink: false,
      sessionId: null,
    };
  }
  if (input.error) {
    return {
      kind: 'error',
      primary: 'none',
      showChangeToday: false,
      showWeekLink: false,
      sessionId: null,
    };
  }

  const activeId =
    input.todaySession?.status === 'ACTIVE'
      ? input.todaySession.id
      : input.activeSessionId ?? null;

  if (activeId) {
    return {
      kind: 'active',
      primary: 'continue',
      // Session-safe adjust only (no plan replacements) — never peer to Continue.
      showChangeToday: true,
      showWeekLink: false,
      sessionId: activeId,
    };
  }

  if (input.todaySession?.status === 'COMPLETED') {
    return {
      kind: 'completed',
      primary: 'none',
      showChangeToday: false,
      showWeekLink: true,
      sessionId: input.todaySession.id,
    };
  }

  if (!input.hasPlanDay) {
    return {
      kind: 'empty',
      primary: 'none',
      showChangeToday: false,
      showWeekLink: true,
      sessionId: null,
    };
  }

  if (input.isRestDay || input.exerciseCount === 0) {
    return {
      kind: 'rest',
      primary: 'none',
      // F5: one calm secondary only — View week (not Change today).
      showChangeToday: false,
      showWeekLink: true,
      sessionId: null,
    };
  }

  return {
    kind: 'scheduled',
    primary: 'start',
    showChangeToday: true,
    showWeekLink: false,
    sessionId: null,
  };
}

/** Human-facing day status for Week — never expose raw enums to callers as UI text. */
export type WeekDayVisualStatus =
  | 'today'
  | 'completed'
  | 'in_progress'
  | 'upcoming'
  | 'rest'
  | 'moved'
  | 'scheduled';

export function resolveWeekDayVisualStatus(input: {
  dayIndex: number;
  todayIndex: number;
  isRestDay: boolean;
  isMoved?: boolean;
  todaySessionStatus?: TodaySessionSummary['status'] | null;
}): WeekDayVisualStatus {
  if (input.isMoved) return 'moved';
  if (input.isRestDay) return 'rest';
  if (input.dayIndex === input.todayIndex) {
    if (input.todaySessionStatus === 'ACTIVE') return 'in_progress';
    if (input.todaySessionStatus === 'COMPLETED') return 'completed';
    return 'today';
  }
  if (input.dayIndex < input.todayIndex) return 'scheduled';
  return 'upcoming';
}
