/**
 * WORKOUT-ENERGY-01A pilot loader — schema migration does NOT load content.
 * Disposable DB / dry-run validation only. Never apply to shared/staging/production.
 *
 * CONTENT-01A: resolves exact published release pins (not revisionNumber=1).
 */
import type { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { ExerciseEnergyProfileRepository } from '../exercise-energy-profile.repository';
import { resolvePublishedPinFromDb } from '../content/release-pin-resolver';
import {
  ENERGY_PILOT_MAPPINGS,
  ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS,
  type EnergyPilotMapping,
} from './energy-pilot-manifest';
import { WORKOUT_ENERGY_POLICY_VERSION } from '../workout-energy.types';

export type EnergyPilotLoadMode = 'dry-run' | 'apply';

export type EnergyPilotLoadIssue = {
  level: 'error' | 'warning';
  exerciseKey: string;
  message: string;
};

export type EnergyPilotLoadResult = {
  mode: EnergyPilotLoadMode;
  valid: boolean;
  mappingsReviewed: number;
  unsupportedKeys: readonly string[];
  wouldCreate: number;
  created: number;
  approved: number;
  issues: EnergyPilotLoadIssue[];
  revisionIdsByKey: Record<string, string>;
};

export function validatePilotManifest(mappings: readonly EnergyPilotMapping[]): EnergyPilotLoadIssue[] {
  const issues: EnergyPilotLoadIssue[] = [];
  const seen = new Set<string>();
  if (mappings.length < 6 || mappings.length > 12) {
    issues.push({
      level: 'error',
      exerciseKey: '*',
      message: `Pilot count must be 6–12, got ${mappings.length}`,
    });
  }
  for (const row of mappings) {
    if (seen.has(row.exerciseKey)) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'Duplicate exerciseKey in pilot manifest',
      });
    }
    seen.add(row.exerciseKey);
    if (row.compendiumEdition !== 'ADULT_2024') {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'Primary source must be ADULT_2024',
      });
    }
    if (!/^\d{5}$/.test(row.compendiumCode)) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: `Invalid Compendium code ${row.compendiumCode}`,
      });
    }
    if (!(row.metValue > 0) || row.metValue > 30) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: `Invalid MET ${row.metValue}`,
      });
    }
    if (
      !Number.isInteger(row.expectedPublishedRevisionNumber) ||
      row.expectedPublishedRevisionNumber < 1
    ) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'expectedPublishedRevisionNumber is required',
      });
    }
    if ((ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS as readonly string[]).includes(row.exerciseKey)) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'Unsupported pilot key must not have a mapping',
      });
    }
  }
  return issues;
}

/**
 * Validates reviewed pilot mappings against published release pins.
 * apply=true creates DRAFT then APPROVED profiles on disposable DB only.
 */
export async function loadEnergyPilotProfiles(opts: {
  db: PrismaService;
  mode: EnergyPilotLoadMode;
  reviewedBy?: string;
  mappings?: readonly EnergyPilotMapping[];
}): Promise<EnergyPilotLoadResult> {
  const mappings = opts.mappings ?? ENERGY_PILOT_MAPPINGS;
  const issues = validatePilotManifest(mappings);
  const revisionIdsByKey: Record<string, string> = {};
  let wouldCreate = 0;

  for (const row of mappings) {
    const resolved = await resolvePublishedPinFromDb(
      opts.db,
      row.exerciseKey,
      row.expectedPublishedRevisionNumber,
    );
    if (resolved.status !== 'OK' || !resolved.revisionId) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message:
          resolved.status === 'OK'
            ? 'Published pin missing revisionId'
            : `${resolved.status}: ${resolved.message}`,
      });
      continue;
    }
    revisionIdsByKey[row.exerciseKey] = resolved.revisionId;
    wouldCreate += 1;
  }

  for (const key of ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS) {
    const resolved = await resolvePublishedPinFromDb(opts.db, key);
    if (resolved.status === 'MISSING_REVISION_PIN') {
      issues.push({
        level: 'warning',
        exerciseKey: key,
        message: 'Unsupported pilot key missing from catalog (cannot prove absence)',
      });
    }
  }

  const valid = !issues.some((issue) => issue.level === 'error');
  const result: EnergyPilotLoadResult = {
    mode: opts.mode,
    valid,
    mappingsReviewed: mappings.length,
    unsupportedKeys: ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS,
    wouldCreate,
    created: 0,
    approved: 0,
    issues,
    revisionIdsByKey,
  };

  if (!valid || opts.mode === 'dry-run') {
    return result;
  }

  const repo = new ExerciseEnergyProfileRepository(opts.db);
  const reviewedBy = opts.reviewedBy?.trim() || 'system:workout-energy-01a-pilot';

  for (const row of mappings) {
    const revisionId = revisionIdsByKey[row.exerciseKey];
    if (!revisionId) continue;
    const draft = await repo.createDraft({
      exerciseRevisionId: revisionId,
      calculationMethod: 'MET_DURATION',
      populationType: 'ADULT_STANDARD_2024',
      compendiumEdition: row.compendiumEdition,
      compendiumCode: row.compendiumCode,
      metValue: row.metValue,
      sourceType: 'COMPENDIUM_ADULT_2024',
      sourceReference: row.sourceReference,
      sourceVersion: row.sourceVersion,
      policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    });
    result.created += 1;
    await repo.approve(draft.id, reviewedBy);
    result.approved += 1;
  }

  return result;
}
