/**
 * Production canonical timing manifest — CONTENT-01B timing batch-02.
 * All entries: INTERNAL_REVIEWED_TEMPO_POLICY / workout-energy-timing-reviewed-v1.
 * Review-only / blocked candidates remain in timing-review-candidates.ts (non-runtime).
 */
import type { TimingContentEntry } from './content.types';
import { TIMING_CONTENT_BATCH_02_MAPPINGS } from './timing-content-batch-02';
import { WORKOUT_ENERGY_TIMING_SOURCE_VERSION } from './timing-methodology';

export const TIMING_CONTENT_MAPPINGS: readonly TimingContentEntry[] =
  TIMING_CONTENT_BATCH_02_MAPPINGS;

export const TIMING_CONTENT_SOURCE_VERSION = WORKOUT_ENERGY_TIMING_SOURCE_VERSION;

export function findTimingContentMapping(exerciseKey: string): TimingContentEntry | null {
  return TIMING_CONTENT_MAPPINGS.find((row) => row.exerciseKey === exerciseKey) ?? null;
}
