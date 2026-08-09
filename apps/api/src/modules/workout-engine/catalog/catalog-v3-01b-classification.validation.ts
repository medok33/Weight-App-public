/**
 * CATALOG-V3-01B — validate classification SoT against catalog inventory + V3 vocab.
 */
import { WORKOUT_CATALOG_MANIFEST } from './catalog-manifest';
import {
  CATALOG_V3_01B_CLASSIFICATION,
  CATALOG_V3_01B_CLASSIFICATION_VERSION,
  V3_01B_DIFFICULTIES,
  V3_01B_DISPOSITIONS,
  type V301bClassificationEntry,
  type V301bDisposition,
} from './catalog-v3-01b-classification';
import type { V3TaxonomyIssue } from './catalog-v3-taxonomy';
import { validateV3RevisionTaxonomyDraft } from './catalog-v3-taxonomy.validation';

export type V301bClassificationIssue = {
  code: string;
  message: string;
  exerciseKey?: string;
};

export type V301bDispositionCounts = Record<V301bDisposition, number>;

export type V301bClassificationValidationReport = {
  ok: boolean;
  version: typeof CATALOG_V3_01B_CLASSIFICATION_VERSION;
  entryCount: number;
  dispositionCounts: V301bDispositionCounts;
  issues: V301bClassificationIssue[];
};

function emptyDispositionCounts(): V301bDispositionCounts {
  return {
    KEEP: 0,
    KEEP_RENAME: 0,
    KEEP_RECLASSIFY: 0,
    MERGE_VARIANT: 0,
    KEEP_NOT_DEFAULT: 0,
    DEPRECATE: 0,
  };
}

function manifestKeys(): Set<string> {
  const keys = new Set<string>();
  for (const e of WORKOUT_CATALOG_MANIFEST) {
    keys.add(e.legacyExerciseKey ?? e.slug);
  }
  return keys;
}

/** Validate one classification row (taxonomy shape + disposition/difficulty). */
export function validateV301bClassificationEntry(
  entry: V301bClassificationEntry,
): V301bClassificationIssue[] {
  const issues: V301bClassificationIssue[] = [];
  const key = entry.exerciseKey;

  if (!key?.trim()) {
    issues.push({ code: 'MISSING_KEY', message: 'exerciseKey required' });
  }
  if (!(V3_01B_DISPOSITIONS as readonly string[]).includes(entry.disposition)) {
    issues.push({
      code: 'INVALID_DISPOSITION',
      message: `Invalid disposition ${entry.disposition}`,
      exerciseKey: key,
    });
  }
  if (!(V3_01B_DIFFICULTIES as readonly string[]).includes(entry.difficulty)) {
    issues.push({
      code: 'INVALID_DIFFICULTY',
      message: `Invalid difficulty ${entry.difficulty}`,
      exerciseKey: key,
    });
  }
  if (!Number.isInteger(entry.auditBaseRevisionNumber) || entry.auditBaseRevisionNumber < 1) {
    issues.push({
      code: 'INVALID_AUDIT_REVISION',
      message: `auditBaseRevisionNumber must be positive integer`,
      exerciseKey: key,
    });
  }
  if (entry.disposition === 'MERGE_VARIANT' && entry.identityAction !== 'PLAN_ONLY_NO_PHYSICAL_MERGE') {
    issues.push({
      code: 'MERGE_VARIANT_MUST_BE_PLAN_ONLY',
      message: 'MERGE_VARIANT requires identityAction=PLAN_ONLY_NO_PHYSICAL_MERGE',
      exerciseKey: key,
    });
  }
  if (entry.disposition === 'DEPRECATE') {
    issues.push({
      code: 'DEPRECATE_NOT_ALLOWED_IN_01B',
      message: '01B must not deprecate exercises',
      exerciseKey: key,
    });
  }

  // Fail closed: every assigned field must be present (no fake defaults).
  if (!entry.primaryMovementPattern?.trim()) {
    issues.push({
      code: 'MISSING_MOVEMENT_PATTERN',
      message: 'primaryMovementPattern required',
      exerciseKey: key,
    });
  }
  if (!entry.trainingRole?.trim()) {
    issues.push({
      code: 'MISSING_TRAINING_ROLE',
      message: 'trainingRole required',
      exerciseKey: key,
    });
  }
  if (!entry.progressionGroup?.trim()) {
    issues.push({
      code: 'MISSING_PROGRESSION_GROUP',
      message: 'progressionGroup required',
      exerciseKey: key,
    });
  }
  if (!entry.muscles?.length) {
    issues.push({
      code: 'MISSING_MUSCLES',
      message: 'at least one muscle involvement required',
      exerciseKey: key,
    });
  }
  if (!entry.equipmentGroups?.length) {
    issues.push({
      code: 'MISSING_EQUIPMENT',
      message: 'at least one equipment group required',
      exerciseKey: key,
    });
  }

  const taxIssues: V3TaxonomyIssue[] = validateV3RevisionTaxonomyDraft({
    exerciseRevisionId: 'validation-placeholder',
    primaryMovementPattern: entry.primaryMovementPattern,
    trainingRole: entry.trainingRole,
    progressionGroup: entry.progressionGroup,
    muscles: entry.muscles,
    equipmentGroups: entry.equipmentGroups,
  });
  for (const ti of taxIssues) {
    if (ti.code === 'MISSING_REVISION_ID') continue;
    issues.push({
      code: ti.code,
      message: ti.message,
      exerciseKey: key,
    });
  }

  return issues;
}

export function validateV301bClassificationManifest(
  entries: readonly V301bClassificationEntry[] = CATALOG_V3_01B_CLASSIFICATION,
): V301bClassificationValidationReport {
  const issues: V301bClassificationIssue[] = [];
  const dispositionCounts = emptyDispositionCounts();
  const seen = new Set<string>();
  const expected = manifestKeys();

  if (entries.length !== 84) {
    issues.push({
      code: 'ENTRY_COUNT',
      message: `Expected 84 classification entries, got ${entries.length}`,
    });
  }

  for (const entry of entries) {
    dispositionCounts[entry.disposition] =
      (dispositionCounts[entry.disposition] ?? 0) + 1;
    if (seen.has(entry.exerciseKey)) {
      issues.push({
        code: 'DUPLICATE_KEY',
        message: `Duplicate exerciseKey ${entry.exerciseKey}`,
        exerciseKey: entry.exerciseKey,
      });
    }
    seen.add(entry.exerciseKey);
    if (!expected.has(entry.exerciseKey)) {
      issues.push({
        code: 'UNKNOWN_MANIFEST_KEY',
        message: `exerciseKey ${entry.exerciseKey} not in WORKOUT_CATALOG_MANIFEST`,
        exerciseKey: entry.exerciseKey,
      });
    }
    issues.push(...validateV301bClassificationEntry(entry));
  }

  for (const key of expected) {
    if (!seen.has(key)) {
      issues.push({
        code: 'MISSING_MANIFEST_KEY',
        message: `Manifest key ${key} missing from 01B classification`,
        exerciseKey: key,
      });
    }
  }

  const expectedDispositions: V301bDispositionCounts = {
    KEEP: 6,
    KEEP_RENAME: 0,
    KEEP_RECLASSIFY: 69,
    MERGE_VARIANT: 3,
    KEEP_NOT_DEFAULT: 6,
    DEPRECATE: 0,
  };
  for (const d of V3_01B_DISPOSITIONS) {
    if (dispositionCounts[d] !== expectedDispositions[d]) {
      issues.push({
        code: 'DISPOSITION_COUNT_MISMATCH',
        message: `${d}: expected ${expectedDispositions[d]}, got ${dispositionCounts[d]}`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    version: CATALOG_V3_01B_CLASSIFICATION_VERSION,
    entryCount: entries.length,
    dispositionCounts,
    issues,
  };
}

export function assertV301bClassificationManifestValid(
  entries: readonly V301bClassificationEntry[] = CATALOG_V3_01B_CLASSIFICATION,
): void {
  const report = validateV301bClassificationManifest(entries);
  if (!report.ok) {
    throw new Error(
      `V3_01B_CLASSIFICATION_INVALID: ${report.issues
        .slice(0, 20)
        .map((i) => `${i.code}:${i.exerciseKey ?? '-'}:${i.message}`)
        .join('; ')}`,
    );
  }
}
