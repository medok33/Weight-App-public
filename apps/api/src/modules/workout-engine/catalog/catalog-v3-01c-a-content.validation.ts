/**
 * CATALOG-V3-01C-A — validate Batch A NEW content SoT.
 */
import { WORKOUT_CATALOG_MANIFEST } from './catalog-manifest';
import {
  CATALOG_V3_01C_A_CONTENT,
  CATALOG_V3_01C_A_EXPECTED_COUNT,
  CATALOG_V3_01C_A_HELD,
  CATALOG_V3_01C_A_VERSION,
  V3_01C_A_DIFFICULTIES,
  type V301cAContentEntry,
} from './catalog-v3-01c-a-content';
import {
  isV3MovementPatternCode,
  isV3MuscleCode,
  isV3TrainingRole,
} from './catalog-v3-taxonomy';
import { validateV3RevisionTaxonomyDraft } from './catalog-v3-taxonomy.validation';

export type V301cAIssue = {
  code: string;
  message: string;
  exerciseKey?: string;
};

export type V301cAValidationReport = {
  ok: boolean;
  version: typeof CATALOG_V3_01C_A_VERSION;
  entryCount: number;
  issues: V301cAIssue[];
};

function existing84Keys(): Set<string> {
  const keys = new Set<string>();
  for (const e of WORKOUT_CATALOG_MANIFEST) {
    keys.add(e.legacyExerciseKey ?? e.slug);
  }
  return keys;
}

export function validateV301cAContentEntry(entry: V301cAContentEntry): V301cAIssue[] {
  const issues: V301cAIssue[] = [];
  const key = entry.exerciseKey;
  if (!key?.trim()) {
    issues.push({ code: 'MISSING_KEY', message: 'exerciseKey required' });
  }
  if (!entry.nameRu?.trim()) {
    issues.push({ code: 'MISSING_NAME_RU', message: 'nameRu required', exerciseKey: key });
  }
  if (!entry.techniqueRu?.trim() || entry.techniqueRu.length < 40) {
    issues.push({
      code: 'WEAK_TECHNIQUE',
      message: 'techniqueRu must be specific (>=40 chars)',
      exerciseKey: key,
    });
  }
  if (/Maintain control and proper form/i.test(entry.techniqueRu)) {
    issues.push({
      code: 'TEMPLATE_TECHNIQUE',
      message: 'techniqueRu looks like a vague template',
      exerciseKey: key,
    });
  }
  if (!(V3_01C_A_DIFFICULTIES as readonly string[]).includes(entry.difficulty)) {
    issues.push({
      code: 'INVALID_DIFFICULTY',
      message: `Invalid difficulty ${entry.difficulty}`,
      exerciseKey: key,
    });
  }
  if (!isV3MovementPatternCode(entry.primaryMovementPattern)) {
    issues.push({
      code: 'INVALID_MOVEMENT_PATTERN',
      message: entry.primaryMovementPattern,
      exerciseKey: key,
    });
  }
  if (!isV3TrainingRole(entry.trainingRole)) {
    issues.push({
      code: 'INVALID_TRAINING_ROLE',
      message: entry.trainingRole,
      exerciseKey: key,
    });
  }
  if (!entry.familySlug?.trim() || !entry.progressionGroup?.trim()) {
    issues.push({
      code: 'MISSING_FAMILY_OR_PROGRESSION',
      message: 'familySlug/progressionGroup required',
      exerciseKey: key,
    });
  }
  if (!['REPS', 'DURATION'].includes(entry.repetitionMode)) {
    issues.push({
      code: 'INVALID_REPETITION_MODE',
      message: entry.repetitionMode,
      exerciseKey: key,
    });
  }
  const primaries = entry.muscles.filter((m) => m.involvement === 'PRIMARY');
  if (primaries.length !== 1) {
    issues.push({
      code: 'PRIMARY_MUSCLE_COUNT',
      message: `Expected exactly 1 PRIMARY, got ${primaries.length}`,
      exerciseKey: key,
    });
  }
  for (const m of entry.muscles) {
    if (!isV3MuscleCode(m.muscleCode)) {
      issues.push({
        code: 'INVALID_MUSCLE',
        message: m.muscleCode,
        exerciseKey: key,
      });
    }
  }
  const taxIssues = validateV3RevisionTaxonomyDraft({
    exerciseRevisionId: '00000000-0000-0000-0000-000000000000',
    primaryMovementPattern: entry.primaryMovementPattern,
    trainingRole: entry.trainingRole,
    progressionGroup: entry.progressionGroup,
    muscles: entry.muscles,
    equipmentGroups: entry.equipmentGroups,
  });
  for (const issue of taxIssues) {
    issues.push({
      code: issue.code,
      message: issue.message,
      exerciseKey: key,
    });
  }
  // Fail-closed: SoT must not claim readiness.
  if ('readiness' in entry) {
    issues.push({
      code: 'READINESS_IN_SOT',
      message: 'Batch A SoT must not embed readiness claims',
      exerciseKey: key,
    });
  }
  return issues;
}

export function validateV301cAContentManifest(
  entries: readonly V301cAContentEntry[] = CATALOG_V3_01C_A_CONTENT,
): V301cAValidationReport {
  const issues: V301cAIssue[] = [];
  if (entries.length !== CATALOG_V3_01C_A_EXPECTED_COUNT) {
    issues.push({
      code: 'COUNT_MISMATCH',
      message: `Expected ${CATALOG_V3_01C_A_EXPECTED_COUNT}, got ${entries.length}`,
    });
  }
  const seen = new Set<string>();
  const existing = existing84Keys();
  for (const entry of entries) {
    if (seen.has(entry.exerciseKey)) {
      issues.push({
        code: 'DUPLICATE_KEY',
        message: `Duplicate ${entry.exerciseKey}`,
        exerciseKey: entry.exerciseKey,
      });
    }
    seen.add(entry.exerciseKey);
    if (existing.has(entry.exerciseKey)) {
      issues.push({
        code: 'COLLIDES_WITH_EXISTING_84',
        message: `Key already in current 84: ${entry.exerciseKey}`,
        exerciseKey: entry.exerciseKey,
      });
    }
    issues.push(...validateV301cAContentEntry(entry));
  }
  for (const held of CATALOG_V3_01C_A_HELD) {
    if (seen.has(held.exerciseKey)) {
      issues.push({
        code: 'HELD_ALSO_SELECTED',
        message: `Held key also in Batch A content: ${held.exerciseKey}`,
        exerciseKey: held.exerciseKey,
      });
    }
  }
  return {
    ok: issues.length === 0,
    version: CATALOG_V3_01C_A_VERSION,
    entryCount: entries.length,
    issues,
  };
}

export function assertV301cAContentManifestValid(
  entries: readonly V301cAContentEntry[] = CATALOG_V3_01C_A_CONTENT,
): void {
  const report = validateV301cAContentManifest(entries);
  if (!report.ok) {
    const sample = report.issues
      .slice(0, 8)
      .map((i) => `${i.code}:${i.exerciseKey ?? ''}:${i.message}`)
      .join('; ');
    throw new Error(`CATALOG_V3_01C_A_INVALID:${sample}`);
  }
}
