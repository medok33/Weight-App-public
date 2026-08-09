/**
 * Strict validators for energy/timing content manifests.
 * Runtime checks use `unknown` — do not rely on TypeScript alone.
 */
import {
  ENERGY_MAPPING_CLASSES,
  TIMING_EVIDENCE_CLASSES,
  type ContentValidationIssue,
  type EnergyContentEntry,
  type TimingContentEntry,
} from './content.types';
import { computeEnergyContentChecksum, computeTimingContentChecksum } from './content-checksum';
import { isCanonicalReviewedAt } from './canonical-reviewed-at';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from './product-policy';
import {
  hasHedgedTimingSemantics,
  serializeTimingPhaseModel,
  sumTimingPhases,
  WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION,
} from './timing-methodology';
import type { TimingMovementPhases } from './content.types';
import {
  ENERGY_MET_MAX,
  ENERGY_MET_MIN,
  ENERGY_SECONDS_PER_REP_MAX,
  ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE,
  WORKOUT_ENERGY_POLICY_VERSION,
  WORKOUT_ENERGY_TIMING_POLICY_VERSION,
} from '../workout-energy.types';

export { isCanonicalReviewedAt } from './canonical-reviewed-at';

/** Canonical production manifests accept only APPROVED entries. */
export const CANONICAL_PRODUCTION_STATUS = 'APPROVED' as const;

const COMPENDIUM_CODE_RE = /^\d{5}$/;

const TIMING_SOURCE_TYPES = [
  'INTERNAL_REVIEWED_POLICY',
  'PRIMARY_RESEARCH',
  'OFFICIAL_STANDARD',
  'MANUFACTURER',
] as const;

function issue(
  surface: ContentValidationIssue['surface'],
  exerciseKey: string,
  code: string,
  message: string,
): ContentValidationIssue {
  return { level: 'error', surface, code, exerciseKey, message };
}

function requireExactString(
  issues: ContentValidationIssue[],
  surface: ContentValidationIssue['surface'],
  exerciseKey: string,
  code: string,
  label: string,
  value: unknown,
): void {
  if (value === null) {
    issues.push(issue(surface, exerciseKey, code, `${label} must not be null`));
    return;
  }
  if (value === undefined) {
    issues.push(issue(surface, exerciseKey, code, `${label} is required`));
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(issue(surface, exerciseKey, code, `${label} is required`));
  }
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function exerciseKeyOf(record: Record<string, unknown> | null): string {
  const key = record?.exerciseKey;
  return typeof key === 'string' && key.length > 0 ? key : '*';
}

function validateCanonicalProductionStatus(
  issues: ContentValidationIssue[],
  surface: ContentValidationIssue['surface'],
  exerciseKey: string,
  status: unknown,
): void {
  if (status === null) {
    issues.push(issue(surface, exerciseKey, 'INVALID_STATUS', 'status must not be null'));
    return;
  }
  if (status === undefined) {
    issues.push(issue(surface, exerciseKey, 'INVALID_STATUS', 'status is required'));
    return;
  }
  if (typeof status !== 'string') {
    issues.push(issue(surface, exerciseKey, 'INVALID_STATUS', 'status must be a string'));
    return;
  }
  if (status !== CANONICAL_PRODUCTION_STATUS) {
    issues.push(
      issue(
        surface,
        exerciseKey,
        status === 'DRAFT' || status === 'RETIRED' ? 'NON_APPROVED_PRODUCTION_STATUS' : 'INVALID_STATUS',
        `canonical production status must be ${CANONICAL_PRODUCTION_STATUS}; got ${JSON.stringify(status)}`,
      ),
    );
  }
}

function validateCatalogReleaseKey(
  issues: ContentValidationIssue[],
  surface: ContentValidationIssue['surface'],
  exerciseKey: string,
  catalogReleaseKey: unknown,
): void {
  const expected = WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey;
  if (catalogReleaseKey === null) {
    issues.push(
      issue(surface, exerciseKey, 'WRONG_CATALOG_RELEASE', 'catalogReleaseKey must not be null'),
    );
    return;
  }
  if (catalogReleaseKey === undefined) {
    issues.push(
      issue(surface, exerciseKey, 'WRONG_CATALOG_RELEASE', 'catalogReleaseKey is required'),
    );
    return;
  }
  // Exact match only — no trim/normalization.
  if (catalogReleaseKey !== expected) {
    issues.push(
      issue(
        surface,
        exerciseKey,
        'WRONG_CATALOG_RELEASE',
        `catalogReleaseKey must be exactly ${expected}`,
      ),
    );
  }
}

function validateReviewedAt(
  issues: ContentValidationIssue[],
  surface: ContentValidationIssue['surface'],
  exerciseKey: string,
  reviewedAt: unknown,
): void {
  if (reviewedAt === null) {
    issues.push(
      issue(surface, exerciseKey, 'MALFORMED_REVIEWED_AT', 'reviewedAt must not be null'),
    );
    return;
  }
  if (reviewedAt === undefined) {
    issues.push(issue(surface, exerciseKey, 'MALFORMED_REVIEWED_AT', 'reviewedAt is required'));
    return;
  }
  if (!isCanonicalReviewedAt(reviewedAt)) {
    issues.push(
      issue(
        surface,
        exerciseKey,
        'MALFORMED_REVIEWED_AT',
        'reviewedAt must be canonical UTC calendar date YYYY-MM-DD',
      ),
    );
  }
}

export function validateEnergyContentEntry(input: unknown): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  const record = asRecord(input);
  if (!record) {
    return [
      issue(
        'energy',
        '*',
        'INVALID_ENERGY_ENTRY',
        'energy entry must be a non-null object',
      ),
    ];
  }
  const key = exerciseKeyOf(record);
  const surface = 'energy' as const;

  requireExactString(issues, surface, key, 'MISSING_EXERCISE_KEY', 'exerciseKey', record.exerciseKey);
  requireExactString(issues, surface, key, 'MISSING_REVIEWER', 'reviewedBy', record.reviewedBy);
  requireExactString(issues, surface, key, 'MISSING_RATIONALE', 'rationale', record.rationale);
  requireExactString(issues, surface, key, 'MISSING_LIMITATIONS', 'limitations', record.limitations);
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_SOURCE_REFERENCE',
    'sourceReference',
    record.sourceReference,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_SOURCE_VERSION',
    'sourceVersion',
    record.sourceVersion,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_CONTENT_VERSION',
    'contentVersion',
    record.contentVersion,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_ACTIVITY_DESCRIPTION',
    'activityDescriptionEn',
    record.activityDescriptionEn,
  );

  if (
    record.expectedPublishedRevisionNumber === null ||
    record.expectedPublishedRevisionNumber === undefined ||
    typeof record.expectedPublishedRevisionNumber !== 'number' ||
    !Number.isInteger(record.expectedPublishedRevisionNumber) ||
    record.expectedPublishedRevisionNumber < 1
  ) {
    issues.push(
      issue(
        surface,
        key,
        'MISSING_REVISION_NUMBER',
        'expectedPublishedRevisionNumber must be a positive integer',
      ),
    );
  }

  validateCatalogReleaseKey(issues, surface, key, record.catalogReleaseKey);

  if (record.policyVersion !== WORKOUT_ENERGY_POLICY_VERSION) {
    issues.push(
      issue(
        surface,
        key,
        'WRONG_POLICY_VERSION',
        `policyVersion must be ${WORKOUT_ENERGY_POLICY_VERSION}`,
      ),
    );
  }

  if (record.populationType !== 'ADULT_STANDARD_2024') {
    issues.push(
      issue(surface, key, 'UNSUPPORTED_POPULATION', 'Only ADULT_STANDARD_2024 is supported'),
    );
  }

  if (record.calculationMethod !== 'MET_DURATION') {
    issues.push(
      issue(surface, key, 'UNSUPPORTED_CALCULATION_METHOD', 'calculationMethod must be MET_DURATION'),
    );
  }

  if (record.compendiumEdition !== 'ADULT_2024') {
    issues.push(
      issue(surface, key, 'WRONG_COMPENDIUM_EDITION', 'compendiumEdition must be ADULT_2024'),
    );
  }

  if (typeof record.compendiumCode !== 'string' || !COMPENDIUM_CODE_RE.test(record.compendiumCode)) {
    issues.push(
      issue(
        surface,
        key,
        'MALFORMED_COMPENDIUM_CODE',
        'compendiumCode must be a 5-digit Adult Compendium code',
      ),
    );
  }

  if (
    typeof record.metValue !== 'number' ||
    !Number.isFinite(record.metValue) ||
    record.metValue <= ENERGY_MET_MIN ||
    record.metValue > ENERGY_MET_MAX
  ) {
    issues.push(
      issue(
        surface,
        key,
        'INVALID_MET',
        `metValue must be in (${ENERGY_MET_MIN}, ${ENERGY_MET_MAX}]`,
      ),
    );
  }

  if (!(ENERGY_MAPPING_CLASSES as readonly string[]).includes(String(record.mappingClass))) {
    issues.push(
      issue(
        surface,
        key,
        'INVALID_MAPPING_CLASS',
        `mappingClass must be one of ${ENERGY_MAPPING_CLASSES.join('|')}`,
      ),
    );
  }

  validateCanonicalProductionStatus(issues, surface, key, record.status);
  validateReviewedAt(issues, surface, key, record.reviewedAt);

  // Checksum only after structural validation passes — never accept checksum for invalid input.
  if (!issues.some((i) => i.level === 'error')) {
    try {
      const expected = computeEnergyContentChecksum(record as unknown as EnergyContentEntry);
      if (record.checksum !== expected) {
        issues.push(
          issue(surface, key, 'CHECKSUM_MISMATCH', 'checksum does not match canonical content'),
        );
      }
    } catch {
      issues.push(
        issue(
          surface,
          key,
          'CHECKSUM_INPUT_INVALID',
          'checksum cannot be computed for structurally invalid input',
        ),
      );
    }
  }

  return issues;
}

export function validateTimingContentEntry(input: unknown): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  const record = asRecord(input);
  if (!record) {
    return [
      issue(
        'timing',
        '*',
        'INVALID_TIMING_ENTRY',
        'timing entry must be a non-null object',
      ),
    ];
  }
  const key = exerciseKeyOf(record);
  const surface = 'timing' as const;

  requireExactString(issues, surface, key, 'MISSING_EXERCISE_KEY', 'exerciseKey', record.exerciseKey);
  requireExactString(issues, surface, key, 'MISSING_REVIEWER', 'reviewedBy', record.reviewedBy);
  requireExactString(issues, surface, key, 'MISSING_RATIONALE', 'rationale', record.rationale);
  requireExactString(issues, surface, key, 'MISSING_LIMITATIONS', 'limitations', record.limitations);
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_SOURCE_REFERENCE',
    'sourceReference',
    record.sourceReference,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_SOURCE_VERSION',
    'sourceVersion',
    record.sourceVersion,
  );
  requireExactString(issues, surface, key, 'MISSING_ROM', 'romAssumptions', record.romAssumptions);
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_TECHNIQUE',
    'techniqueAssumptions',
    record.techniqueAssumptions,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_CADENCE',
    'cadenceAssumptions',
    record.cadenceAssumptions,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_METHODOLOGY_VERSION',
    'methodologyVersion',
    record.methodologyVersion,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_ONE_REP_DEFINITION',
    'oneRepDefinition',
    record.oneRepDefinition,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_UNILATERAL_SEMANTICS',
    'unilateralSemantics',
    record.unilateralSemantics,
  );

  if (
    typeof record.unilateralSemantics === 'string' &&
    record.unilateralSemantics.trim().length > 0 &&
    hasHedgedTimingSemantics(record.unilateralSemantics)
  ) {
    issues.push(
      issue(
        surface,
        key,
        'HEDGED_UNILATERAL_SEMANTICS',
        'APPROVED timing unilateralSemantics must be decisive (no typical/as-catalogued/or/depending hedges)',
      ),
    );
  }

  if (
    typeof record.oneRepDefinition === 'string' &&
    record.oneRepDefinition.trim().length > 0 &&
    hasHedgedTimingSemantics(record.oneRepDefinition)
  ) {
    issues.push(
      issue(
        surface,
        key,
        'UNPROVEN_CATALOG_COUNTING_REFERENCE',
        'oneRepDefinition must not hedge or defer counting/side semantics to catalog/typical/variation language',
      ),
    );
  }

  requireExactString(
    issues,
    surface,
    key,
    'MISSING_PHASE_MODEL',
    'phaseModel',
    record.phaseModel,
  );
  requireExactString(
    issues,
    surface,
    key,
    'MISSING_CONTENT_VERSION',
    'contentVersion',
    record.contentVersion,
  );

  if (record.methodologyVersion !== WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION) {
    issues.push(
      issue(
        surface,
        key,
        'WRONG_METHODOLOGY_VERSION',
        `methodologyVersion must be ${WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION}`,
      ),
    );
  }

  const phasesRaw = record.movementPhases;
  if (!phasesRaw || typeof phasesRaw !== 'object' || Array.isArray(phasesRaw)) {
    issues.push(
      issue(
        surface,
        key,
        'MISSING_MOVEMENT_PHASES',
        'movementPhases must be a non-null object of explicit phase durations',
      ),
    );
  } else {
    try {
      const phases = phasesRaw as TimingMovementPhases;
      const phaseSum = sumTimingPhases(phases);
      const expectedModel = serializeTimingPhaseModel(phases);
      if (record.phaseModel !== expectedModel) {
        issues.push(
          issue(
            surface,
            key,
            'PHASE_MODEL_MISMATCH',
            'phaseModel must equal serializeTimingPhaseModel(movementPhases)',
          ),
        );
      }
      if (
        typeof record.secondsPerRep === 'number' &&
        Number.isFinite(record.secondsPerRep) &&
        Math.abs(phaseSum - record.secondsPerRep) > 1e-9
      ) {
        issues.push(
          issue(
            surface,
            key,
            'SECONDS_PER_REP_PHASE_MISMATCH',
            `secondsPerRep (${record.secondsPerRep}) must equal phase sum (${phaseSum})`,
          ),
        );
      }
    } catch (err) {
      issues.push(
        issue(
          surface,
          key,
          'INVALID_MOVEMENT_PHASES',
          err instanceof Error ? err.message : 'invalid movementPhases',
        ),
      );
    }
  }

  if (
    record.expectedPublishedRevisionNumber === null ||
    record.expectedPublishedRevisionNumber === undefined ||
    typeof record.expectedPublishedRevisionNumber !== 'number' ||
    !Number.isInteger(record.expectedPublishedRevisionNumber) ||
    record.expectedPublishedRevisionNumber < 1
  ) {
    issues.push(
      issue(
        surface,
        key,
        'MISSING_REVISION_NUMBER',
        'expectedPublishedRevisionNumber must be a positive integer',
      ),
    );
  }

  validateCatalogReleaseKey(issues, surface, key, record.catalogReleaseKey);

  if (record.policyVersion !== WORKOUT_ENERGY_TIMING_POLICY_VERSION) {
    issues.push(
      issue(
        surface,
        key,
        'WRONG_POLICY_VERSION',
        `policyVersion must be ${WORKOUT_ENERGY_TIMING_POLICY_VERSION}`,
      ),
    );
  }

  if (record.populationType !== 'ADULT_STANDARD_2024') {
    issues.push(
      issue(surface, key, 'UNSUPPORTED_POPULATION', 'Only ADULT_STANDARD_2024 is supported'),
    );
  }

  if (record.timingMethod !== 'SECONDS_PER_REP') {
    issues.push(
      issue(surface, key, 'UNSUPPORTED_TIMING_METHOD', 'timingMethod must be SECONDS_PER_REP'),
    );
  }

  if (
    record.secondsPerRep === null ||
    record.secondsPerRep === undefined ||
    typeof record.secondsPerRep !== 'number' ||
    !Number.isFinite(record.secondsPerRep) ||
    record.secondsPerRep <= ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE ||
    record.secondsPerRep > ENERGY_SECONDS_PER_REP_MAX
  ) {
    issues.push(
      issue(
        surface,
        key,
        'INVALID_SECONDS_PER_REP',
        `secondsPerRep must be in (${ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE}, ${ENERGY_SECONDS_PER_REP_MAX}]`,
      ),
    );
  }

  // Universal/default fallback markers are forbidden; numeric 2.5 alone is not.
  if (typeof record.sourceReference === 'string') {
    const ref = record.sourceReference.toLowerCase();
    if (
      ref.includes('universal') ||
      ref.includes('default cadence') ||
      ref.includes('family fallback') ||
      ref.includes('name fallback') ||
      ref.includes('estimatedduration')
    ) {
      issues.push(
        issue(
          surface,
          key,
          'UNIVERSAL_TIMING_MARKER',
          'universal/default/family/name/estimated-duration timing markers are forbidden',
        ),
      );
    }
  }

  if (record.sourceType === 'COMPENDIUM_ADULT_2024') {
    issues.push(
      issue(
        surface,
        key,
        'COMPENDIUM_TIMING_ATTRIBUTION_FORBIDDEN',
        'timing must not be attributed to Compendium',
      ),
    );
  }

  if (
    typeof record.sourceType !== 'string' ||
    !(TIMING_SOURCE_TYPES as readonly string[]).includes(record.sourceType)
  ) {
    issues.push(
      issue(
        surface,
        key,
        'INVALID_SOURCE_TYPE',
        `sourceType must be one of ${TIMING_SOURCE_TYPES.join('|')}`,
      ),
    );
  }

  if (!(TIMING_EVIDENCE_CLASSES as readonly string[]).includes(String(record.evidenceClass))) {
    issues.push(
      issue(
        surface,
        key,
        'UNSUPPORTED_EVIDENCE_CLASS',
        `evidenceClass must be one of ${TIMING_EVIDENCE_CLASSES.join('|')}`,
      ),
    );
  }

  validateCanonicalProductionStatus(issues, surface, key, record.status);
  validateReviewedAt(issues, surface, key, record.reviewedAt);

  if (!issues.some((i) => i.level === 'error')) {
    try {
      const expected = computeTimingContentChecksum(record as unknown as TimingContentEntry);
      if (record.checksum !== expected) {
        issues.push(
          issue(surface, key, 'CHECKSUM_MISMATCH', 'checksum does not match canonical content'),
        );
      }
    } catch {
      issues.push(
        issue(
          surface,
          key,
          'CHECKSUM_INPUT_INVALID',
          'checksum cannot be computed for structurally invalid input',
        ),
      );
    }
  }

  return issues;
}

function collectDuplicateExerciseKeys(
  entries: readonly { exerciseKey?: unknown }[],
  surface: 'energy' | 'timing',
  code: 'DUPLICATE_ENERGY_EXERCISE_KEY' | 'DUPLICATE_TIMING_EXERCISE_KEY',
): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const key = typeof entry.exerciseKey === 'string' ? entry.exerciseKey : '';
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [exerciseKey, count] of seen) {
    if (count > 1) {
      issues.push(
        issue(
          surface,
          exerciseKey,
          code,
          `exerciseKey may appear at most once per catalog release; found ${count} entries`,
        ),
      );
    }
  }
  return issues;
}

export function validateEnergyManifest(entries: unknown): ContentValidationIssue[] {
  if (!Array.isArray(entries)) {
    return [
      issue('energy', '*', 'INVALID_ENERGY_MANIFEST', 'energy manifest must be an array'),
    ];
  }
  const issues: ContentValidationIssue[] = [];
  issues.push(
    ...collectDuplicateExerciseKeys(
      entries as readonly { exerciseKey?: unknown }[],
      'energy',
      'DUPLICATE_ENERGY_EXERCISE_KEY',
    ),
  );
  for (const entry of entries) {
    issues.push(...validateEnergyContentEntry(entry));
  }
  return issues;
}

export function validateTimingManifest(entries: unknown): ContentValidationIssue[] {
  if (!Array.isArray(entries)) {
    return [
      issue('timing', '*', 'INVALID_TIMING_MANIFEST', 'timing manifest must be an array'),
    ];
  }
  const issues: ContentValidationIssue[] = [];
  issues.push(
    ...collectDuplicateExerciseKeys(
      entries as readonly { exerciseKey?: unknown }[],
      'timing',
      'DUPLICATE_TIMING_EXERCISE_KEY',
    ),
  );
  for (const entry of entries) {
    issues.push(...validateTimingContentEntry(entry));
  }
  return issues;
}
