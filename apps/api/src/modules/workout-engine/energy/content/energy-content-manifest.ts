/**
 * Canonical energy content manifest (repository SoT).
 * Exact unmodified 2024 Adult Compendium MET values.
 * Schema migration / check command do NOT apply these to shared/staging/production.
 *
 * Citation: Herrmann SD et al. 2024 Adult Compendium.
 * https://pacompendium.com/ — free for commercial use; cite; do not alter METs.
 */
import { WORKOUT_ENERGY_POLICY_VERSION } from '../workout-energy.types';
import { withEnergyChecksum } from './content-checksum';
import {
  ENERGY_CONTENT_BATCH_01B_DISPOSITIONS,
  ENERGY_CONTENT_BATCH_01B_MAPPINGS,
} from './energy-content-batch-01b';
import {
  WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
  type CoverageDispositionEntry,
  type EnergyContentEntry,
} from './content.types';

const SOURCE_REFERENCE =
  'Herrmann SD, Willis EA, Ainsworth BE, et al. 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. J Sport Health Sci. 2024;13(1):6-12. https://pacompendium.com/';
const SOURCE_VERSION = 'compendium-adult-2024.1';
const CONTENT_VERSION = 'workout-energy-content-01a.1';
/** Canonical UTC calendar date (YYYY-MM-DD). Checksums recomputed for CONTENT-01A-FIX-01. */
const REVIEWED_AT = '2026-03-20';
const REVIEWED_BY = 'system:workout-energy-01a-pilot';

type EnergyDraft = Omit<EnergyContentEntry, 'checksum'>;

const ENERGY_DRAFTS: readonly EnergyDraft[] = [
  {
    exerciseKey: 'push_ups',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '02022',
    metValue: 3.8,
    activityDescriptionEn:
      'Calisthenics (e.g., pushups, sit ups, pull-ups, lunges), moderate effort',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Push-ups are explicitly listed under calisthenics moderate effort (02022).',
    limitations:
      'Broad calisthenics category; individual push-up intensity may vary.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'bodyweight_squats',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Bodyweight squat is explicitly covered by body-weight resistance general (02056).',
    limitations: 'General body-weight resistance category; not squat-specific measured MET.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'core_plank',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Plank is explicitly named in calisthenics light effort (02024).',
    limitations: 'Light-effort plank category; longer holds remain approximate.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'morning_walk',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '17170',
    metValue: 3.0,
    activityDescriptionEn: 'Walking, 2.5 mph, firm, level surface',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Morning walk maps to a slow level walk on firm surface (17170) as conservative recovery pace.',
    limitations: 'Assumes ~2.5 mph level surface; terrain/speed not user-captured.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'recovery_walk',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '17160',
    metValue: 3.5,
    activityDescriptionEn: 'Walking for pleasure (Taylor Code 010)',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Recovery walk treated as walking for pleasure (17160).',
    limitations: 'Pleasure-walk MET is coarse for structured recovery walks.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'dumbbell_row',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Dumbbell row is resistance training in typical 8–15 rep ranges (02054).',
    limitations:
      'Broad resistance category; external load and rest density not in Compendium row.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'mobility_flow',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Mobility flow is mild stretching/mobility work (02101).',
    limitations: 'Mild stretching MET; dynamic mobility may be higher.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
  {
    exerciseKey: 'light_jog',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '12020',
    metValue: 7.5,
    activityDescriptionEn: 'Jogging, general, self-selected pace',
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Light jog maps to jogging general self-selected pace (12020).',
    limitations: 'Self-selected jogging MET; “light” label is coarser than pace-specific rows.',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  },
] as const;

/** 01A pilots (unchanged checksums / contentVersion). */
export const ENERGY_CONTENT_01A_MAPPINGS: readonly EnergyContentEntry[] = ENERGY_DRAFTS.map(
  (draft) => withEnergyChecksum(draft),
);

/**
 * Production/canonical energy mappings = 01A pilots + 01B batch-01.
 * Existing 8 pilots keep contentVersion workout-energy-content-01a.1.
 */
export const ENERGY_CONTENT_MAPPINGS: readonly EnergyContentEntry[] = [
  ...ENERGY_CONTENT_01A_MAPPINGS,
  ...ENERGY_CONTENT_BATCH_01B_MAPPINGS,
];

/** Explicit non-mapping dispositions (no fake MET stub). */
export const ENERGY_CONTENT_DISPOSITIONS: readonly CoverageDispositionEntry[] = [
  ...ENERGY_CONTENT_BATCH_01B_DISPOSITIONS,
] as const;

export function findEnergyContentMapping(exerciseKey: string): EnergyContentEntry | null {
  return ENERGY_CONTENT_MAPPINGS.find((row) => row.exerciseKey === exerciseKey) ?? null;
}
