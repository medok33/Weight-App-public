import { describe, expect, it } from 'vitest';
import { resolveTodayHubState, resolveWeekDayVisualStatus } from '../today-hub-state';
import { buildChangeTodayOptions, CHANGE_TODAY_MAX_VISIBLE } from '../change-today-options';

describe('resolveTodayHubState', () => {
  it('loading: no false Start/Continue', () => {
    const state = resolveTodayHubState({
      loading: true,
      hasPlanDay: true,
      isRestDay: false,
      exerciseCount: 3,
      todaySession: null,
    });
    expect(state.kind).toBe('loading');
    expect(state.primary).toBe('none');
    expect(state.showChangeToday).toBe(false);
  });

  it('error: retry surface only', () => {
    const state = resolveTodayHubState({
      error: true,
      hasPlanDay: true,
      isRestDay: false,
      exerciseCount: 3,
      todaySession: null,
    });
    expect(state.kind).toBe('error');
    expect(state.primary).toBe('none');
  });

  it('active: Continue only; change today is secondary (session-safe)', () => {
    const state = resolveTodayHubState({
      hasPlanDay: true,
      isRestDay: false,
      exerciseCount: 4,
      todaySession: { id: 's1', status: 'ACTIVE' },
    });
    expect(state.kind).toBe('active');
    expect(state.primary).toBe('continue');
    expect(state.showChangeToday).toBe(true);
    expect(state.sessionId).toBe('s1');
  });

  it('scheduled: Start primary + Change today secondary', () => {
    const state = resolveTodayHubState({
      hasPlanDay: true,
      isRestDay: false,
      exerciseCount: 5,
      todaySession: null,
    });
    expect(state.kind).toBe('scheduled');
    expect(state.primary).toBe('start');
    expect(state.showChangeToday).toBe(true);
  });

  it('completed: no Start', () => {
    const state = resolveTodayHubState({
      hasPlanDay: true,
      isRestDay: false,
      exerciseCount: 5,
      todaySession: {
        id: 's2',
        status: 'COMPLETED',
        completedExercises: 5,
        totalExercises: 5,
        durationSeconds: 1200,
      },
    });
    expect(state.kind).toBe('completed');
    expect(state.primary).toBe('none');
    expect(state.showChangeToday).toBe(false);
    expect(state.showWeekLink).toBe(true);
  });

  it('empty / rest', () => {
    expect(
      resolveTodayHubState({
        hasPlanDay: false,
        isRestDay: false,
        exerciseCount: 0,
        todaySession: null,
      }).kind,
    ).toBe('empty');
    const rest = resolveTodayHubState({
      hasPlanDay: true,
      isRestDay: true,
      exerciseCount: 0,
      todaySession: null,
    });
    expect(rest.kind).toBe('rest');
    expect(rest.primary).toBe('none');
    expect(rest.showChangeToday).toBe(false);
    expect(rest.showWeekLink).toBe(true);
  });
});

describe('resolveWeekDayVisualStatus', () => {
  it('marks today / in progress / completed without raw enums', () => {
    expect(
      resolveWeekDayVisualStatus({
        dayIndex: 2,
        todayIndex: 2,
        isRestDay: false,
        todaySessionStatus: 'ACTIVE',
      }),
    ).toBe('in_progress');
    expect(
      resolveWeekDayVisualStatus({
        dayIndex: 2,
        todayIndex: 2,
        isRestDay: false,
        todaySessionStatus: 'COMPLETED',
      }),
    ).toBe('completed');
  });
});

describe('buildChangeTodayOptions', () => {
  it('caps visible options and reserves adaptation when allowed', () => {
    const options = buildChangeTodayOptions({
      replacements: [
        { type: 'WALK' },
        { type: 'RECOVERY' },
        { type: 'LIGHTER' },
        { type: 'HOME_SHORT' },
        { type: 'MOVE_DAY', moveTargetDayIndex: 3 },
      ],
      allowAdaptation: true,
    });
    expect(options.length).toBeLessThanOrEqual(CHANGE_TODAY_MAX_VISIBLE);
    expect(options[0]?.replacementType).toBe('MOVE_DAY');
    expect(options.some((item) => item.kind === 'adaptation')).toBe(true);
    expect(options.map((item) => item.id).join(',')).not.toMatch(/WALK_RECOVERY/);
    expect(options.every((item) => item.titleKey.startsWith('workout.changeToday.'))).toBe(true);
  });
});
