import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import {
  DISPOSABLE_POSTGRES_MARKER,
  WEIGHT_APP_DISPOSABLE_MODE,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
  WEIGHT_APP_RUNTIME_ID,
} from '../../../../../test-support/assert-disposable-database';
import { WORKOUT_ENERGY_POLICY_VERSION } from '../../workout-energy.types';
import { withTimingChecksum } from '../content-checksum';
import {
  CONTENT_LOADER_ADVISORY_LOCK_KEY,
  CONTENT_VERSION_MARKER_PREFIX,
  confirmContentLoaderApplyDatabase,
  extractContentVersionFromSourceReference,
  formatContentLoadReport,
  formatContentVersionMarkerLine,
  normalizeHostname,
  parseContentVersionMarker,
  runWorkoutEnergyContentLoad,
  sourceReferenceForDraft,
  type ContentLoadReport,
} from '../content-loader';
import { ENERGY_CONTENT_MAPPINGS } from '../energy-content-manifest';
import { TIMING_CONTENT_MAPPINGS } from '../timing-content-manifest';
import type { EnergyContentEntry, TimingContentEntry } from '../content.types';
import { timingBase } from './timing-test-fixtures';

const RELEASE_CODE = 'workout-catalog-canonical-01b';
const REVISION_ID = '11111111-1111-4111-8111-111111111111';
const RELEASE_ID = '22222222-2222-4222-8222-222222222222';

/** Local review-only timing rows — not exported; loader must ignore unless passed explicitly. */
const TIMING_REVIEW_CANDIDATES: readonly TimingContentEntry[] = [
  withTimingChecksum(
    timingBase({
      exerciseKey: 'push_ups',
      expectedPublishedRevisionNumber: 2,
      contentVersion: 'workout-energy-timing-review-candidate',
      secondsPerRep: 2.5,
      sourceReference:
        'TEST_ONLY review candidate\nWA_CONTENT_VERSION_V1=workout-energy-timing-review-candidate',
      sourceVersion: 'test-review-candidate',
      rationale: 'review candidate only',
      romAssumptions: 'n/a',
      techniqueAssumptions: 'n/a',
      cadenceAssumptions: 'n/a',
      limitations: 'not in production manifest',
    }),
  ),
];

function pushUpsEntry(): EnergyContentEntry {
  return ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === 'push_ups')!;
}

function stretchingEntry(): EnergyContentEntry {
  return ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === 'stretching')!;
}

function createPinMockDb(options: {
  energyProfile?: {
    id: string;
    metValue: number;
    compendiumCode: string;
    sourceReference: string;
    sourceVersion: string;
    policyVersion: string;
  } | null;
  timingProfile?: {
    id: string;
    secondsPerRep: number;
    sourceReference: string;
    sourceVersion: string;
    policyVersion: string;
  } | null;
  withLock?: boolean;
}): PrismaService {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_xact_lock')) {
      return { rows: [{ pg_advisory_xact_lock: true }] };
    }
    if (sql.includes('WorkoutCatalogRelease') && sql.includes('PUBLISHED')) {
      return { rows: [{ id: RELEASE_ID, code: RELEASE_CODE }] };
    }
    if (sql.includes('WorkoutCatalogReleaseItem')) {
      return {
        rows: [
          {
            revisionId: REVISION_ID,
            revisionNumber: 2,
            revisionStatus: 'APPROVED',
            repetitionMode: 'REPS',
            enabledForGenerator: true,
            defaultDurationSeconds: null,
          },
        ],
      };
    }
    if (sql.includes('ExerciseEnergyProfile')) {
      if (options.energyProfile) {
        return {
          rows: [
            {
              id: options.energyProfile.id,
              status: 'APPROVED',
              metValue: options.energyProfile.metValue,
              compendiumCode: options.energyProfile.compendiumCode,
              sourceReference: options.energyProfile.sourceReference,
              sourceVersion: options.energyProfile.sourceVersion,
              policyVersion: options.energyProfile.policyVersion,
            },
          ],
        };
      }
      return { rows: [] };
    }
    if (sql.includes('ExerciseEnergyTimingProfile')) {
      if (options.timingProfile) {
        return {
          rows: [
            {
              id: options.timingProfile.id,
              secondsPerRep: options.timingProfile.secondsPerRep,
              sourceReference: options.timingProfile.sourceReference,
              sourceVersion: options.timingProfile.sourceVersion,
              policyVersion: options.timingProfile.policyVersion,
            },
          ],
        };
      }
      return { rows: [] };
    }
    return { rows: [] };
  });

  return {
    query,
    withTransaction: options.withLock
      ? vi.fn(async (fn: (q: typeof query) => Promise<unknown>) => fn(query))
      : vi.fn(),
  } as unknown as PrismaService;
}

describe('content loader', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it('validate mode passes structural checks with production manifests (no DB writes)', async () => {
    const report = await runWorkoutEnergyContentLoad({ mode: 'validate' });
    expect(report.mode).toBe('validate');
    expect(report.ok).toBe(true);
    expect(report.counts.energyManifest).toBe(ENERGY_CONTENT_MAPPINGS.length);
    expect(report.counts.timingManifest).toBe(TIMING_CONTENT_MAPPINGS.length);
    expect(report.counts.appliedNew).toBe(0);
    expect(report.counts.appliedRetired).toBe(0);
    expect(report.items.every((i) => i.outcome === 'NEW_PROFILE')).toBe(true);
  });

  it('dry-run requires a database client', async () => {
    const report = await runWorkoutEnergyContentLoad({ mode: 'dry-run' });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'LOADER_DB_REQUIRED')).toBe(true);
  });

  it('blocks apply on shared weight_app without disposable marker', async () => {
    delete process.env[WEIGHT_APP_DISPOSABLE_TEST_DB];
    const report = await runWorkoutEnergyContentLoad({
      mode: 'apply',
      databaseUrl: 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
      db: createPinMockDb({}),
    });
    expect(report.ok).toBe(false);
    expect(report.disposableConfirmed).toBeNull();
    expect(report.issues.some((i) => i.code === 'UNSAFE_DATABASE_TARGET')).toBe(true);
  });

  it('allowlist rejects shared DB name case variants and remote hosts even with marker', () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    const legacyAllowlistEnv = {
      ...process.env,
      WEIGHT_APP_DISPOSABLE_MODE: undefined,
      WEIGHT_APP_RUNTIME_ID: undefined,
      DISPOSABLE_POSTGRES_MARKER: undefined,
    };
    const probes: Array<{ url: string; expectReject: boolean }> = [
      { url: 'postgresql://u:p@localhost:5432/weight_app', expectReject: true },
      { url: 'postgresql://u:p@localhost:5432/WEIGHT_APP', expectReject: true },
      { url: 'postgresql://u:p@localhost:5432/Weight_App', expectReject: true },
      { url: 'postgresql://u:p@localhost:5432/weight%5Fapp', expectReject: true },
      { url: 'postgresql://u:p@127.0.0.1:5432/weight_app', expectReject: true },
      { url: 'postgresql://u:p@[::1]:5432/weight_app', expectReject: true },
      { url: 'postgresql://u:p@::1:5432/weight_app', expectReject: true },
      { url: 'postgresql://u:secret@staging.example.com:5432/wt_cat_test', expectReject: true },
      { url: 'postgresql://u:secret@prod.example.com:5432/wt_cat_test', expectReject: true },
      { url: 'postgresql://u:secret@203.0.113.10:5432/wt_cat_test', expectReject: true },
      { url: 'postgresql://u:p@localhost:5432/local_dev', expectReject: true },
      { url: 'not-a-url', expectReject: true },
      {
        url: 'postgresql://u:p@LOCALHOST:5432/wt_cat_123_abcdef012345?sslmode=disable',
        expectReject: false,
      },
      {
        url: 'postgresql://u:p@[::1]:5432/wt_cat_123_abcdef012345/',
        expectReject: false,
      },
      {
        url: 'postgresql://u:p%40ss@127.0.0.1:5432/wt_cat_123_abcdef012345',
        expectReject: false,
      },
    ];

    for (const probe of probes) {
      let threw = false;
      let message = '';
      try {
        confirmContentLoaderApplyDatabase(probe.url, legacyAllowlistEnv);
      } catch (err) {
        threw = true;
        message = err instanceof Error ? err.message : String(err);
      }
      expect(threw, `${probe.url}: ${message}`).toBe(probe.expectReject);
      expect(message).not.toMatch(/secret|p%40ss|password/i);
      if (probe.expectReject) {
        expect(message).toMatch(/^UNSAFE_DATABASE_TARGET:/);
      }
    }
  });

  it('allowlist accepts a canonical runtime-bound catalog database', () => {
    const runtimeId = 'wa-ci-12345678';
    const databaseUrl = 'postgresql://u:p@127.0.0.1:55432/wt_cat_ci_12345678_fixture';
    const confirmed = confirmContentLoaderApplyDatabase(databaseUrl, {
      [WEIGHT_APP_DISPOSABLE_MODE]: '1',
      [WEIGHT_APP_RUNTIME_ID]: runtimeId,
      [DISPOSABLE_POSTGRES_MARKER]: runtimeId,
    });

    expect(confirmed).toBe('SAFE_DISPOSABLE_DATABASE_CONFIRMED');
  });

  it('normalizeHostname strips IPv6 brackets and lowercases', () => {
    expect(normalizeHostname('[::1]')).toBe('::1');
    expect(normalizeHostname('LOCALHOST')).toBe('localhost');
  });

  it('reports CONFLICT when same contentVersion marker but mutated MET', async () => {
    const entry = stretchingEntry();
    const marker = formatContentVersionMarkerLine(entry.contentVersion);
    const db = createPinMockDb({
      energyProfile: {
        id: 'profile-conflict',
        metValue: 9.9,
        compendiumCode: entry.compendiumCode,
        sourceReference: `${entry.sourceReference.trim()}\n${marker}`.replace(
          new RegExp(`${CONTENT_VERSION_MARKER_PREFIX}${entry.contentVersion}\\n?`),
          '',
        ),
        sourceVersion: entry.sourceVersion,
        policyVersion: entry.policyVersion,
      },
    });
    // Ensure exactly one canonical marker line
    const existingRef = `citation\n${marker}`;
    const db2 = createPinMockDb({
      energyProfile: {
        id: 'profile-conflict',
        metValue: 9.9,
        compendiumCode: entry.compendiumCode,
        sourceReference: existingRef,
        sourceVersion: entry.sourceVersion,
        policyVersion: entry.policyVersion,
      },
    });

    const report = await runWorkoutEnergyContentLoad({
      mode: 'dry-run',
      db: db2,
      energyMappings: [entry],
      timingMappings: [],
    });

    expect(report.ok).toBe(false);
    const item = report.items.find((i) => i.exerciseKey === 'stretching');
    expect(item?.outcome).toBe('CONFLICT');
    expect(db).toBeTruthy();
  });

  it('reports RETIRE_AND_REPLACE when contentVersion marker changes', async () => {
    const entry = stretchingEntry();
    const db = createPinMockDb({
      energyProfile: {
        id: 'profile-retire',
        metValue: 9.9,
        compendiumCode: entry.compendiumCode,
        sourceReference: `citation\nWA_CONTENT_VERSION_V1=workout-energy-content-01b.1`,
        sourceVersion: entry.sourceVersion,
        policyVersion: entry.policyVersion,
      },
    });

    const report = await runWorkoutEnergyContentLoad({
      mode: 'dry-run',
      db,
      energyMappings: [entry],
      timingMappings: [],
    });

    expect(report.ok).toBe(true);
    const item = report.items.find((i) => i.exerciseKey === 'stretching');
    expect(item?.outcome).toBe('RETIRE_AND_REPLACE');
  });

  it('reports POLICY_MISMATCH when policyVersion differs on retire path', async () => {
    const entry = pushUpsEntry();
    const db = createPinMockDb({
      energyProfile: {
        id: 'profile-policy',
        metValue: 9.9,
        compendiumCode: entry.compendiumCode,
        sourceReference: entry.sourceReference,
        sourceVersion: entry.sourceVersion,
        policyVersion: 'workout-energy-0.9',
      },
    });

    const report = await runWorkoutEnergyContentLoad({
      mode: 'dry-run',
      db,
      energyMappings: [entry],
      timingMappings: [],
    });

    expect(report.ok).toBe(false);
    const item = report.items.find((i) => i.exerciseKey === 'push_ups');
    expect(item?.outcome).toBe('POLICY_MISMATCH');
  });

  it('keeps review-candidate fixture out of default production timing path', async () => {
    expect(TIMING_CONTENT_MAPPINGS).toHaveLength(49);
    expect(TIMING_REVIEW_CANDIDATES).toHaveLength(1);
    expect(
      TIMING_CONTENT_MAPPINGS.every((e) => e.contentVersion !== 'workout-energy-timing-review-candidate'),
    ).toBe(true);

    const report = await runWorkoutEnergyContentLoad({
      mode: 'validate',
      energyMappings: [],
      timingMappings: TIMING_CONTENT_MAPPINGS,
    });
    expect(report.counts.timingManifest).toBe(49);
    expect(report.ok).toBe(true);
  });

  it('parses canonical WA_CONTENT_VERSION_V1 marker and rejects malformed/multiple', () => {
    expect(
      parseContentVersionMarker('citation\nWA_CONTENT_VERSION_V1=workout-energy-content-01b-batch-01'),
    ).toEqual({ status: 'OK', version: 'workout-energy-content-01b-batch-01' });
    expect(parseContentVersionMarker('no marker')).toEqual({ status: 'ABSENT' });
    expect(parseContentVersionMarker('x\n[contentVersion:legacy]')).toEqual({
      status: 'INVALID',
      reason: 'MALFORMED_CONTENT_VERSION_MARKER',
    });
    expect(
      parseContentVersionMarker(
        'WA_CONTENT_VERSION_V1=a\nWA_CONTENT_VERSION_V1=b',
      ),
    ).toEqual({ status: 'INVALID', reason: 'MULTIPLE_CONTENT_VERSION_MARKERS' });
    expect(
      parseContentVersionMarker('forged WA_CONTENT_VERSION_V1=sneaky in prose'),
    ).toEqual({ status: 'INVALID', reason: 'MALFORMED_CONTENT_VERSION_MARKER' });
    expect(
      extractContentVersionFromSourceReference(
        'citation\nWA_CONTENT_VERSION_V1=workout-energy-content-01a.1',
      ),
    ).toBe('workout-energy-content-01a.1');
    expect(extractContentVersionFromSourceReference('no marker')).toBeNull();
  });

  it('sourceReferenceForDraft keeps 01a pilots unchanged and appends canonical marker for 01b', () => {
    const pilot = pushUpsEntry();
    expect(sourceReferenceForDraft(pilot)).toBe(pilot.sourceReference.trim());

    const next: EnergyContentEntry = {
      ...pilot,
      contentVersion: 'workout-energy-content-01b.1',
      sourceReference: 'human citation only',
    };
    expect(sourceReferenceForDraft(next)).toBe(
      `human citation only\nWA_CONTENT_VERSION_V1=workout-energy-content-01b.1`,
    );
  });

  it('formatContentLoadReport includes advisory lock key constant', () => {
    const report: ContentLoadReport = {
      mode: 'validate',
      ok: true,
      catalogReleaseKey: RELEASE_CODE,
      policyVersion: 'workout-energy-content-1.0',
      disposableConfirmed: null,
      dryRunPlan: null,
      appliedLockedPlan: null,
      issues: [],
      items: [],
      counts: {
        energyManifest: 8,
        timingManifest: 0,
        plannedNew: 8,
        plannedUnchanged: 0,
        plannedRetireReplace: 0,
        plannedConflict: 0,
        plannedInvalid: 0,
        appliedNew: 0,
        appliedUnchanged: 0,
        appliedRetired: 0,
      },
    };
    const text = formatContentLoadReport(report);
    expect(text).toContain('WORKOUT-ENERGY-CONTENT LOAD');
    expect(CONTENT_LOADER_ADVISORY_LOCK_KEY).toBe(21801001);
    expect(WORKOUT_ENERGY_POLICY_VERSION).toBe('workout-energy-1.0');
  });
});
