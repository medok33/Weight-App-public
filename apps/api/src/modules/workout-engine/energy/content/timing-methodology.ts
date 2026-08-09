/**
 * WORKOUT-ENERGY timing methodology helpers (EXECUTABLE).
 * Policy identity: workout-energy-timing-reviewed-v1
 * Evidence class: INTERNAL_REVIEWED_TEMPO_POLICY
 *
 * This is an internal product estimation methodology — not laboratory measurement,
 * not Compendium cadence, not ACSM prescription, not medical advice.
 */
import type { TimingMovementPhases } from './content.types';

export const WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION =
  'workout-energy-timing-reviewed-v1' as const;

export const WORKOUT_ENERGY_TIMING_REVIEWED_BY =
  'weight-app-internal-timing-review-v1' as const;

export const WORKOUT_ENERGY_TIMING_REVIEWED_AT = '2026-08-07' as const;

/** Default identity for unchanged FIX-01 APPROVED timing entries. */
export const WORKOUT_ENERGY_TIMING_CONTENT_VERSION =
  'workout-energy-content-01b-timing-batch-02-fix-01' as const;

/** Identity for FIX-02 semantic hedge corrections (per changed entry only). */
export const WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02 =
  'workout-energy-content-01b-timing-batch-02-fix-02' as const;

export const WORKOUT_ENERGY_TIMING_SOURCE_VERSION =
  'workout-energy-timing-reviewed-v1.0' as const;

/**
 * True when text hedges / defers execution-mode or counting identity
 * (typical, as catalogued, depending on…, bilateral-or-unilateral, per catalog, …).
 * Does not decide whether an exercise is bilateral vs unilateral — only rejects uncertainty.
 */
export function hasHedgedTimingSemantics(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;

  if (/\btypically\b/.test(t)) return true;
  if (/\b\(typical\)\b/.test(t) || /\btypical\b/.test(t)) return true;
  if (/\bas catalogued\b/.test(t) || /\bas cataloged\b/.test(t)) return true;
  if (/\bdepending on\b/.test(t)) return true;
  if (/\bwhen applicable\b/.test(t)) return true;
  if (/\bas configured\b/.test(t)) return true;
  if (/\bper catalog\b/.test(t)) return true;
  if (/\baccording to catalog\b/.test(t)) return true;
  if (/\beither\b/.test(t) && (/\bbilateral\b/.test(t) || /\bunilateral\b/.test(t))) {
    return true;
  }
  if (/\bbilateral\b/.test(t) && /\bunilateral\b/.test(t) && /\bor\b/.test(t)) {
    return true;
  }
  // e.g. "bilateral … or as catalogued" without the word unilateral
  if (/\bbilateral\b.{0,48}\bor\b/.test(t) || /\bunilateral\b.{0,48}\bor\b/.test(t)) {
    return true;
  }
  return false;
}

/** Phase keys in deterministic serialization order. */
export const TIMING_PHASE_KEYS = [
  'setupTransitionSeconds',
  'eccentricSeconds',
  'bottomTransitionSeconds',
  'concentricSeconds',
  'topTransitionSeconds',
  'sideTransitionSeconds',
] as const;

export type TimingPhaseKey = (typeof TIMING_PHASE_KEYS)[number];

export function sumTimingPhases(phases: TimingMovementPhases): number {
  let sum = 0;
  for (const key of TIMING_PHASE_KEYS) {
    const v = phases[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`INVALID_TIMING_PHASE:${key}`);
    }
    sum += v;
  }
  return sum;
}

/** Canonical phaseModel string for checksum (fixed 4dp; omit absent phases). */
export function serializeTimingPhaseModel(phases: TimingMovementPhases): string {
  const parts: string[] = [];
  for (const key of TIMING_PHASE_KEYS) {
    const v = phases[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`INVALID_TIMING_PHASE:${key}`);
    }
    parts.push(`${key}=${v.toFixed(4)}`);
  }
  if (parts.length === 0) {
    throw new Error('EMPTY_TIMING_PHASE_MODEL');
  }
  return parts.join(';');
}

export function assertSecondsPerRepMatchesPhases(
  secondsPerRep: number,
  phases: TimingMovementPhases,
  epsilon = 1e-9,
): void {
  const sum = sumTimingPhases(phases);
  if (Math.abs(sum - secondsPerRep) > epsilon) {
    throw new Error(
      `SECONDS_PER_REP_PHASE_MISMATCH:secondsPerRep=${secondsPerRep};phaseSum=${sum}`,
    );
  }
}
