/**
 * WORKOUT-ENERGY-01A pilot adapter — backed by CONTENT-01A canonical energy manifest.
 * Schema migration does NOT load these — tests/loader only.
 */
import {
  ENERGY_CONTENT_01A_MAPPINGS,
  ENERGY_CONTENT_DISPOSITIONS,
} from '../content/energy-content-manifest';

export type EnergyPilotMapping = {
  exerciseKey: string;
  expectedPublishedRevisionNumber: number;
  compendiumEdition: 'ADULT_2024';
  compendiumCode: string;
  metValue: number;
  activityDescriptionEn: string;
  mappingRationale: string;
  limitationNote: string;
  sourceReference: string;
  sourceVersion: string;
  reviewedBy: string;
};

export const ENERGY_PILOT_SOURCE_VERSION = 'compendium-adult-2024.1' as const;

export const ENERGY_PILOT_SOURCE_REFERENCE =
  'Herrmann SD, Willis EA, Ainsworth BE, et al. 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. J Sport Health Sci. 2024;13(1):6-12. https://pacompendium.com/' as const;

/** Intentionally unsupported (no profile created). */
export const ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS = ENERGY_CONTENT_DISPOSITIONS.filter(
  (d) => d.disposition === 'NO_DEFENSIBLE_MAPPING',
).map((d) => d.exerciseKey) as readonly string[];

/**
 * Legacy 01A pilot adapter — only the original 8 pilots.
 * Full CONTENT-01B+ production set is ENERGY_CONTENT_MAPPINGS via content loader.
 */
export const ENERGY_PILOT_MAPPINGS: readonly EnergyPilotMapping[] = ENERGY_CONTENT_01A_MAPPINGS.map(
  (row) => ({
    exerciseKey: row.exerciseKey,
    expectedPublishedRevisionNumber: row.expectedPublishedRevisionNumber,
    compendiumEdition: row.compendiumEdition,
    compendiumCode: row.compendiumCode,
    metValue: row.metValue,
    activityDescriptionEn: row.activityDescriptionEn,
    mappingRationale: row.rationale,
    limitationNote: row.limitations,
    sourceReference: row.sourceReference,
    sourceVersion: row.sourceVersion,
    reviewedBy: row.reviewedBy,
  }),
);

export function findEnergyPilotMapping(exerciseKey: string): EnergyPilotMapping | null {
  const row = ENERGY_CONTENT_01A_MAPPINGS.find((m) => m.exerciseKey === exerciseKey) ?? null;
  if (!row) return null;
  return {
    exerciseKey: row.exerciseKey,
    expectedPublishedRevisionNumber: row.expectedPublishedRevisionNumber,
    compendiumEdition: row.compendiumEdition,
    compendiumCode: row.compendiumCode,
    metValue: row.metValue,
    activityDescriptionEn: row.activityDescriptionEn,
    mappingRationale: row.rationale,
    limitationNote: row.limitations,
    sourceReference: row.sourceReference,
    sourceVersion: row.sourceVersion,
    reviewedBy: row.reviewedBy,
  };
}
