/**
 * CATALOG-V3-01C-B — validate Batch B NEW content + polish/deprecation SoT.
 */
import { WORKOUT_CATALOG_MANIFEST } from './catalog-manifest';
import { CATALOG_V3_01C_A_CONTENT } from './catalog-v3-01c-a-content';
import {
  CATALOG_V3_01C_B_CONTENT,
  CATALOG_V3_01C_B_DEPRECATE_EXPECTED_COUNT,
  CATALOG_V3_01C_B_DEPRECATIONS,
  CATALOG_V3_01C_B_EXPECTED_COUNT,
  CATALOG_V3_01C_B_HELD,
  CATALOG_V3_01C_B_POLISH,
  CATALOG_V3_01C_B_POLISH_EXPECTED_COUNT,
  CATALOG_V3_01C_B_VERSION,
  V3_01C_B_DIFFICULTIES,
  type V301cBContentEntry,
  type V301cBPolishEntry,
} from './catalog-v3-01c-b-content';
import {
  isV3MovementPatternCode,
  isV3MuscleCode,
  isV3TrainingRole,
} from './catalog-v3-taxonomy';
import { validateV3RevisionTaxonomyDraft } from './catalog-v3-taxonomy.validation';

export type V301cBIssue = {
  code: string;
  message: string;
  exerciseKey?: string;
};

export type V301cBValidationReport = {
  ok: boolean;
  version: typeof CATALOG_V3_01C_B_VERSION;
  entryCount: number;
  polishCount: number;
  deprecationCount: number;
  issues: V301cBIssue[];
};

function existing84Keys(): Set<string> {
  const keys = new Set<string>();
  for (const e of WORKOUT_CATALOG_MANIFEST) {
    keys.add(e.legacyExerciseKey ?? e.slug);
  }
  return keys;
}

function batchAKeys(): Set<string> {
  return new Set(CATALOG_V3_01C_A_CONTENT.map((e) => e.exerciseKey));
}

function validateContentEntry(entry: V301cBContentEntry): V301cBIssue[] {
  const issues: V301cBIssue[] = [];
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
  if (!(V3_01C_B_DIFFICULTIES as readonly string[]).includes(entry.difficulty)) {
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
  for (const place of entry.supportedPlaces) {
    if (!['HOME', 'GYM'].includes(place)) {
      issues.push({
        code: 'INVALID_PLACE',
        message: place,
        exerciseKey: key,
      });
    }
  }
  const dedicatedGymEquipment = [
    'LAT_PULLDOWN',
    'HACK_SQUAT',
    'PEC_DECK',
    'HIP_ADDUCTION_MACHINE',
    'ROW_ERG',
    'STAIR_CLIMBER',
    'SLED',
    'BATTLE_ROPES',
  ];
  const hasDedicatedGymEquipment = entry.equipmentGroups.some((g) =>
    g.items.some((i) => dedicatedGymEquipment.includes(i.equipmentCode)),
  );
  if (hasDedicatedGymEquipment && entry.supportedPlaces.includes('HOME')) {
    issues.push({
      code: 'HOME_WITH_DEDICATED_MACHINE',
      message: 'Dedicated gym equipment must not list HOME supportedPlace',
      exerciseKey: key,
    });
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
  if ('readiness' in entry) {
    issues.push({
      code: 'READINESS_IN_SOT',
      message: 'Batch B SoT must not embed readiness claims',
      exerciseKey: key,
    });
  }
  return issues;
}

function validatePolishEntry(entry: V301cBPolishEntry): V301cBIssue[] {
  const issues: V301cBIssue[] = [];
  const key = entry.exerciseKey;
  if (!batchAKeys().has(key)) {
    issues.push({
      code: 'POLISH_NOT_BATCH_A',
      message: 'Polish target must be a Batch A key',
      exerciseKey: key,
    });
  }
  if (!entry.polishReason?.trim()) {
    issues.push({
      code: 'MISSING_POLISH_REASON',
      message: 'polishReason required',
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
  const primaries = entry.muscles.filter((m) => m.involvement === 'PRIMARY');
  if (primaries.length !== 1) {
    issues.push({
      code: 'PRIMARY_MUSCLE_COUNT',
      message: `Expected exactly 1 PRIMARY, got ${primaries.length}`,
      exerciseKey: key,
    });
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
  return issues;
}

export function validateV301cBContentManifest(
  entries: readonly V301cBContentEntry[] = CATALOG_V3_01C_B_CONTENT,
): V301cBValidationReport {
  const issues: V301cBIssue[] = [];
  if (entries.length !== CATALOG_V3_01C_B_EXPECTED_COUNT) {
    issues.push({
      code: 'COUNT_MISMATCH',
      message: `Expected ${CATALOG_V3_01C_B_EXPECTED_COUNT}, got ${entries.length}`,
    });
  }
  if (CATALOG_V3_01C_B_POLISH.length !== CATALOG_V3_01C_B_POLISH_EXPECTED_COUNT) {
    issues.push({
      code: 'POLISH_COUNT_MISMATCH',
      message: `Expected ${CATALOG_V3_01C_B_POLISH_EXPECTED_COUNT} polish rows`,
    });
  }
  if (CATALOG_V3_01C_B_DEPRECATIONS.length !== CATALOG_V3_01C_B_DEPRECATE_EXPECTED_COUNT) {
    issues.push({
      code: 'DEPRECATE_COUNT_MISMATCH',
      message: `Expected ${CATALOG_V3_01C_B_DEPRECATE_EXPECTED_COUNT} deprecations`,
    });
  }

  const seen = new Set<string>();
  const existing84 = existing84Keys();
  const batchA = batchAKeys();
  for (const entry of entries) {
    if (seen.has(entry.exerciseKey)) {
      issues.push({
        code: 'DUPLICATE_KEY',
        message: `Duplicate ${entry.exerciseKey}`,
        exerciseKey: entry.exerciseKey,
      });
    }
    seen.add(entry.exerciseKey);
    if (existing84.has(entry.exerciseKey)) {
      issues.push({
        code: 'COLLIDES_WITH_EXISTING_84',
        message: `Key already in current 84: ${entry.exerciseKey}`,
        exerciseKey: entry.exerciseKey,
      });
    }
    if (batchA.has(entry.exerciseKey)) {
      issues.push({
        code: 'COLLIDES_WITH_BATCH_A',
        message: `Key already authored in Batch A: ${entry.exerciseKey}`,
        exerciseKey: entry.exerciseKey,
      });
    }
    issues.push(...validateContentEntry(entry));
  }

  const polishSeen = new Set<string>();
  for (const p of CATALOG_V3_01C_B_POLISH) {
    if (polishSeen.has(p.exerciseKey)) {
      issues.push({
        code: 'DUPLICATE_POLISH_KEY',
        message: p.exerciseKey,
        exerciseKey: p.exerciseKey,
      });
    }
    polishSeen.add(p.exerciseKey);
    if (seen.has(p.exerciseKey)) {
      issues.push({
        code: 'POLISH_ALSO_NEW',
        message: 'Polish key must not be a Batch B ADD',
        exerciseKey: p.exerciseKey,
      });
    }
    issues.push(...validatePolishEntry(p));
  }

  for (const d of CATALOG_V3_01C_B_DEPRECATIONS) {
    if (!batchA.has(d.exerciseKey)) {
      issues.push({
        code: 'DEPRECATE_NOT_BATCH_A',
        message: 'Deprecation target must be Batch A key',
        exerciseKey: d.exerciseKey,
      });
    }
    if (seen.has(d.exerciseKey) || polishSeen.has(d.exerciseKey)) {
      issues.push({
        code: 'DEPRECATE_ALSO_ACTIVE',
        message: 'Deprecated key must not also be NEW/POLISH',
        exerciseKey: d.exerciseKey,
      });
    }
    if (!existing84.has(d.mergeIntoKey) && !batchA.has(d.mergeIntoKey) && !seen.has(d.mergeIntoKey)) {
      issues.push({
        code: 'DEPRECATE_MERGE_TARGET_MISSING',
        message: `mergeIntoKey not found: ${d.mergeIntoKey}`,
        exerciseKey: d.exerciseKey,
      });
    }
    if (!d.reason?.includes('NOT_JUSTIFIED_CANONICAL_IDENTITY')) {
      issues.push({
        code: 'WEAK_DEPRECATION_REASON',
        message: 'Deprecation must document canonical identity decision',
        exerciseKey: d.exerciseKey,
      });
    }
  }

  for (const held of CATALOG_V3_01C_B_HELD) {
    if (seen.has(held.exerciseKey)) {
      issues.push({
        code: 'HELD_ALSO_SELECTED',
        message: `Held key also in Batch B content: ${held.exerciseKey}`,
        exerciseKey: held.exerciseKey,
      });
    }
  }

  /** FIX-01: published-identity duplicates + tibialis without accepted ankle pattern must stay HELD. */
  const requiredHeld = [
    {
      key: 'machine_chest_fly',
      reasonNeedle: 'BATCH_B_HELD_DUPLICATE_OF_PUBLISHED',
      retain: 'pec_deck_machine',
    },
    {
      key: 'glute_bridge_march_hold',
      reasonNeedle: 'BATCH_B_HELD_DUPLICATE_OF_PUBLISHED',
      retain: 'glute_bridge_march',
    },
    {
      key: 'ankle_mobility_knee_over_toe',
      reasonNeedle: 'BATCH_B_HELD_DUPLICATE_OF_PUBLISHED',
      retain: 'ankle_rocks',
    },
    {
      key: 'tibialis_raise',
      reasonNeedle: 'MISSING_ACCEPTED_ANKLE_DORSIFLEXION_PATTERN',
      retain: null,
    },
  ] as const;
  const heldByKey = new Map(CATALOG_V3_01C_B_HELD.map((h) => [h.exerciseKey, h]));
  for (const req of requiredHeld) {
    if (seen.has(req.key)) {
      issues.push({
        code: 'FIX01_ACTIVE_FORBIDDEN_KEY',
        message: `${req.key} must not be an active Batch B ADD`,
        exerciseKey: req.key,
      });
    }
    const held = heldByKey.get(req.key);
    if (!held || !held.reason.includes(req.reasonNeedle)) {
      issues.push({
        code: 'FIX01_REQUIRED_HOLD_MISSING',
        message: `${req.key} must be HELD with ${req.reasonNeedle}`,
        exerciseKey: req.key,
      });
    }
    if (req.retain && held && !held.reason.includes(req.retain)) {
      issues.push({
        code: 'FIX01_HOLD_RETAIN_TARGET_MISSING',
        message: `${req.key} hold reason must name retained identity ${req.retain}`,
        exerciseKey: req.key,
      });
    }
  }
  for (const entry of entries) {
    if (
      entry.exerciseKey === 'tibialis_raise' ||
      entry.primaryMovementPattern === 'KNEE_EXTENSION'
    ) {
      // tibialis must not be active; no other Batch B ADD currently uses KNEE_EXTENSION.
      if (entry.exerciseKey === 'tibialis_raise') {
        issues.push({
          code: 'TIBIALIS_ACTIVE_WITH_BAD_PATTERN',
          message: 'tibialis_raise must remain HELD (no accepted ankle dorsiflexion pattern)',
          exerciseKey: entry.exerciseKey,
        });
      }
    }
  }

  // Explicit polish regressions expected in this package.
  const polishKeys = new Set(CATALOG_V3_01C_B_POLISH.map((p) => p.exerciseKey));
  for (const required of ['bulgarian_split_squat', 'chin_up', 'dumbbell_fly']) {
    if (!polishKeys.has(required)) {
      issues.push({
        code: 'MISSING_REQUIRED_POLISH',
        message: required,
        exerciseKey: required,
      });
    }
  }
  if (!CATALOG_V3_01C_B_DEPRECATIONS.some((d) => d.exerciseKey === 'lat_pulldown_wide')) {
    issues.push({
      code: 'MISSING_LAT_PULLDOWN_WIDE_DECISION',
      message: 'lat_pulldown_wide must be deprecated or explicitly polished',
    });
  }

  const bulgarian = CATALOG_V3_01C_B_POLISH.find((p) => p.exerciseKey === 'bulgarian_split_squat');
  if (bulgarian) {
    const allOf = bulgarian.equipmentGroups.find((g) => g.groupKind === 'ALL_OF');
    const codes = new Set(allOf?.items.map((i) => i.equipmentCode) ?? []);
    if (!codes.has('BENCH') || !codes.has('BODYWEIGHT')) {
      issues.push({
        code: 'BULGARIAN_BENCH_REQUIRED',
        message: 'bulgarian_split_squat ALL_OF must require BODYWEIGHT+BENCH',
        exerciseKey: 'bulgarian_split_squat',
      });
    }
  }
  const chin = CATALOG_V3_01C_B_POLISH.find((p) => p.exerciseKey === 'chin_up');
  if (chin && !chin.muscles.some((m) => m.muscleCode === 'UPPER_BACK' && m.involvement === 'SECONDARY')) {
    issues.push({
      code: 'CHIN_UP_UPPER_BACK',
      message: 'chin_up polish must include UPPER_BACK secondary',
      exerciseKey: 'chin_up',
    });
  }
  const fly = CATALOG_V3_01C_B_POLISH.find((p) => p.exerciseKey === 'dumbbell_fly');
  if (fly && !fly.muscles.some((m) => m.muscleCode === 'FRONT_DELTS' && m.involvement === 'SECONDARY')) {
    issues.push({
      code: 'DUMBBELL_FLY_FRONT_DELTS',
      message: 'dumbbell_fly polish must include FRONT_DELTS secondary',
      exerciseKey: 'dumbbell_fly',
    });
  }

  return {
    ok: issues.length === 0,
    version: CATALOG_V3_01C_B_VERSION,
    entryCount: entries.length,
    polishCount: CATALOG_V3_01C_B_POLISH.length,
    deprecationCount: CATALOG_V3_01C_B_DEPRECATIONS.length,
    issues,
  };
}

export function assertV301cBContentManifestValid(
  entries: readonly V301cBContentEntry[] = CATALOG_V3_01C_B_CONTENT,
): void {
  const report = validateV301cBContentManifest(entries);
  if (!report.ok) {
    const sample = report.issues
      .slice(0, 8)
      .map((i) => `${i.code}:${i.exerciseKey ?? ''}:${i.message}`)
      .join('; ');
    throw new Error(`CATALOG_V3_01C_B_INVALID:${sample}`);
  }
}
