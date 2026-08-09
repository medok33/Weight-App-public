import { describe, expect, it } from 'vitest';
import { deriveActiveSecondsFromTargets } from '../workout-energy-active-seconds';

describe('WORKOUT-ENERGY-01B active seconds derivation', () => {
  it('sums duration targets and excludes rest', () => {
    expect(
      deriveActiveSecondsFromTargets({
        prescriptionMode: 'DURATION',
        setTargets: [
          { targetReps: null, targetDurationSeconds: 45 },
          { targetReps: null, targetDurationSeconds: 45 },
          { targetReps: null, targetDurationSeconds: 30 },
        ],
      }),
    ).toEqual({ status: 'AVAILABLE', activeSeconds: 120 });
  });

  it('derives reps duration only with reviewed seconds-per-rep', () => {
    expect(
      deriveActiveSecondsFromTargets({
        prescriptionMode: 'REPS',
        setTargets: [
          { targetReps: 11, targetDurationSeconds: null },
          { targetReps: 12, targetDurationSeconds: null },
        ],
        secondsPerRep: 2.5,
      }),
    ).toEqual({ status: 'AVAILABLE', activeSeconds: 57.5 });

    expect(
      deriveActiveSecondsFromTargets({
        prescriptionMode: 'REPS',
        setTargets: [{ targetReps: 12, targetDurationSeconds: null }],
      }),
    ).toEqual({
      status: 'UNAVAILABLE_MISSING_ACTIVE_DURATION',
      activeSeconds: null,
    });
  });

  it('rejects unsupported and mixed prescriptions', () => {
    expect(
      deriveActiveSecondsFromTargets({
        prescriptionMode: null,
        setTargets: [{ targetReps: 12, targetDurationSeconds: null }],
      }).status,
    ).toBe('INVALID_PLAN_PRESCRIPTION');
    expect(
      deriveActiveSecondsFromTargets({
        prescriptionMode: 'DURATION',
        setTargets: [{ targetReps: 12, targetDurationSeconds: 30 }],
      }).status,
    ).toBe('INVALID_PLAN_PRESCRIPTION');
    expect(
      deriveActiveSecondsFromTargets({
        prescriptionMode: 'REPS',
        setTargets: [{ targetReps: 12, targetDurationSeconds: 30 }],
        secondsPerRep: 2.5,
      }).status,
    ).toBe('INVALID_PLAN_PRESCRIPTION');
  });

  it('enforces seconds-per-rep bounds', () => {
    for (const secondsPerRep of [0, 60.0001, Number.NaN]) {
      expect(
        deriveActiveSecondsFromTargets({
          prescriptionMode: 'REPS',
          setTargets: [{ targetReps: 10, targetDurationSeconds: null }],
          secondsPerRep,
        }).status,
      ).toBe('INVALID_PLAN_PRESCRIPTION');
    }
  });
});
