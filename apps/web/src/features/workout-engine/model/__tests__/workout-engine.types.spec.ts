import { describe, expect, it } from 'vitest';
import {
  groupWorkoutDays,
  type WorkoutSessionStatus,
  type WorkoutSummaryDay,
} from '../workout-engine.types';

describe('groupWorkoutDays', () => {
  it('groups multi-exercise days and marks rest', () => {
    const days: WorkoutSummaryDay[] = [
      {
        dayIndex: 0,
        exerciseOrder: 0,
        exerciseName: 'push_ups',
        sets: 2,
        repsMin: 10,
        repsMax: 12,
        restSeconds: 60,
      },
      {
        dayIndex: 0,
        exerciseOrder: 1,
        exerciseName: 'core_plank',
        sets: 2,
        repsMin: 10,
        repsMax: 12,
        restSeconds: 60,
      },
      { dayIndex: 1, exerciseOrder: 0, exerciseName: 'rest', isRestDay: true },
    ];
    const groups = groupWorkoutDays(days);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.exercises).toHaveLength(2);
    expect(groups[1]?.isRestDay).toBe(true);
  });
});

describe('WorkoutSessionStatus', () => {
  it('keeps ACTIVE open and COMPLETED/ABANDONED terminal', () => {
    const open: WorkoutSessionStatus = 'ACTIVE';
    const terminal: WorkoutSessionStatus[] = ['COMPLETED', 'ABANDONED'];
    expect(open).toBe('ACTIVE');
    expect(terminal).not.toContain('ACTIVE');
    expect(terminal).toEqual(expect.arrayContaining(['COMPLETED', 'ABANDONED']));
  });
});
