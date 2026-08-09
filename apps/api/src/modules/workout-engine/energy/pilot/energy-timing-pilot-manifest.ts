/**
 * WORKOUT-ENERGY-01B-FIX-01 / CONTENT-01A: production timing *pilots* remain empty.
 * Production REPS timing content lives in TIMING_CONTENT_MAPPINGS (content-loader path).
 * Tests must use explicit TEST_ONLY_SYNTHETIC_TIMING fixtures for the pilot loader.
 */
export type EnergyTimingPilotMapping = {
  exerciseKey: string;
  expectedPublishedRevisionNumber?: number;
  timingMethod: 'SECONDS_PER_REP';
  secondsPerRep: number;
  sourceType: 'INTERNAL_REVIEWED_POLICY';
  sourceReference: string;
  sourceVersion: string;
  reviewedBy: string;
};

/** Legacy pilot surface: intentionally empty. Content batch-02 uses TIMING_CONTENT_MAPPINGS. */
export const ENERGY_TIMING_PILOT_MAPPINGS: readonly EnergyTimingPilotMapping[] = [];

export const ENERGY_TIMING_PILOT_SOURCE_VERSION = 'workout-energy-timing-content-pending' as const;

export const ENERGY_TIMING_PILOT_SOURCE_REFERENCE =
  'No production timing pilots ship via the 01B pilot loader. Use TIMING_CONTENT_MAPPINGS + content-loader for reviewed seconds-per-rep mappings. Not Compendium metadata.' as const;

export function findEnergyTimingPilotMapping(exerciseKey: string): EnergyTimingPilotMapping | null {
  return ENERGY_TIMING_PILOT_MAPPINGS.find((row) => row.exerciseKey === exerciseKey) ?? null;
}
