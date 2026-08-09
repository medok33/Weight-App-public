/**
 * WORKOUT-ENERGY-CONTENT-01B — controlled content loader.
 * Modes: validate | dry-run | apply.
 * Apply: advisory lock → re-plan → writes (never stale pre-lock plans).
 * Apply requires an allowlisted legacy or canonical disposable target.
 * Never auto-invoked from API/worker/migration/CI check.
 */
import type { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { inspectDatabaseUrl } from '../../../../test-support/assert-disposable-database';
import { ExerciseEnergyProfileRepository } from '../exercise-energy-profile.repository';
import { ExerciseEnergyTimingProfileRepository } from '../exercise-energy-timing-profile.repository';
import {
  WORKOUT_ENERGY_POLICY_VERSION,
  WORKOUT_ENERGY_TIMING_POLICY_VERSION,
  type EnergyTimingSourceType,
} from '../workout-energy.types';
import { ENERGY_CONTENT_MAPPINGS } from './energy-content-manifest';
import { TIMING_CONTENT_MAPPINGS } from './timing-content-manifest';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from './product-policy';
import { resolvePublishedPinFromDb } from './release-pin-resolver';
import { validateContentPolicy } from './validate-content-policy';
import { validateEnergyManifest, validateTimingManifest } from './validate-manifest';
import type { ContentValidationIssue, EnergyContentEntry, TimingContentEntry } from './content.types';

export const CONTENT_LOADER_ADVISORY_LOCK_KEY = 21801001;

/** Ephemeral DB names created by disposable-catalog-db helper. */
export const DISPOSABLE_DB_NAME_PATTERN = /^wt_cat_[a-z0-9_]+$/i;

/** Canonical machine marker line for contentVersion (F-ID-01). */
export const CONTENT_VERSION_MARKER_PREFIX = 'WA_CONTENT_VERSION_V1=';
const CONTENT_VERSION_VALUE_RE = /^[a-zA-Z0-9._-]+$/;
const CONTENT_VERSION_LINE_RE = /^WA_CONTENT_VERSION_V1=([a-zA-Z0-9._-]+)$/;

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type ContentLoadMode = 'validate' | 'dry-run' | 'apply';

export type ContentLoadOutcome =
  | 'NEW_PROFILE'
  | 'UNCHANGED'
  | 'RETIRE_AND_REPLACE'
  | 'CONFLICT'
  | 'INVALID'
  | 'MISSING_REVISION_PIN'
  | 'AMBIGUOUS_REVISION_PIN'
  | 'REVISION_PIN_MISMATCH'
  | 'INVALID_PINNED_REVISION'
  | 'CHECKSUM_MISMATCH'
  | 'POLICY_MISMATCH';

export type ContentLoadItemResult = {
  kind: 'energy' | 'timing';
  exerciseKey: string;
  expectedPublishedRevisionNumber: number;
  outcome: ContentLoadOutcome;
  message: string;
  revisionId?: string;
};

export type ContentLoadReport = {
  mode: ContentLoadMode;
  ok: boolean;
  catalogReleaseKey: string;
  policyVersion: string;
  disposableConfirmed: string | null;
  /** Pre-lock advisory plan (dry-run / validate only). */
  dryRunPlan: ContentLoadItemResult[] | null;
  /** Locked plan used for apply writes (apply mode only). */
  appliedLockedPlan: ContentLoadItemResult[] | null;
  issues: ContentValidationIssue[];
  items: ContentLoadItemResult[];
  counts: {
    energyManifest: number;
    timingManifest: number;
    plannedNew: number;
    plannedUnchanged: number;
    plannedRetireReplace: number;
    plannedConflict: number;
    plannedInvalid: number;
    appliedNew: number;
    appliedUnchanged: number;
    appliedRetired: number;
  };
};

export type ContentLoaderInput = {
  mode: ContentLoadMode;
  db?: PrismaService;
  databaseUrl?: string | null;
  energyMappings?: readonly EnergyContentEntry[];
  timingMappings?: readonly TimingContentEntry[];
  reviewedBy?: string;
  /** Test-only: throw after N successful writes to prove rollback. */
  injectFailureAfterWrites?: number;
  /** Test-only: after advisory lock, before locked re-plan (concurrency barriers). */
  testHoldAfterLock?: () => Promise<void>;
};

export type ContentVersionParseResult =
  | { status: 'OK'; version: string }
  | { status: 'ABSENT' }
  | { status: 'INVALID'; reason: string };

/**
 * Normalize hostname for allowlist comparison:
 * lowercase, strip IPv6 brackets.
 */
export function normalizeHostname(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  return h;
}

/**
 * Allowlist apply guard: marker + ephemeral wt_cat_* name + loopback host.
 * Shared weight_app forbidden case-insensitively. Remote/staging/prod always rejected.
 */
export function confirmContentLoaderApplyDatabase(
  databaseUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const marker = env.WEIGHT_APP_DISPOSABLE_TEST_DB ?? env.WEIGHT_APP_DISPOSABLE_MODE;
  if (marker !== '1' && marker !== 'true') {
    throw new Error('UNSAFE_DATABASE_TARGET:DISPOSABLE_MARKER_REQUIRED');
  }

  const inspected = inspectDatabaseUrl(databaseUrl, {
    ...env,
    WEIGHT_APP_DISPOSABLE_TEST_DB: '1',
  });
  if (inspected.ok === false) {
    throw new Error(`UNSAFE_DATABASE_TARGET:${inspected.reason}`);
  }

  const dbName = inspected.database.trim();
  const dbNameLower = dbName.toLowerCase();
  if (dbNameLower === 'weight_app') {
    throw new Error('UNSAFE_DATABASE_TARGET:SHARED_WEIGHT_APP_DATABASE_FORBIDDEN');
  }
  if (!DISPOSABLE_DB_NAME_PATTERN.test(dbName)) {
    throw new Error('UNSAFE_DATABASE_TARGET:DISPOSABLE_DB_NAME_REQUIRED');
  }

  const host = normalizeHostname(inspected.host);
  if (!ALLOWED_LOOPBACK_HOSTS.has(host)) {
    throw new Error('UNSAFE_DATABASE_TARGET:HOST_NOT_ALLOWLISTED');
  }

  return 'SAFE_DISPOSABLE_DATABASE_CONFIRMED';
}

/** Parse strict WA_CONTENT_VERSION_V1=… lines from sourceReference. */
export function parseContentVersionMarker(
  sourceReference: string | null | undefined,
): ContentVersionParseResult {
  if (!sourceReference) return { status: 'ABSENT' };
  const markers: string[] = [];
  for (const rawLine of sourceReference.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = line.match(CONTENT_VERSION_LINE_RE);
    if (match) {
      markers.push(match[1]!);
      continue;
    }
    if (line.includes(CONTENT_VERSION_MARKER_PREFIX) || /\[contentVersion:/i.test(line)) {
      return { status: 'INVALID', reason: 'MALFORMED_CONTENT_VERSION_MARKER' };
    }
  }
  if (markers.length > 1) {
    return { status: 'INVALID', reason: 'MULTIPLE_CONTENT_VERSION_MARKERS' };
  }
  if (markers.length === 1) {
    return { status: 'OK', version: markers[0]! };
  }
  return { status: 'ABSENT' };
}

/** @deprecated Use parseContentVersionMarker — kept for unit tests during transition. */
export function extractContentVersionFromSourceReference(
  sourceReference: string | null | undefined,
): string | null {
  const parsed = parseContentVersionMarker(sourceReference);
  return parsed.status === 'OK' ? parsed.version : null;
}

function is01aPilotContent(entry: { contentVersion: string }): boolean {
  return entry.contentVersion.startsWith('workout-energy-content-01a');
}

export function formatContentVersionMarkerLine(contentVersion: string): string {
  if (!CONTENT_VERSION_VALUE_RE.test(contentVersion)) {
    throw new Error(`INVALID_CONTENT_VERSION:${contentVersion}`);
  }
  return `${CONTENT_VERSION_MARKER_PREFIX}${contentVersion}`;
}

/** Draft sourceReference: 01a as-is; 01b+ append exact machine marker when absent. */
export function sourceReferenceForDraft(entry: EnergyContentEntry | TimingContentEntry): string {
  const ref = entry.sourceReference.trim();
  const parsed = parseContentVersionMarker(ref);
  if (parsed.status === 'INVALID') {
    throw new Error(`CONTENT_VERSION_MARKER_INVALID:${parsed.reason}`);
  }
  if (parsed.status === 'OK') {
    if (parsed.version !== entry.contentVersion) {
      throw new Error('CONTENT_VERSION_MARKER_MISMATCH');
    }
    return ref;
  }
  if (is01aPilotContent(entry)) return ref;
  return `${ref}\n${formatContentVersionMarkerLine(entry.contentVersion)}`;
}

function resolvePayloadDiffOutcome(
  entry: { contentVersion: string; policyVersion: string },
  existing: { policyVersion: string; sourceReference: string },
): ContentLoadOutcome {
  if (existing.policyVersion !== entry.policyVersion) {
    return 'POLICY_MISMATCH';
  }
  const parsed = parseContentVersionMarker(existing.sourceReference);
  if (parsed.status === 'INVALID') {
    return 'INVALID';
  }
  if (parsed.status === 'OK' && parsed.version === entry.contentVersion) {
    // Same readable contentVersion with mutated payload — fail closed
    return 'CONFLICT';
  }
  // Different readable version, or unmarked historical row → explicit retire/replace
  // (never silent UNCHANGED when identity cannot be affirmed as matching).
  return 'RETIRE_AND_REPLACE';
}

function outcomeFromPinStatus(status: string): ContentLoadOutcome {
  if (
    status === 'MISSING_REVISION_PIN' ||
    status === 'AMBIGUOUS_REVISION_PIN' ||
    status === 'REVISION_PIN_MISMATCH' ||
    status === 'INVALID_PINNED_REVISION' ||
    status === 'WRONG_RELEASE'
  ) {
    return status === 'WRONG_RELEASE' ? 'INVALID' : (status as ContentLoadOutcome);
  }
  return 'INVALID';
}

function isBlockingOutcome(outcome: ContentLoadOutcome): boolean {
  return [
    'INVALID',
    'CHECKSUM_MISMATCH',
    'POLICY_MISMATCH',
    'CONFLICT',
    'MISSING_REVISION_PIN',
    'AMBIGUOUS_REVISION_PIN',
    'REVISION_PIN_MISMATCH',
    'INVALID_PINNED_REVISION',
  ].includes(outcome);
}

async function planEnergyItem(
  db: PrismaService | undefined,
  entry: EnergyContentEntry,
  issues: ContentValidationIssue[],
): Promise<ContentLoadItemResult> {
  const entryErrors = issues.filter(
    (i) => i.surface === 'energy' && i.exerciseKey === entry.exerciseKey && i.level === 'error',
  );
  if (entryErrors.length > 0) {
    const checksum = entryErrors.some((i) => i.code === 'CHECKSUM_MISMATCH');
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: checksum ? 'CHECKSUM_MISMATCH' : 'INVALID',
      message: entryErrors[0]!.message,
    };
  }

  const markerInManifest = parseContentVersionMarker(entry.sourceReference);
  if (markerInManifest.status === 'INVALID') {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'INVALID',
      message: markerInManifest.reason,
    };
  }

  if (!db) {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'NEW_PROFILE',
      message: 'validate-only: structural OK (no DB pin resolve)',
    };
  }
  const pin = await resolvePublishedPinFromDb(
    db,
    entry.exerciseKey,
    entry.expectedPublishedRevisionNumber,
  );
  if (pin.status !== 'OK' || !pin.revisionId) {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: outcomeFromPinStatus(pin.status),
      message: pin.status === 'OK' ? 'Published pin missing revisionId' : pin.message,
    };
  }

  const existing = await db.query<{
    id: string;
    status: string;
    metValue: string | number;
    compendiumCode: string;
    sourceReference: string;
    sourceVersion: string;
    policyVersion: string;
  }>(
    `SELECT id, status, "metValue", "compendiumCode", "sourceReference", "sourceVersion", "policyVersion"
     FROM "ExerciseEnergyProfile"
     WHERE "exerciseRevisionId" = $1 AND status = 'APPROVED' AND "enabledForCalculation" = true
     ORDER BY "approvedAt" DESC NULLS LAST
     LIMIT 2`,
    [pin.revisionId],
  );

  if (existing.rows.length > 1) {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'CONFLICT',
      message: 'Multiple active APPROVED energy profiles for revision',
      revisionId: pin.revisionId,
    };
  }

  const row = existing.rows[0];
  if (!row) {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'NEW_PROFILE',
      message: 'No APPROVED energy profile; would create',
      revisionId: pin.revisionId,
    };
  }

  const existingCv = parseContentVersionMarker(row.sourceReference);
  if (existingCv.status === 'INVALID') {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'INVALID',
      message: existingCv.reason,
      revisionId: pin.revisionId,
    };
  }

  const sameContentVersion =
    (existingCv.status === 'OK' && existingCv.version === entry.contentVersion) ||
    (existingCv.status === 'ABSENT' && is01aPilotContent(entry));
  const samePayload =
    Number(row.metValue) === entry.metValue &&
    row.compendiumCode === entry.compendiumCode &&
    row.sourceVersion === entry.sourceVersion &&
    row.policyVersion === entry.policyVersion &&
    sameContentVersion;

  if (samePayload) {
    return {
      kind: 'energy',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'UNCHANGED',
      message: 'Existing APPROVED profile matches manifest payload',
      revisionId: pin.revisionId,
    };
  }

  const diffOutcome = resolvePayloadDiffOutcome(entry, row);
  const message =
    diffOutcome === 'POLICY_MISMATCH'
      ? 'Existing APPROVED policyVersion differs; blocking replace'
      : diffOutcome === 'CONFLICT'
        ? 'Same contentVersion with mutated payload or unreadable marker; resolve before apply'
        : diffOutcome === 'INVALID'
          ? 'Existing APPROVED sourceReference contentVersion marker invalid'
          : 'Existing APPROVED differs; would retire and replace';
  return {
    kind: 'energy',
    exerciseKey: entry.exerciseKey,
    expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
    outcome: diffOutcome,
    message,
    revisionId: pin.revisionId,
  };
}

async function planTimingItem(
  db: PrismaService | undefined,
  entry: TimingContentEntry,
  issues: ContentValidationIssue[],
): Promise<ContentLoadItemResult> {
  const entryErrors = issues.filter(
    (i) => i.surface === 'timing' && i.exerciseKey === entry.exerciseKey && i.level === 'error',
  );
  if (entryErrors.length > 0) {
    const checksum = entryErrors.some((i) => i.code === 'CHECKSUM_MISMATCH');
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: checksum ? 'CHECKSUM_MISMATCH' : 'INVALID',
      message: entryErrors[0]!.message,
    };
  }
  const markerInManifest = parseContentVersionMarker(entry.sourceReference);
  if (markerInManifest.status === 'INVALID') {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'INVALID',
      message: markerInManifest.reason,
    };
  }
  if (!db) {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'NEW_PROFILE',
      message: 'validate-only: structural OK (no DB pin resolve)',
    };
  }
  const pin = await resolvePublishedPinFromDb(
    db,
    entry.exerciseKey,
    entry.expectedPublishedRevisionNumber,
  );
  if (pin.status !== 'OK' || !pin.revisionId) {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: outcomeFromPinStatus(pin.status),
      message: pin.status === 'OK' ? 'Published pin missing revisionId' : pin.message,
    };
  }

  const existing = await db.query<{
    id: string;
    secondsPerRep: string | number;
    sourceReference: string;
    sourceVersion: string;
    policyVersion: string;
  }>(
    `SELECT id, "secondsPerRep", "sourceReference", "sourceVersion", "policyVersion"
     FROM "ExerciseEnergyTimingProfile"
     WHERE "exerciseRevisionId" = $1 AND status = 'APPROVED' AND "enabledForCalculation" = true
     ORDER BY "approvedAt" DESC NULLS LAST
     LIMIT 2`,
    [pin.revisionId],
  );
  if (existing.rows.length > 1) {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'CONFLICT',
      message: 'Multiple active APPROVED timing profiles for revision',
      revisionId: pin.revisionId,
    };
  }
  const row = existing.rows[0];
  if (!row) {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'NEW_PROFILE',
      message: 'No APPROVED timing profile; would create',
      revisionId: pin.revisionId,
    };
  }
  const existingCv = parseContentVersionMarker(row.sourceReference);
  if (existingCv.status === 'INVALID') {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'INVALID',
      message: existingCv.reason,
      revisionId: pin.revisionId,
    };
  }
  const sameTimingContentVersion =
    (existingCv.status === 'OK' && existingCv.version === entry.contentVersion) ||
    (existingCv.status === 'ABSENT' && is01aPilotContent(entry));
  const same =
    Number(row.secondsPerRep) === entry.secondsPerRep &&
    row.sourceVersion === entry.sourceVersion &&
    row.policyVersion === entry.policyVersion &&
    sameTimingContentVersion;
  if (same) {
    return {
      kind: 'timing',
      exerciseKey: entry.exerciseKey,
      expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
      outcome: 'UNCHANGED',
      message: 'Existing APPROVED timing matches manifest',
      revisionId: pin.revisionId,
    };
  }
  const diffOutcome = resolvePayloadDiffOutcome(entry, row);
  const message =
    diffOutcome === 'POLICY_MISMATCH'
      ? 'Existing APPROVED timing policyVersion differs; blocking replace'
      : diffOutcome === 'CONFLICT'
        ? 'Same contentVersion with mutated timing payload or unreadable marker; resolve before apply'
        : diffOutcome === 'INVALID'
          ? 'Existing APPROVED timing sourceReference contentVersion marker invalid'
          : 'Existing APPROVED timing differs; would retire and replace';
  return {
    kind: 'timing',
    exerciseKey: entry.exerciseKey,
    expectedPublishedRevisionNumber: entry.expectedPublishedRevisionNumber,
    outcome: diffOutcome,
    message,
    revisionId: pin.revisionId,
  };
}

async function planAll(
  db: PrismaService | undefined,
  energyMappings: readonly EnergyContentEntry[],
  timingMappings: readonly TimingContentEntry[],
  issues: ContentValidationIssue[],
): Promise<ContentLoadItemResult[]> {
  const items: ContentLoadItemResult[] = [];
  for (const entry of energyMappings) {
    items.push(await planEnergyItem(db, entry, issues));
  }
  for (const entry of timingMappings) {
    items.push(await planTimingItem(db, entry, issues));
  }
  return items;
}

function tally(items: ContentLoadItemResult[]) {
  return {
    plannedNew: items.filter((i) => i.outcome === 'NEW_PROFILE').length,
    plannedUnchanged: items.filter((i) => i.outcome === 'UNCHANGED').length,
    plannedRetireReplace: items.filter((i) => i.outcome === 'RETIRE_AND_REPLACE').length,
    plannedConflict: items.filter((i) => i.outcome === 'CONFLICT').length,
    plannedInvalid: items.filter((i) => isBlockingOutcome(i.outcome)).length,
  };
}

function emptyCounts(energyManifest: number, timingManifest: number) {
  return {
    energyManifest,
    timingManifest,
    plannedNew: 0,
    plannedUnchanged: 0,
    plannedRetireReplace: 0,
    plannedConflict: 0,
    plannedInvalid: 0,
    appliedNew: 0,
    appliedUnchanged: 0,
    appliedRetired: 0,
  };
}

export async function runWorkoutEnergyContentLoad(
  input: ContentLoaderInput,
): Promise<ContentLoadReport> {
  const energyMappings = input.energyMappings ?? ENERGY_CONTENT_MAPPINGS;
  const timingMappings = input.timingMappings ?? TIMING_CONTENT_MAPPINGS;
  const issues: ContentValidationIssue[] = [
    ...validateContentPolicy(),
    ...validateEnergyManifest(energyMappings),
    ...validateTimingManifest(timingMappings),
  ];

  let disposableConfirmed: string | null = null;
  if (input.mode === 'apply' || input.mode === 'dry-run') {
    if (!input.db) {
      issues.push({
        level: 'error',
        surface: 'policy',
        code: 'LOADER_DB_REQUIRED',
        exerciseKey: '*',
        message: `${input.mode} requires a database client`,
      });
    }
  }
  if (input.mode === 'apply') {
    try {
      disposableConfirmed = confirmContentLoaderApplyDatabase(
        input.databaseUrl ?? process.env.DATABASE_URL,
      );
    } catch (err) {
      issues.push({
        level: 'error',
        surface: 'policy',
        code: 'UNSAFE_DATABASE_TARGET',
        exerciseKey: '*',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const staticBlocking = issues.some((i) => i.level === 'error');

  // validate / dry-run: plan without write lock (apply never uses this plan for writes)
  if (input.mode === 'validate' || input.mode === 'dry-run' || staticBlocking) {
    const dbForPlan =
      input.mode === 'validate' || staticBlocking || !input.db ? undefined : input.db;
    const items =
      input.mode === 'validate' || !staticBlocking
        ? await planAll(dbForPlan, energyMappings, timingMappings, issues)
        : [];
    const planned = items.length ? tally(items) : emptyCounts(energyMappings.length, timingMappings.length);
    const blocking =
      staticBlocking || items.some((i) => isBlockingOutcome(i.outcome));
    return {
      mode: input.mode,
      ok: !blocking && (input.mode !== 'dry-run' || !staticBlocking),
      catalogReleaseKey: WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey,
      policyVersion: WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.policyVersion,
      disposableConfirmed,
      dryRunPlan: input.mode === 'dry-run' || input.mode === 'validate' ? items : null,
      appliedLockedPlan: null,
      issues,
      items,
      counts: {
        ...planned,
        energyManifest: energyMappings.length,
        timingManifest: timingMappings.length,
        appliedNew: 0,
        appliedUnchanged: 0,
        appliedRetired: 0,
      },
    };
  }

  // apply: advisory pre-lock plan is report-only; writes use locked re-plan only
  const db = input.db!;
  const reviewedBy = input.reviewedBy?.trim() || 'weight-app-internal-content-review-v1';
  const dryRunPlan = await planAll(db, energyMappings, timingMappings, issues);
  let writes = 0;
  let lockedItems: ContentLoadItemResult[] = [];
  let appliedNew = 0;
  let appliedUnchanged = 0;
  let appliedRetired = 0;
  let applyOk = true;

  await db.withTransaction(async (query) => {
    const txDb = { query } as unknown as PrismaService;
    await query(`SELECT pg_advisory_xact_lock($1)`, [CONTENT_LOADER_ADVISORY_LOCK_KEY]);

    if (input.testHoldAfterLock) {
      await input.testHoldAfterLock();
    }

    lockedItems = await planAll(txDb, energyMappings, timingMappings, issues);
    const lockedBlocking =
      issues.some((i) => i.level === 'error') ||
      lockedItems.some((i) => isBlockingOutcome(i.outcome));
    if (lockedBlocking) {
      applyOk = false;
      return;
    }

    const energyRepo = new ExerciseEnergyProfileRepository(txDb);
    const timingRepo = new ExerciseEnergyTimingProfileRepository(txDb);

    for (const item of lockedItems) {
      if (item.outcome === 'UNCHANGED') {
        appliedUnchanged += 1;
        continue;
      }
      if (item.outcome !== 'NEW_PROFILE' && item.outcome !== 'RETIRE_AND_REPLACE') {
        continue;
      }
      if (!item.revisionId) continue;

      if (item.kind === 'energy') {
        const entry = energyMappings.find((e) => e.exerciseKey === item.exerciseKey)!;
        if (item.outcome === 'RETIRE_AND_REPLACE') {
          const active = await query<{ id: string }>(
            `SELECT id FROM "ExerciseEnergyProfile"
             WHERE "exerciseRevisionId" = $1 AND status = 'APPROVED' AND "enabledForCalculation" = true`,
            [item.revisionId],
          );
          for (const row of active.rows) {
            await energyRepo.retire(row.id, 'CONTENT_VERSION_REPLACE');
            appliedRetired += 1;
            writes += 1;
          }
        }
        const draft = await energyRepo.createDraft({
          exerciseRevisionId: item.revisionId,
          calculationMethod: 'MET_DURATION',
          populationType: 'ADULT_STANDARD_2024',
          compendiumEdition: entry.compendiumEdition,
          compendiumCode: entry.compendiumCode,
          metValue: entry.metValue,
          sourceType: 'COMPENDIUM_ADULT_2024',
          sourceReference: sourceReferenceForDraft(entry),
          sourceVersion: entry.sourceVersion,
          policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
        });
        writes += 1;
        await energyRepo.approve(draft.id, reviewedBy);
        writes += 1;
        appliedNew += 1;
      } else {
        const entry = timingMappings.find((e) => e.exerciseKey === item.exerciseKey)!;
        if (item.outcome === 'RETIRE_AND_REPLACE') {
          const active = await query<{ id: string }>(
            `SELECT id FROM "ExerciseEnergyTimingProfile"
             WHERE "exerciseRevisionId" = $1 AND status = 'APPROVED' AND "enabledForCalculation" = true`,
            [item.revisionId],
          );
          for (const row of active.rows) {
            await timingRepo.retire(row.id, 'CONTENT_VERSION_REPLACE');
            appliedRetired += 1;
            writes += 1;
          }
        }
        const draft = await timingRepo.createDraft({
          exerciseRevisionId: item.revisionId,
          timingMethod: 'SECONDS_PER_REP',
          secondsPerRep: entry.secondsPerRep,
          sourceType: entry.sourceType as EnergyTimingSourceType,
          sourceReference: sourceReferenceForDraft(entry),
          sourceVersion: entry.sourceVersion,
          policyVersion: WORKOUT_ENERGY_TIMING_POLICY_VERSION,
        });
        writes += 1;
        await timingRepo.approve(draft.id, reviewedBy);
        writes += 1;
        appliedNew += 1;
      }

      if (
        input.injectFailureAfterWrites != null &&
        writes >= input.injectFailureAfterWrites
      ) {
        throw new Error('CONTENT_LOADER_INJECTED_FAILURE');
      }
    }
  });

  const planned = tally(lockedItems);
  return {
    mode: 'apply',
    ok: applyOk,
    catalogReleaseKey: WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey,
    policyVersion: WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.policyVersion,
    disposableConfirmed,
    dryRunPlan,
    appliedLockedPlan: lockedItems,
    issues,
    items: lockedItems,
    counts: {
      energyManifest: energyMappings.length,
      timingManifest: timingMappings.length,
      ...planned,
      appliedNew,
      appliedUnchanged,
      appliedRetired,
    },
  };
}

export function formatContentLoadReport(report: ContentLoadReport): string {
  return [
    '================================================================================',
    ' WORKOUT-ENERGY-CONTENT LOAD',
    '================================================================================',
    `mode=${report.mode}`,
    `ok=${report.ok}`,
    `catalogRelease=${report.catalogReleaseKey}`,
    `policyVersion=${report.policyVersion}`,
    `disposable=${report.disposableConfirmed ?? 'n/a'}`,
    `energyManifest=${report.counts.energyManifest}`,
    `timingManifest=${report.counts.timingManifest}`,
    `planned new/unchanged/retireReplace/conflict/invalid=` +
      `${report.counts.plannedNew}/${report.counts.plannedUnchanged}/` +
      `${report.counts.plannedRetireReplace}/${report.counts.plannedConflict}/` +
      `${report.counts.plannedInvalid}`,
    `applied new/unchanged/retired=` +
      `${report.counts.appliedNew}/${report.counts.appliedUnchanged}/${report.counts.appliedRetired}`,
    `issues=${report.issues.filter((i) => i.level === 'error').length}`,
    '================================================================================',
  ].join('\n');
}
