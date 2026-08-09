/**
 * WORKOUT-ENERGY-01B timing pilot loader.
 * Disposable DB / dry-run validation only. Never apply to shared/staging/production.
 *
 * CONTENT-01A: resolves exact published release pins (not revisionNumber=1).
 * Production canonical timing list is empty. Tests pass TEST_ONLY_SYNTHETIC_TIMING via opts.mappings.
 */
import type { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { ExerciseEnergyTimingProfileRepository } from '../exercise-energy-timing-profile.repository';
import { resolvePublishedPinFromDb } from '../content/release-pin-resolver';
import { WORKOUT_ENERGY_TIMING_POLICY_VERSION } from '../workout-energy.types';
import {
  ENERGY_TIMING_PILOT_MAPPINGS,
  type EnergyTimingPilotMapping,
} from './energy-timing-pilot-manifest';

export type EnergyTimingPilotLoadMode = 'dry-run' | 'apply';

export type EnergyTimingPilotLoadIssue = {
  level: 'error';
  exerciseKey: string;
  message: string;
};

export type EnergyTimingPilotLoadResult = {
  mode: EnergyTimingPilotLoadMode;
  valid: boolean;
  mappingsReviewed: number;
  wouldCreate: number;
  created: number;
  approved: number;
  issues: EnergyTimingPilotLoadIssue[];
  revisionIdsByKey: Record<string, string>;
};

export function validateEnergyTimingPilotManifest(
  mappings: readonly EnergyTimingPilotMapping[],
): EnergyTimingPilotLoadIssue[] {
  const issues: EnergyTimingPilotLoadIssue[] = [];
  const seen = new Set<string>();
  for (const row of mappings) {
    if (seen.has(row.exerciseKey)) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'Duplicate exerciseKey in timing mappings',
      });
    }
    seen.add(row.exerciseKey);
    if (row.timingMethod !== 'SECONDS_PER_REP') {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'timingMethod must be SECONDS_PER_REP',
      });
    }
    if (!(row.secondsPerRep > 0 && row.secondsPerRep <= 60)) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'secondsPerRep must be in (0, 60]',
      });
    }
    // Numeric 2.5 is allowed when movement-specific; forbid universal/default markers instead.
    if (String(row.sourceReference ?? '').toLowerCase().includes('universal')) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'universal timing markers are forbidden',
      });
    }
    if (!row.sourceType || !row.sourceReference || !row.sourceVersion) {
      issues.push({
        level: 'error',
        exerciseKey: row.exerciseKey,
        message: 'Timing provenance fields are required',
      });
    }
  }
  return issues;
}

export async function loadEnergyTimingPilotProfiles(opts: {
  db: PrismaService;
  mode: EnergyTimingPilotLoadMode;
  reviewedBy?: string;
  mappings?: readonly EnergyTimingPilotMapping[];
}): Promise<EnergyTimingPilotLoadResult> {
  const mappings = opts.mappings ?? ENERGY_TIMING_PILOT_MAPPINGS;
  const issues = validateEnergyTimingPilotManifest(mappings);
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
            : `${resolved.status}: ${'message' in resolved ? resolved.message : 'pin resolve failed'}`,
      });
      continue;
    }
    revisionIdsByKey[row.exerciseKey] = resolved.revisionId;
    wouldCreate += 1;
  }

  const result: EnergyTimingPilotLoadResult = {
    mode: opts.mode,
    valid: issues.length === 0,
    mappingsReviewed: mappings.length,
    wouldCreate,
    created: 0,
    approved: 0,
    issues,
    revisionIdsByKey,
  };
  if (!result.valid || opts.mode === 'dry-run') return result;
  if (mappings.length === 0) return result;

  const repo = new ExerciseEnergyTimingProfileRepository(opts.db);
  const reviewedBy = opts.reviewedBy?.trim() || 'system:test-only-synthetic-timing';
  for (const row of mappings) {
    const revisionId = revisionIdsByKey[row.exerciseKey];
    if (!revisionId) continue;
    const draft = await repo.createDraft({
      exerciseRevisionId: revisionId,
      timingMethod: row.timingMethod,
      secondsPerRep: row.secondsPerRep,
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      sourceVersion: row.sourceVersion,
      policyVersion: WORKOUT_ENERGY_TIMING_POLICY_VERSION,
    });
    result.created += 1;
    await repo.approve(draft.id, reviewedBy);
    result.approved += 1;
  }
  return result;
}
