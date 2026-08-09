import { describe, expect, it } from 'vitest';
import { resolveWorkoutEnergyWeight } from '../workout-energy-weight.resolver';

describe('WORKOUT-ENERGY-01A weight resolver', () => {
  const asOf = '2026-08-05T12:00:00.000Z';

  it('prefers latest measured ProgressEntry at or before asOf', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [
        { id: 'a', userId: 'u1', weightKg: 70, measuredAt: '2026-08-01T10:00:00.000Z' },
        { id: 'b', userId: 'u1', weightKg: 72, measuredAt: '2026-08-04T10:00:00.000Z' },
      ],
      profile: { userId: 'u1', weightKg: 80 },
    });
    expect(result).toMatchObject({
      status: 'AVAILABLE',
      weightKg: 72,
      source: 'PROGRESS_MEASUREMENT',
    });
  });

  it('ignores future measurements', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [
        { id: 'future', userId: 'u1', weightKg: 99, measuredAt: '2026-08-06T10:00:00.000Z' },
        { id: 'past', userId: 'u1', weightKg: 71, measuredAt: '2026-08-03T10:00:00.000Z' },
      ],
      profile: null,
    });
    expect(result.weightKg).toBe(71);
  });

  it('uses deterministic tie-break on equal measuredAt', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          userId: 'u1',
          weightKg: 70,
          measuredAt: '2026-08-04T10:00:00.000Z',
          createdAt: '2026-08-04T10:00:01.000Z',
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'u1',
          weightKg: 73,
          measuredAt: '2026-08-04T10:00:00.000Z',
          createdAt: '2026-08-04T10:00:02.000Z',
        },
      ],
      profile: null,
    });
    expect(result.weightKg).toBe(73);
  });

  it('falls back to profile weight when no measurements', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [],
      profile: { userId: 'u1', weightKg: 81 },
    });
    expect(result).toMatchObject({
      status: 'AVAILABLE',
      weightKg: 81,
      source: 'PROFILE_FALLBACK',
    });
  });

  it('skips invalid latest measurement and uses earlier valid measurement before profile', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [
        { id: 'old', userId: 'u1', weightKg: 74, measuredAt: '2026-07-01T10:00:00.000Z' },
        { id: 'bad', userId: 'u1', weightKg: 10, measuredAt: '2026-08-04T10:00:00.000Z' },
      ],
      profile: { userId: 'u1', weightKg: 90 },
    });
    expect(result.weightKg).toBe(74);
    expect(result.source).toBe('PROGRESS_MEASUREMENT');
  });

  it('ignores other USER measurements and returns unavailable without own sources', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [
        { id: 'x', userId: 'u2', weightKg: 88, measuredAt: '2026-08-04T10:00:00.000Z' },
      ],
      profile: { userId: 'u2', weightKg: 88 },
    });
    expect(result.status).toBe('UNAVAILABLE_MISSING_WEIGHT');
    expect(result.weightKg).toBeNull();
  });

  it('never invents a default weight', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'u1',
      asOf,
      progressEntries: [],
      profile: null,
    });
    expect(result.status).toBe('UNAVAILABLE_MISSING_WEIGHT');
    expect(result.weightKg).toBeNull();
  });
});
