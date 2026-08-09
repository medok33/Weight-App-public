/** RP2-04A STEP_214 — Recipe Source Adapter typed contract (transport only). */

import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from './recipe-external-source.policy';

export type RecipeSourceSearchInput = {
  coverageSlotId?: string | null;
  primaryProductIds: string[];
  mealType?: string | null;
  dishType?: string | null;
  cookingMethods?: string[];
  dietaryProfile?: Record<string, unknown> | null;
  maximumTimeMinutes?: number | null;
  locale: string;
  resultLimit: number;
  cursor?: string | null;
  correlationId: string;
};

export type SourceRecipeCard = {
  sourceCode: string;
  externalId: string;
  sourceUrl: string;
  title: string;
  shortDescription: string | null;
  imageReference: string | null;
  estimatedTimeMinutes: number | null;
  servings: number | null;
  visibleIngredientNames: string[];
  sourceCategories: string[];
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  fetchedAt: string;
  parserVersion: string;
  confidence: number;
  rawReferenceHash: string | null;
};

export type SourceRecipeIngredient = {
  name: string;
  amountText: string | null;
  unitText: string | null;
  notes: string | null;
};

export type SourceRecipeStep = {
  ordinal: number;
  text: string;
  timeMinutes: number | null;
};

export type SourceRecipeCandidatePayload = {
  sourceCode: string;
  externalId: string;
  sourceUrl: string;
  canonicalSourceUrl?: string | null;
  title: string;
  description: string | null;
  ingredients: SourceRecipeIngredient[];
  steps: SourceRecipeStep[];
  servings: number | null;
  preparationTime: number | null;
  cookingTime: number | null;
  totalTime?: number | null;
  temperatures: string[];
  cookingMethods: string[];
  sourceNutrition: Record<string, unknown> | null;
  categories: string[];
  mediaReferences: string[];
  availabilityStatus?: RecipeSourceAvailabilityStatus;
  fetchedAt: string;
  parserVersion: string;
  contractVersion?: string;
  completeness: 'FULL' | 'PARTIAL' | 'MINIMAL';
  warnings: string[];
  payloadChecksum?: string;
  identityChecksum?: string;
};

export type RecipeSourceAvailabilityStatus =
  | 'AVAILABLE'
  | 'NOT_FOUND'
  | 'REMOVED'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'PARSER_INCOMPATIBLE'
  | 'POLICY_BLOCKED'
  | 'LIVE_EXECUTION_DISABLED'
  | 'UNKNOWN';

export type SourceAvailabilityResult = {
  sourceCode: string;
  externalId: string;
  available: boolean;
  availabilityStatus: RecipeSourceAvailabilityStatus;
  reason: string | null;
  checkedAt: string;
  parserVersion: string;
  correlationId: string;
  networkCalls: number;
};

export type SourceAdapterHealthResult = {
  adapterType: string;
  contractVersion: string;
  parserVersion: string;
  ok: boolean;
  status: 'HEALTHY' | 'CONFIGURATION_ERROR' | 'UNSUPPORTED';
  details: string;
  checkedAt: string;
};

export type RecipeSourceExecutionContext = {
  sourceId: string;
  sourceCode: string;
  adapterType: string;
  parserVersion: string;
  collectionMode: string;
  correlationId: string;
  actorUserId: string | null;
  /** Never contains secrets; headers must not be USER-supplied. */
  allowlistedHostnames: string[];
  requestTimeoutMs: number;
  rateLimitPerMinute: number;
  /** When true, only TEST_DETERMINISTIC may run. */
  testMode: boolean;
};

export type RecipeSourceAdapterDescriptor = {
  adapterType: string;
  contractVersion: typeof RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION | string;
  parserVersion: string;
  supportedOperations: readonly ('searchByProducts' | 'fetchCandidate' | 'checkAvailability' | 'healthCheck')[];
  collectionModes: readonly string[];
  supportedLocales: readonly string[];
  supportedSourceCodes?: readonly string[];
};

export interface RecipeSourceAdapter {
  readonly adapterType: string;
  readonly contractVersion: string;
  readonly parserVersion: string;
  readonly descriptor: RecipeSourceAdapterDescriptor;
  searchByProducts(
    input: RecipeSourceSearchInput,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCard[]>;
  fetchCandidate(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCandidatePayload>;
  checkAvailability(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceAvailabilityResult>;
  healthCheck?(context: RecipeSourceExecutionContext): Promise<SourceAdapterHealthResult>;
}

export type RecipeSourceAdapterErrorCode =
  | 'SOURCE_DISABLED'
  | 'RIGHTS_BLOCKED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'PARSE_ERROR'
  | 'CONTRACT_MISMATCH'
  | 'SOURCE_CHANGED'
  | 'ROBOTS_OR_POLICY_BLOCKED'
  | 'UNSUPPORTED_OPERATION'
  | 'CONFIGURATION_ERROR'
  | 'LIVE_EXECUTION_DISABLED'
  | 'POLICY_BLOCKED'
  | 'PARSER_INCOMPATIBLE'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'REDIRECT_FORBIDDEN';

export class RecipeSourceAdapterError extends Error {
  readonly code: RecipeSourceAdapterErrorCode;
  readonly sourceCode: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly safeMessage: string;
  readonly correlationId: string;
  readonly parserVersion: string;

  constructor(input: {
    code: RecipeSourceAdapterErrorCode;
    sourceCode: string;
    operation: string;
    retryable: boolean;
    safeMessage: string;
    correlationId: string;
    parserVersion: string;
  }) {
    super(input.code);
    this.name = 'RecipeSourceAdapterError';
    this.code = input.code;
    this.sourceCode = input.sourceCode;
    this.operation = input.operation;
    this.retryable = input.retryable;
    this.safeMessage = input.safeMessage;
    this.correlationId = input.correlationId;
    this.parserVersion = input.parserVersion;
  }

  toPublic() {
    return {
      code: this.code,
      sourceCode: this.sourceCode,
      operation: this.operation,
      retryable: this.retryable,
      message: this.safeMessage,
      correlationId: this.correlationId,
      parserVersion: this.parserVersion,
    };
  }
}

export function assertSearchInput(input: RecipeSourceSearchInput): void {
  if (!input?.correlationId?.trim()) throw new Error('RECIPE_SOURCE_CORRELATION_REQUIRED');
  if (!Array.isArray(input.primaryProductIds)) throw new Error('RECIPE_SOURCE_SEARCH_INPUT_INVALID');
  if (!input.locale?.trim()) throw new Error('RECIPE_SOURCE_SEARCH_INPUT_INVALID');
  const limit = Number(input.resultLimit);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
    throw new Error('RECIPE_SOURCE_SEARCH_INPUT_INVALID');
  }
}

/** Reject mass-assignment / client-controlled security fields on adapter invocation bodies. */
export function assertNoClientControlledSourceFields(body: Record<string, unknown> | null | undefined): void {
  if (!body) return;
  const forbidden = [
    'rightsStatus',
    'enabled',
    'reviewedBy',
    'reviewedAt',
    'healthStatus',
    'adapterModule',
    'adapterClass',
    'modulePath',
    'headers',
    'authorization',
    'cookies',
    'ssrfBypass',
    'allowPrivateNetwork',
    'disableRateLimit',
    'disableSsrf',
  ];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new Error('RECIPE_SOURCE_CLIENT_FIELD_FORBIDDEN');
    }
  }
}
