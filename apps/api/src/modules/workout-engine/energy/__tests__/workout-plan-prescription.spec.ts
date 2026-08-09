import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlanExercisePrescription, exactTargetReps } from '../workout-plan-prescription';

const base = {
  sets: 3,
  repsMin: 8,
  repsMax: 12,
  restSeconds: 60,
};

type CanonicalExercise = {
  key: string;
  repetitionMode?: string;
  defaultSets?: number;
  defaultDurationSeconds?: number | null;
  estimatedDurationSeconds?: number | null;
};

function loadCanonicalDurationRows(): Array<{
  key: string;
  defaultSets: number;
  defaultDurationSeconds: number;
  estimatedDurationSeconds: number | null;
}> {
  const raw = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../catalog/canonical-content-01b.json'),
      'utf8',
    ),
  ) as { exercises?: CanonicalExercise[] };
  const rows: Array<{
    key: string;
    defaultSets: number;
    defaultDurationSeconds: number;
    estimatedDurationSeconds: number | null;
  }> = [];
  for (const exercise of raw.exercises ?? []) {
    if (exercise.repetitionMode !== 'DURATION') continue;
    if (exercise.defaultDurationSeconds == null) continue;
    rows.push({
      key: exercise.key,
      defaultSets: exercise.defaultSets ?? -1,
      defaultDurationSeconds: exercise.defaultDurationSeconds,
      estimatedDurationSeconds: exercise.estimatedDurationSeconds ?? null,
    });
  }
  return rows;
}

describe('WORKOUT-ENERGY-01B plan prescription', () => {
  it('builds a reps-only prescription', () => {
    expect(
      buildPlanExercisePrescription({
        ...base,
        revisionRepetitionMode: 'REPS',
        defaultDurationSeconds: null,
      }),
    ).toEqual({
      kind: 'SUPPORTED',
      prescriptionMode: 'REPS',
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      restSeconds: 60,
      durationSecondsPerSet: null,
    });
  });

  it('forces DURATION sets=1 and ignores generated rx.sets', () => {
    expect(
      buildPlanExercisePrescription({
        ...base,
        sets: 5,
        revisionRepetitionMode: 'DURATION',
        revisionDefaultSets: 1,
        defaultDurationSeconds: 300,
      }),
    ).toEqual({
      kind: 'SUPPORTED',
      prescriptionMode: 'DURATION',
      sets: 1,
      repsMin: null,
      repsMax: null,
      restSeconds: 60,
      durationSecondsPerSet: 300,
    });
  });

  it('fail-closes multi-set DURATION catalog semantics', () => {
    expect(() =>
      buildPlanExercisePrescription({
        ...base,
        revisionRepetitionMode: 'DURATION',
        revisionDefaultSets: 3,
        defaultDurationSeconds: 300,
      }),
    ).toThrow(/UNSUPPORTED_DURATION_SET_SEMANTICS/);
  });

  it('marks REPS_OR_DURATION unsupported for energy while retaining reps', () => {
    expect(
      buildPlanExercisePrescription({
        ...base,
        revisionRepetitionMode: 'REPS_OR_DURATION',
        defaultDurationSeconds: 30,
      }),
    ).toEqual({
      kind: 'UNSUPPORTED',
      prescriptionMode: null,
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      restSeconds: 60,
      durationSecondsPerSet: null,
    });
  });

  it('exactTargetReps uses max then min (pre-existing session seed policy)', () => {
    expect(exactTargetReps(8, 12)).toBe(12);
    expect(exactTargetReps(10, null)).toBe(10);
    expect(exactTargetReps(null, 15)).toBe(15);
    expect(exactTargetReps(null, null)).toBeNull();
  });

  it('covers all 25 canonical DURATION revisions with sets=1 and no rx.sets inflation', () => {
    const durationRows = loadCanonicalDurationRows();
    expect(durationRows).toHaveLength(25);

    for (const row of durationRows) {
      expect(row.defaultSets).toBe(1);
      expect(row.defaultDurationSeconds).toBe(row.estimatedDurationSeconds);

      // Inflated generator rx.sets must never multiply whole-exercise duration.
      const inflatedRxSets = 5;
      const prescription = buildPlanExercisePrescription({
        sets: inflatedRxSets,
        repsMin: 8,
        repsMax: 12,
        restSeconds: 45,
        revisionRepetitionMode: 'DURATION',
        revisionDefaultSets: row.defaultSets,
        defaultDurationSeconds: row.defaultDurationSeconds,
      });

      expect(prescription).toEqual({
        kind: 'SUPPORTED',
        prescriptionMode: 'DURATION',
        sets: 1,
        repsMin: null,
        repsMax: null,
        restSeconds: 45,
        durationSecondsPerSet: row.defaultDurationSeconds,
      });

      const activeSeconds = prescription.sets * (prescription.durationSecondsPerSet ?? 0);
      expect(activeSeconds).toBe(row.defaultDurationSeconds);
      expect(activeSeconds).not.toBe(inflatedRxSets * row.defaultDurationSeconds);
    }
  });
});
