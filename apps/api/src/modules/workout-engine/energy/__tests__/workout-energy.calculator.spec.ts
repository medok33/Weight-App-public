import { describe, expect, it } from 'vitest';
import {
  estimateExerciseEnergy,
  roundEnergyDecimal,
  roundEnergyKcalForUi,
} from '../workout-energy.calculator';
import { WORKOUT_ENERGY_POLICY_VERSION } from '../workout-energy.types';

const base = {
  weightKg: 80,
  activeSeconds: 600,
  metValue: 3.8,
  calculationMethod: 'MET_DURATION' as const,
  populationType: 'ADULT_STANDARD_2024' as const,
  sourceVersion: 'compendium-adult-2024.1',
  policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
};

describe('WORKOUT-ENERGY-01A calculator', () => {
  it('is deterministic for same input', () => {
    const a = estimateExerciseEnergy(base);
    const b = estimateExerciseEnergy({ ...base });
    expect(a).toEqual(b);
  });

  it('computes gross, resting, and incremental for MET > 1', () => {
    const result = estimateExerciseEnergy(base);
    expect(result.status).toBe('AVAILABLE');
    if (result.status !== 'AVAILABLE') return;
    // 3.8 * 80 * (600/3600) = 50.666...
    expect(result.grossEstimatedKcalPrecise).toBe(roundEnergyDecimal(3.8 * 80 * (600 / 3600)));
    expect(result.restingEstimatedKcalPrecise).toBe(roundEnergyDecimal(1 * 80 * (600 / 3600)));
    expect(result.incrementalEstimatedKcalPrecise).toBe(
      roundEnergyDecimal((3.8 - 1) * 80 * (600 / 3600)),
    );
    expect(result.grossEstimatedKcalPrecise).toBeGreaterThan(result.restingEstimatedKcalPrecise);
  });

  it('sets incremental to 0 when MET = 1', () => {
    const result = estimateExerciseEnergy({ ...base, metValue: 1 });
    expect(result.status).toBe('AVAILABLE');
    if (result.status !== 'AVAILABLE') return;
    expect(result.incrementalEstimatedKcalPrecise).toBe(0);
    expect(result.grossEstimatedKcalPrecise).toBe(result.restingEstimatedKcalPrecise);
  });

  it('bounds incremental at 0 when MET < 1 while still computing gross', () => {
    const result = estimateExerciseEnergy({ ...base, metValue: 0.8 });
    expect(result.status).toBe('AVAILABLE');
    if (result.status !== 'AVAILABLE') return;
    expect(result.grossEstimatedKcalPrecise).toBeGreaterThan(0);
    expect(result.incrementalEstimatedKcalPrecise).toBe(0);
  });

  it('scales linearly with weight and duration', () => {
    const a = estimateExerciseEnergy(base);
    const b = estimateExerciseEnergy({ ...base, weightKg: 160 });
    const c = estimateExerciseEnergy({ ...base, activeSeconds: 1200 });
    expect(a.status).toBe('AVAILABLE');
    expect(b.status).toBe('AVAILABLE');
    expect(c.status).toBe('AVAILABLE');
    if (a.status !== 'AVAILABLE' || b.status !== 'AVAILABLE' || c.status !== 'AVAILABLE') return;
    expect(b.grossEstimatedKcalPrecise).toBe(roundEnergyDecimal(3.8 * 160 * (600 / 3600)));
    expect(c.grossEstimatedKcalPrecise).toBe(roundEnergyDecimal(3.8 * 80 * (1200 / 3600)));
    expect(b.incrementalEstimatedKcalPrecise).toBe(
      roundEnergyDecimal((3.8 - 1) * 160 * (600 / 3600)),
    );
    expect(b.grossEstimatedKcalPrecise).toBeGreaterThan(a.grossEstimatedKcalPrecise);
    expect(c.grossEstimatedKcalPrecise).toBeGreaterThan(a.grossEstimatedKcalPrecise);
  });

  it('preserves precise decimals and separates UI rounding', () => {
    const result = estimateExerciseEnergy({
      ...base,
      weightKg: 72.5,
      metValue: 2.8,
      activeSeconds: 90,
    });
    expect(result.status).toBe('AVAILABLE');
    if (result.status !== 'AVAILABLE') return;
    expect(String(result.grossEstimatedKcalPrecise)).toMatch(/^\d+(\.\d{1,4})?$/);
    expect(result.incrementalEstimatedKcalPrecise).not.toBe(
      Math.round(result.incrementalEstimatedKcalPrecise),
    );
    const ui = roundEnergyKcalForUi(result.incrementalEstimatedKcalPrecise);
    expect(Number.isInteger(ui)).toBe(true);
    expect(ui).not.toBe(result.incrementalEstimatedKcalPrecise);
  });

  it('rejects missing/invalid weight without default', () => {
    expect(estimateExerciseEnergy({ ...base, weightKg: Number.NaN }).status).toBe(
      'INVALID_CALCULATION_INPUT',
    );
    expect(estimateExerciseEnergy({ ...base, weightKg: 10 }).status).toBe(
      'INVALID_CALCULATION_INPUT',
    );
  });

  it('rejects zero duration as missing active duration', () => {
    expect(estimateExerciseEnergy({ ...base, activeSeconds: 0 }).status).toBe(
      'UNAVAILABLE_MISSING_ACTIVE_DURATION',
    );
  });

  it('rejects NaN/Infinity and unsupported method/population', () => {
    expect(estimateExerciseEnergy({ ...base, metValue: Number.POSITIVE_INFINITY }).status).toBe(
      'INVALID_ENERGY_PROFILE',
    );
    expect(
      estimateExerciseEnergy({
        ...base,
        calculationMethod: 'UNKNOWN' as never,
      }).status,
    ).toBe('UNSUPPORTED_CALCULATION_METHOD');
    expect(
      estimateExerciseEnergy({
        ...base,
        populationType: 'OLDER_ADULT' as never,
      }).status,
    ).toBe('UNAVAILABLE_UNSUPPORTED_POPULATION');
  });

  it('enforces sanity cap without converting to zero AVAILABLE', () => {
    const result = estimateExerciseEnergy({
      ...base,
      metValue: 20,
      weightKg: 250,
      activeSeconds: 3600,
    });
    // 20*250*1 = 5000 > 500
    expect(result.status).toBe('INVALID_CALCULATION_INPUT');
    expect(result.grossEstimatedKcalPrecise).toBeNull();
  });

  it('does not invent defaults for empty source/policy', () => {
    expect(estimateExerciseEnergy({ ...base, sourceVersion: '' }).status).toBe(
      'INVALID_ENERGY_PROFILE',
    );
    expect(estimateExerciseEnergy({ ...base, policyVersion: '  ' }).status).toBe(
      'INVALID_ENERGY_PROFILE',
    );
  });
});
