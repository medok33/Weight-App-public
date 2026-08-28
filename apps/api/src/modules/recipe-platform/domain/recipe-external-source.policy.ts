/** RP2-04A STEP_213 — Recipe External Source rights / collection / execution policies */

export const RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION = 'recipe-source-adapter/v1' as const;

export type RecipeSourceRightsStatus =
  | 'ACTIVE_LICENSED'
  | 'PUBLIC_RESEARCH_ALLOWED'
  | 'MANUAL_RESEARCH_ONLY'
  | 'SUSPENDED'
  | 'DISABLED_BY_TERMS'
  | 'DISABLED_BY_REFUSAL'
  | 'PENDING_REVIEW';

export type RecipeSourceCollectionMode =
  | 'API'
  | 'LICENSED_FEED'
  | 'PUBLIC_FEED'
  | 'CONTROLLED_HTML_RESEARCH'
  | 'MANUAL_ENTRY'
  | 'MANUAL_REFERENCE_ONLY'
  | 'DISABLED';

export type RecipeSourceHealthStatus =
  | 'UNKNOWN'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'CONFIGURATION_ERROR'
  | 'CIRCUIT_OPEN';

export type RecipeSourceEvidenceType =
  | 'CONTRACT'
  | 'LICENSE'
  | 'TERMS_REVIEW'
  | 'EMAIL_PERMISSION'
  | 'PUBLICATION_POLICY'
  | 'OWNER_DECISION'
  | 'REFUSAL'
  | 'LEGAL_REVIEW';

export type RecipeSourceEvidenceDecision = 'ALLOW' | 'DENY' | 'CONDITIONAL' | 'REVIEW_REQUIRED';

export type RecipeSourceExecutionEligibility =
  | 'AUTOMATED_ALLOWED'
  | 'MANUAL_ONLY'
  | 'TEMPORARILY_SUSPENDED'
  | 'RIGHTS_BLOCKED'
  | 'CONFIGURATION_BLOCKED'
  | 'RATE_LIMIT_BLOCKED'
  | 'HEALTH_BLOCKED';

export type RecipeSourceAdapterTypeAllowlist =
  | 'NOT_CONFIGURED'
  | 'TEST_DETERMINISTIC'
  | 'FOOD_RU'
  | 'IAMCOOK'
  | 'RUSSIANFOOD'
  | 'EDA'
  | 'MENU1000';

export const RECIPE_SOURCE_ADAPTER_TYPE_ALLOWLIST: readonly RecipeSourceAdapterTypeAllowlist[] = [
  'NOT_CONFIGURED',
  'TEST_DETERMINISTIC',
  'FOOD_RU',
  'IAMCOOK',
  'RUSSIANFOOD',
  'EDA',
  'MENU1000',
] as const;

export const FIXTURE_CAPABLE_ADAPTER_TYPES: readonly RecipeSourceAdapterTypeAllowlist[] = [
  'TEST_DETERMINISTIC',
  'FOOD_RU',
  'IAMCOOK',
  'RUSSIANFOOD',
] as const;

/** STEP_316 — one fail-closed, source-independent policy contract. */
export type RecipeSourcePolicyState = 'ALLOWED' | 'RESTRICTED' | 'PENDING_REVIEW' | 'DISABLED' | 'UNKNOWN';
export type RecipeSourceFieldClass =
  | 'SOURCE_IDENTITY'
  | 'SOURCE_URL'
  | 'CAPTURE_METADATA'
  | 'RAW_CANDIDATE_PAYLOAD'
  | 'NORMALIZED_FACTS'
  | 'SOURCE_PROSE'
  | 'SOURCE_NUTRITION';
export type RecipeSourceLiveAccessPolicy = 'ALLOW' | 'DENY';

export type RecipeSourcePolicyContract = {
  sourceCode: string;
  state: RecipeSourcePolicyState;
  enabled: boolean;
  rightsStatus: RecipeSourceRightsStatus;
  collectionMode: RecipeSourceCollectionMode;
  adapterType: RecipeSourceAdapterTypeAllowlist;
  allowedFields: Readonly<Record<RecipeSourceFieldClass, 'SHORT_LIVED_RAW' | 'LONG_LIVED_NORMALIZED_FACT' | 'METADATA_ONLY' | 'DENIED'>>;
  retentionPolicy: {
    rawSnapshot: 'TEST_FIXTURE_7_DAYS' | 'LIMITED_RESEARCH_7_DAYS' | 'METADATA_ONLY_AFTER_EXPIRY';
    normalizedFacts: 'RETAIN_WITH_PROVENANCE';
  };
  liveAccessPolicy: RecipeSourceLiveAccessPolicy;
  researchOnly: true;
  directPublicationAllowed: false;
};

const RESEARCH_FIELD_POLICY: RecipeSourcePolicyContract['allowedFields'] = {
  SOURCE_IDENTITY: 'LONG_LIVED_NORMALIZED_FACT',
  SOURCE_URL: 'LONG_LIVED_NORMALIZED_FACT',
  CAPTURE_METADATA: 'LONG_LIVED_NORMALIZED_FACT',
  RAW_CANDIDATE_PAYLOAD: 'SHORT_LIVED_RAW',
  NORMALIZED_FACTS: 'LONG_LIVED_NORMALIZED_FACT',
  SOURCE_PROSE: 'DENIED',
  SOURCE_NUTRITION: 'METADATA_ONLY',
};

const REGISTERED_RESEARCH_SOURCE_CODES = new Set(['food_ru', 'iamcook', 'russianfood']);

/**
 * Resolve policy without trusting adapter-provided permissions. Unknown sources
 * are deliberately returned as UNKNOWN/DENY rather than being inferred from a
 * hostname or adapter type.
 */
export function resolveRecipeSourcePolicy(sourceCode: string | null | undefined): RecipeSourcePolicyContract {
  const code = String(sourceCode ?? '').trim().toLowerCase();
  const registered = REGISTERED_RESEARCH_SOURCE_CODES.has(code);
  return {
    sourceCode: code || 'unknown',
    state: registered ? 'PENDING_REVIEW' : 'UNKNOWN',
    enabled: false,
    rightsStatus: registered ? 'PENDING_REVIEW' : 'PENDING_REVIEW',
    collectionMode: 'DISABLED',
    adapterType: 'NOT_CONFIGURED',
    allowedFields: RESEARCH_FIELD_POLICY,
    retentionPolicy: {
      rawSnapshot: registered ? 'LIMITED_RESEARCH_7_DAYS' : 'TEST_FIXTURE_7_DAYS',
      normalizedFacts: 'RETAIN_WITH_PROVENANCE',
    },
    liveAccessPolicy: 'DENY',
    researchOnly: true,
    directPublicationAllowed: false,
  };
}

export function assertRecipeSourceLiveAllowed(policy: RecipeSourcePolicyContract): void {
  if (
    policy.state !== 'ALLOWED' ||
    !policy.enabled ||
    policy.liveAccessPolicy !== 'ALLOW' ||
    !AUTOMATABLE_RIGHTS.includes(policy.rightsStatus) ||
    policy.collectionMode === 'DISABLED' ||
    policy.adapterType === 'NOT_CONFIGURED'
  ) {
    throw new Error('RECIPE_SOURCE_POLICY_LIVE_DENIED');
  }
}

export function assertRecipeSourceDirectPublicationDenied(policy: RecipeSourcePolicyContract): void {
  if (policy.directPublicationAllowed !== false || policy.researchOnly !== true) {
    throw new Error('RECIPE_SOURCE_DIRECT_PUBLICATION_POLICY_INVALID');
  }
  throw new Error('RECIPE_SOURCE_DIRECT_PUBLICATION_DENIED');
}

const RIGHTS: ReadonlySet<string> = new Set([
  'ACTIVE_LICENSED',
  'PUBLIC_RESEARCH_ALLOWED',
  'MANUAL_RESEARCH_ONLY',
  'SUSPENDED',
  'DISABLED_BY_TERMS',
  'DISABLED_BY_REFUSAL',
  'PENDING_REVIEW',
]);

const MODES: ReadonlySet<string> = new Set([
  'API',
  'LICENSED_FEED',
  'PUBLIC_FEED',
  'CONTROLLED_HTML_RESEARCH',
  'MANUAL_ENTRY',
  'MANUAL_REFERENCE_ONLY',
  'DISABLED',
]);

/** Rights that may automate HTTP/adapter execution when enabled + configured. */
export const AUTOMATABLE_RIGHTS: readonly RecipeSourceRightsStatus[] = [
  'ACTIVE_LICENSED',
  'PUBLIC_RESEARCH_ALLOWED',
];

/** Collection modes that imply HTTP/network adapter work. */
export const NETWORK_COLLECTION_MODES: readonly RecipeSourceCollectionMode[] = [
  'API',
  'LICENSED_FEED',
  'PUBLIC_FEED',
  'CONTROLLED_HTML_RESEARCH',
];

export const MANUAL_COLLECTION_MODES: readonly RecipeSourceCollectionMode[] = [
  'MANUAL_ENTRY',
  'MANUAL_REFERENCE_ONLY',
];

export function isRecipeSourceRightsStatus(value: unknown): value is RecipeSourceRightsStatus {
  return typeof value === 'string' && RIGHTS.has(value);
}

export function isRecipeSourceCollectionMode(value: unknown): value is RecipeSourceCollectionMode {
  return typeof value === 'string' && MODES.has(value);
}

export function isAllowedAdapterType(value: unknown): value is RecipeSourceAdapterTypeAllowlist {
  return (
    typeof value === 'string' &&
    (RECIPE_SOURCE_ADAPTER_TYPE_ALLOWLIST as readonly string[]).includes(value)
  );
}

/**
 * Allowed rights transitions. DISABLED_BY_* restore requires OWNER + new evidence (enforced in service).
 */
const TRANSITIONS: Record<RecipeSourceRightsStatus, readonly RecipeSourceRightsStatus[]> = {
  PENDING_REVIEW: [
    'ACTIVE_LICENSED',
    'PUBLIC_RESEARCH_ALLOWED',
    'MANUAL_RESEARCH_ONLY',
    'SUSPENDED',
    'DISABLED_BY_TERMS',
    'DISABLED_BY_REFUSAL',
  ],
  ACTIVE_LICENSED: ['SUSPENDED', 'DISABLED_BY_TERMS', 'DISABLED_BY_REFUSAL', 'MANUAL_RESEARCH_ONLY'],
  PUBLIC_RESEARCH_ALLOWED: [
    'SUSPENDED',
    'DISABLED_BY_TERMS',
    'DISABLED_BY_REFUSAL',
    'MANUAL_RESEARCH_ONLY',
    'ACTIVE_LICENSED',
  ],
  MANUAL_RESEARCH_ONLY: [
    'SUSPENDED',
    'DISABLED_BY_TERMS',
    'DISABLED_BY_REFUSAL',
    'PENDING_REVIEW',
    'PUBLIC_RESEARCH_ALLOWED',
  ],
  SUSPENDED: [
    'ACTIVE_LICENSED',
    'PUBLIC_RESEARCH_ALLOWED',
    'MANUAL_RESEARCH_ONLY',
    'DISABLED_BY_TERMS',
    'DISABLED_BY_REFUSAL',
  ],
  DISABLED_BY_TERMS: ['PENDING_REVIEW', 'MANUAL_RESEARCH_ONLY'],
  DISABLED_BY_REFUSAL: ['PENDING_REVIEW', 'MANUAL_RESEARCH_ONLY'],
};

export function assertRightsTransition(
  from: RecipeSourceRightsStatus,
  to: RecipeSourceRightsStatus,
): void {
  if (from === to) return;
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error('RECIPE_SOURCE_RIGHTS_TRANSITION_INVALID');
  }
}

export function listAllowedRightsTransitions(
  from: RecipeSourceRightsStatus,
): RecipeSourceRightsStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/** HTML research requires ACTIVE_LICENSED or PUBLIC_RESEARCH_ALLOWED — never robots.txt alone. */
export function assertCollectionModeAllowedForRights(
  rightsStatus: RecipeSourceRightsStatus,
  collectionMode: RecipeSourceCollectionMode,
): void {
  if (collectionMode === 'DISABLED') return;
  if (MANUAL_COLLECTION_MODES.includes(collectionMode)) {
    if (rightsStatus === 'DISABLED_BY_TERMS' || rightsStatus === 'DISABLED_BY_REFUSAL') {
      throw new Error('RECIPE_SOURCE_COLLECTION_MODE_BLOCKED');
    }
    return;
  }
  if (collectionMode === 'CONTROLLED_HTML_RESEARCH') {
    if (!AUTOMATABLE_RIGHTS.includes(rightsStatus)) {
      throw new Error('RECIPE_SOURCE_HTML_RESEARCH_RIGHTS_REQUIRED');
    }
    return;
  }
  if (NETWORK_COLLECTION_MODES.includes(collectionMode)) {
    if (!AUTOMATABLE_RIGHTS.includes(rightsStatus)) {
      throw new Error('RECIPE_SOURCE_COLLECTION_MODE_BLOCKED');
    }
  }
}

export function canEnableSource(input: {
  rightsStatus: RecipeSourceRightsStatus;
  collectionMode: RecipeSourceCollectionMode;
  adapterType: string;
  reviewExpiresAt: Date | string | null | undefined;
  now?: Date;
}): { ok: boolean; reason: string | null } {
  if (!AUTOMATABLE_RIGHTS.includes(input.rightsStatus)) {
    return { ok: false, reason: 'RIGHTS_BLOCKED' };
  }
  if (input.collectionMode === 'DISABLED' || MANUAL_COLLECTION_MODES.includes(input.collectionMode)) {
    return { ok: false, reason: 'CONFIGURATION_BLOCKED' };
  }
  // Enable is a policy switch; adapter may still be NOT_CONFIGURED (execution remains blocked).
  if (input.adapterType && !isAllowedAdapterType(input.adapterType)) {
    return { ok: false, reason: 'CONFIGURATION_BLOCKED' };
  }
  if (input.reviewExpiresAt) {
    const exp = new Date(input.reviewExpiresAt);
    if (Number.isFinite(exp.getTime()) && exp.getTime() <= (input.now ?? new Date()).getTime()) {
      return { ok: false, reason: 'RIGHTS_BLOCKED' };
    }
  }
  return { ok: true, reason: null };
}

export type SourceExecutionInput = {
  enabled: boolean;
  rightsStatus: RecipeSourceRightsStatus | string;
  collectionMode: RecipeSourceCollectionMode | string;
  adapterType: string;
  healthStatus: RecipeSourceHealthStatus | string;
  rateLimitPerMinute: number;
  reviewExpiresAt?: Date | string | null;
  dataClass?: string | null;
  now?: Date;
};

export function evaluateSourceExecutionEligibility(
  input: SourceExecutionInput,
): {
  eligibility: RecipeSourceExecutionEligibility;
  reason: string;
  automatedAllowed: boolean;
} {
  const rights = String(input.rightsStatus) as RecipeSourceRightsStatus;
  const mode = String(input.collectionMode) as RecipeSourceCollectionMode;
  const health = String(input.healthStatus);

  if (rights === 'SUSPENDED') {
    return {
      eligibility: 'TEMPORARILY_SUSPENDED',
      reason: 'SOURCE_SUSPENDED',
      automatedAllowed: false,
    };
  }
  if (
    rights === 'PENDING_REVIEW' ||
    rights === 'DISABLED_BY_TERMS' ||
    rights === 'DISABLED_BY_REFUSAL'
  ) {
    return { eligibility: 'RIGHTS_BLOCKED', reason: rights, automatedAllowed: false };
  }
  if (rights === 'MANUAL_RESEARCH_ONLY' || MANUAL_COLLECTION_MODES.includes(mode)) {
    return {
      eligibility: 'MANUAL_ONLY',
      reason: 'MANUAL_RESEARCH_ONLY',
      automatedAllowed: false,
    };
  }
  if (!input.enabled) {
    return {
      eligibility: 'CONFIGURATION_BLOCKED',
      reason: 'SOURCE_DISABLED',
      automatedAllowed: false,
    };
  }
  if (input.reviewExpiresAt) {
    const exp = new Date(input.reviewExpiresAt);
    if (Number.isFinite(exp.getTime()) && exp.getTime() <= (input.now ?? new Date()).getTime()) {
      return {
        eligibility: 'RIGHTS_BLOCKED',
        reason: 'POLICY_REVIEW_EXPIRED',
        automatedAllowed: false,
      };
    }
  }
  if (!isAllowedAdapterType(input.adapterType) || input.adapterType === 'NOT_CONFIGURED') {
    return {
      eligibility: 'CONFIGURATION_BLOCKED',
      reason: 'ADAPTER_NOT_CONFIGURED',
      automatedAllowed: false,
    };
  }
  if (mode === 'DISABLED' || !NETWORK_COLLECTION_MODES.includes(mode)) {
    return {
      eligibility: 'CONFIGURATION_BLOCKED',
      reason: 'COLLECTION_MODE_DISABLED',
      automatedAllowed: false,
    };
  }
  try {
    assertCollectionModeAllowedForRights(rights, mode);
  } catch {
    return {
      eligibility: 'RIGHTS_BLOCKED',
      reason: 'COLLECTION_MODE_BLOCKED',
      automatedAllowed: false,
    };
  }
  if (Number(input.rateLimitPerMinute) <= 0) {
    return {
      eligibility: 'RATE_LIMIT_BLOCKED',
      reason: 'RATE_LIMIT_ZERO',
      automatedAllowed: false,
    };
  }
  if (health === 'CIRCUIT_OPEN' || health === 'UNHEALTHY' || health === 'CONFIGURATION_ERROR') {
    return {
      eligibility: 'HEALTH_BLOCKED',
      reason: health,
      automatedAllowed: false,
    };
  }
  if (input.adapterType === 'TEST_DETERMINISTIC' && input.dataClass === 'PRODUCTION') {
    return {
      eligibility: 'CONFIGURATION_BLOCKED',
      reason: 'TEST_ADAPTER_PRODUCTION_FORBIDDEN',
      automatedAllowed: false,
    };
  }
  return {
    eligibility: 'AUTOMATED_ALLOWED',
    reason: 'OK',
    automatedAllowed: true,
  };
}

export function minimumEvidenceForRights(target: RecipeSourceRightsStatus): RecipeSourceEvidenceType[] {
  switch (target) {
    case 'ACTIVE_LICENSED':
      return ['CONTRACT', 'LICENSE', 'LEGAL_REVIEW'];
    case 'PUBLIC_RESEARCH_ALLOWED':
      return ['OWNER_DECISION', 'TERMS_REVIEW', 'PUBLICATION_POLICY'];
    case 'MANUAL_RESEARCH_ONLY':
      return ['OWNER_DECISION'];
    case 'DISABLED_BY_TERMS':
      return ['TERMS_REVIEW', 'OWNER_DECISION'];
    case 'DISABLED_BY_REFUSAL':
      return ['REFUSAL', 'OWNER_DECISION'];
    case 'SUSPENDED':
      return ['OWNER_DECISION'];
    default:
      return [];
  }
}

export function rightsStatusLabelRu(status: string): string {
  switch (status) {
    case 'ACTIVE_LICENSED':
      return 'Лицензированный источник';
    case 'PUBLIC_RESEARCH_ALLOWED':
      return 'Разрешено ограниченное исследование';
    case 'MANUAL_RESEARCH_ONLY':
      return 'Только ручное исследование';
    case 'SUSPENDED':
      return 'Временно приостановлен';
    case 'DISABLED_BY_TERMS':
      return 'Отключён из-за условий использования';
    case 'DISABLED_BY_REFUSAL':
      return 'Отключён после отказа';
    case 'PENDING_REVIEW':
      return 'Ожидает проверки';
    default:
      return status;
  }
}
