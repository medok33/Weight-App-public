/**
 * WORKOUT-ENERGY-CONTENT-01A — canonical content contracts.
 * Repository content ≠ runtime-applied DB rows.
 */

export const WORKOUT_ENERGY_CONTENT_POLICY_VERSION = 'workout-energy-content-1.0' as const;
export const WORKOUT_ENERGY_CONTENT_REPORT_VERSION = 'workout-energy-content-report-1.0' as const;
export const WORKOUT_ENERGY_CATALOG_RELEASE_KEY = 'workout-catalog-canonical-01b' as const;

export const ENERGY_MAPPING_CLASSES = [
  'DIRECT_MAPPING_DEFENSIBLE',
  'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
] as const;
export type EnergyMappingClass = (typeof ENERGY_MAPPING_CLASSES)[number];

export const TIMING_EVIDENCE_CLASSES = [
  'PRIMARY_RESEARCH_SOURCE',
  'OFFICIAL_TRAINING_STANDARD',
  'MANUFACTURER_PROTOCOL',
  'INTERNAL_REVIEWED_TEMPO_POLICY',
] as const;
export type TimingEvidenceClass = (typeof TIMING_EVIDENCE_CLASSES)[number];

export const CONTENT_ENTRY_STATUSES = ['DRAFT', 'APPROVED', 'RETIRED'] as const;
export type ContentEntryStatus = (typeof CONTENT_ENTRY_STATUSES)[number];

export const COVERAGE_DISPOSITIONS = [
  'AVAILABLE_DURATION',
  'AVAILABLE_REPS',
  'MISSING_ENERGY_PROFILE',
  'MISSING_TIMING_PROFILE',
  'INVALID_ENERGY_MAPPING',
  'INVALID_TIMING_MAPPING',
  'REVISION_PIN_MISMATCH',
  'MISSING_REVISION_PIN',
  'AMBIGUOUS_REVISION_PIN',
  'INVALID_PINNED_REVISION',
  'WRONG_RELEASE',
  'UNSUPPORTED_REPS_OR_DURATION',
  'PRODUCT_MODE_REVISION_REQUIRED',
  'NOT_GENERATOR_VISIBLE',
  'CONDITIONAL_GENERATOR_VISIBLE',
  'NO_DEFENSIBLE_MAPPING',
] as const;
export type CoverageDisposition = (typeof COVERAGE_DISPOSITIONS)[number];

export type CanonicalContentIdentity = {
  exerciseKey: string;
  expectedPublishedRevisionNumber: number;
  catalogReleaseKey: string;
  policyVersion: string;
  populationType: string;
  contentVersion: string;
};

export type EnergyContentEntry = CanonicalContentIdentity & {
  calculationMethod: 'MET_DURATION';
  populationType: 'ADULT_STANDARD_2024';
  compendiumEdition: 'ADULT_2024';
  compendiumCode: string;
  metValue: number;
  activityDescriptionEn: string;
  sourceType: 'COMPENDIUM_ADULT_2024';
  sourceReference: string;
  sourceVersion: string;
  mappingClass: EnergyMappingClass;
  rationale: string;
  limitations: string;
  reviewedBy: string;
  reviewedAt: string;
  status: ContentEntryStatus;
  checksum: string;
};

/** Explicit phase durations (seconds). Absent phases are omitted from the sum. */
export type TimingMovementPhases = {
  setupTransitionSeconds?: number;
  eccentricSeconds?: number;
  bottomTransitionSeconds?: number;
  concentricSeconds?: number;
  topTransitionSeconds?: number;
  sideTransitionSeconds?: number;
};

export type TimingContentEntry = CanonicalContentIdentity & {
  timingMethod: 'SECONDS_PER_REP';
  secondsPerRep: number;
  evidenceClass: TimingEvidenceClass;
  sourceType: 'INTERNAL_REVIEWED_POLICY' | 'PRIMARY_RESEARCH' | 'OFFICIAL_STANDARD' | 'MANUFACTURER';
  sourceReference: string;
  sourceVersion: string;
  /** INTERNAL_REVIEWED_TEMPO_POLICY methodology identity, e.g. workout-energy-timing-reviewed-v1 */
  methodologyVersion: string;
  oneRepDefinition: string;
  unilateralSemantics: string;
  /** Canonical phase map; secondsPerRep must equal the sum of present phases. */
  movementPhases: TimingMovementPhases;
  /** Deterministic serialization of movementPhases for checksum stability. */
  phaseModel: string;
  rationale: string;
  romAssumptions: string;
  techniqueAssumptions: string;
  cadenceAssumptions: string;
  limitations: string;
  reviewedBy: string;
  reviewedAt: string;
  status: ContentEntryStatus;
  checksum: string;
};

export type CoverageDispositionEntry = {
  exerciseKey: string;
  expectedPublishedRevisionNumber: number | null;
  disposition: CoverageDisposition;
  reason: string;
};

export type PublishedReleasePin = {
  exerciseKey: string;
  revisionNumber: number;
  revisionId?: string;
  repetitionMode: 'REPS' | 'DURATION' | 'REPS_OR_DURATION';
  enabledForGenerator: boolean;
  defaultDurationSeconds: number | null;
};

export type ContentValidationIssue = {
  level: 'error' | 'warning';
  /** Isolates energy vs timing vs policy vs pin/release error state. */
  surface: 'energy' | 'timing' | 'policy' | 'pin';
  code: string;
  exerciseKey: string;
  message: string;
};

export type ContentCoveragePinResult = {
  exerciseKey: string;
  revisionNumber: number;
  revisionId: string | null;
  repetitionMode: PublishedReleasePin['repetitionMode'];
  enabledForGenerator: boolean;
  energyDisposition: CoverageDisposition;
  timingDisposition: CoverageDisposition | 'NOT_REQUIRED';
  expectedEstimateStatus: string;
  blockerCodes: string[];
};

export type ContentCoverageReport = {
  reportVersion: string;
  generatedFromCommit: string | null;
  catalogRelease: string;
  policyVersion: string;
  totalPins: number;
  generatorVisible: number;
  modeCounts: {
    REPS: number;
    DURATION: number;
    REPS_OR_DURATION: number;
  };
  repositoryEnergyMappings: number;
  repositoryTimingMappings: number;
  validEnergyMappings: number;
  validTimingMappings: number;
  availableDuration: number;
  availableReps: number;
  missingEnergy: number;
  missingTiming: number;
  unsupportedMode: number;
  pinMismatches: number;
  evidenceErrors: number;
  coveragePercent: number;
  fullCoverageSatisfied: boolean;
  contentCoverageIncomplete: boolean;
  workoutV2_01fStatus: 'WORKOUT-V2-01F_BLOCKED_BY_ENERGY_CONTENT';
  runtimeEnergyAfterMigrationOnly: 0;
  runtimeTimingAfterMigrationOnly: 0;
  entries: ContentCoveragePinResult[];
  issues: ContentValidationIssue[];
};
