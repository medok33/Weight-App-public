import { describe, expect, it } from 'vitest';
import {
  assertCollectionModeAllowedForRights,
  assertRightsTransition,
  canEnableSource,
  evaluateSourceExecutionEligibility,
  listAllowedRightsTransitions,
  RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
} from '../domain/recipe-external-source.policy';
import {
  assertNoClientControlledSourceFields,
  RecipeSourceAdapterError,
} from '../domain/recipe-source-adapter.contract';
import {
  assertHostnameAllowlisted,
  assertRedirectHostnameAllowed,
  normalizeAndValidateSourceBaseUrl,
  RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT,
} from '../domain/recipe-source-network.policy';
import { RecipeSourceAdapterRegistry } from '../application/recipe-source-adapter.registry';
import { TestRecipeSourceAdapter } from '../application/test-recipe-source.adapter';

describe('RP2-04A recipe external source policy (STEP_213)', () => {
  it('allows controlled rights transitions and rejects invalid restore', () => {
    expect(() => assertRightsTransition('PENDING_REVIEW', 'PUBLIC_RESEARCH_ALLOWED')).not.toThrow();
    expect(() => assertRightsTransition('PUBLIC_RESEARCH_ALLOWED', 'SUSPENDED')).not.toThrow();
    expect(() => assertRightsTransition('ACTIVE_LICENSED', 'DISABLED_BY_TERMS')).not.toThrow();
    expect(() => assertRightsTransition('DISABLED_BY_TERMS', 'ACTIVE_LICENSED')).toThrow(
      /RECIPE_SOURCE_RIGHTS_TRANSITION_INVALID/,
    );
    expect(listAllowedRightsTransitions('DISABLED_BY_REFUSAL')).toEqual([
      'PENDING_REVIEW',
      'MANUAL_RESEARCH_ONLY',
    ]);
  });

  it('blocks HTML research without automatable rights', () => {
    expect(() =>
      assertCollectionModeAllowedForRights('PENDING_REVIEW', 'CONTROLLED_HTML_RESEARCH'),
    ).toThrow(/RECIPE_SOURCE_HTML_RESEARCH_RIGHTS_REQUIRED/);
    expect(() =>
      assertCollectionModeAllowedForRights('PUBLIC_RESEARCH_ALLOWED', 'CONTROLLED_HTML_RESEARCH'),
    ).not.toThrow();
    expect(() => assertCollectionModeAllowedForRights('PENDING_REVIEW', 'PUBLIC_FEED')).toThrow(
      /RECIPE_SOURCE_COLLECTION_MODE_BLOCKED/,
    );
  });

  it('enable requires automatable rights + non-manual mode; expired review blocks', () => {
    expect(
      canEnableSource({
        rightsStatus: 'PENDING_REVIEW',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'NOT_CONFIGURED',
        reviewExpiresAt: null,
      }).ok,
    ).toBe(false);
    expect(
      canEnableSource({
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'NOT_CONFIGURED',
        reviewExpiresAt: null,
      }).ok,
    ).toBe(true);
    expect(
      canEnableSource({
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'NOT_CONFIGURED',
        reviewExpiresAt: new Date(Date.now() - 60_000),
      }).reason,
    ).toBe('RIGHTS_BLOCKED');
  });

  it('execution eligibility covers suspension, rights, rate, health, test isolation', () => {
    expect(
      evaluateSourceExecutionEligibility({
        enabled: true,
        rightsStatus: 'SUSPENDED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'TEST_DETERMINISTIC',
        healthStatus: 'HEALTHY',
        rateLimitPerMinute: 10,
        dataClass: 'TEST_ONLY',
      }).eligibility,
    ).toBe('TEMPORARILY_SUSPENDED');

    expect(
      evaluateSourceExecutionEligibility({
        enabled: true,
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'TEST_DETERMINISTIC',
        healthStatus: 'HEALTHY',
        rateLimitPerMinute: 0,
        dataClass: 'TEST_ONLY',
      }).eligibility,
    ).toBe('RATE_LIMIT_BLOCKED');

    expect(
      evaluateSourceExecutionEligibility({
        enabled: true,
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'TEST_DETERMINISTIC',
        healthStatus: 'CIRCUIT_OPEN',
        rateLimitPerMinute: 10,
        dataClass: 'TEST_ONLY',
      }).eligibility,
    ).toBe('HEALTH_BLOCKED');

    expect(
      evaluateSourceExecutionEligibility({
        enabled: true,
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'TEST_DETERMINISTIC',
        healthStatus: 'HEALTHY',
        rateLimitPerMinute: 10,
        dataClass: 'PRODUCTION',
      }).reason,
    ).toBe('TEST_ADAPTER_PRODUCTION_FORBIDDEN');

    expect(
      evaluateSourceExecutionEligibility({
        enabled: true,
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'TEST_DETERMINISTIC',
        healthStatus: 'HEALTHY',
        rateLimitPerMinute: 10,
        dataClass: 'TEST_ONLY',
        reviewExpiresAt: new Date(Date.now() - 1000),
      }).reason,
    ).toBe('POLICY_REVIEW_EXPIRED');

    expect(
      evaluateSourceExecutionEligibility({
        enabled: true,
        rightsStatus: 'PUBLIC_RESEARCH_ALLOWED',
        collectionMode: 'PUBLIC_FEED',
        adapterType: 'TEST_DETERMINISTIC',
        healthStatus: 'HEALTHY',
        rateLimitPerMinute: 10,
        dataClass: 'TEST_ONLY',
      }).eligibility,
    ).toBe('AUTOMATED_ALLOWED');
  });
});

describe('RP2-04A adapter contract + registry (STEP_214)', () => {
  it('registers unique allowlisted adapters and rejects contract mismatch', () => {
    const registry = new RecipeSourceAdapterRegistry();
    expect(registry.has('TEST_DETERMINISTIC')).toBe(true);
    expect(registry.has('FOOD_RU')).toBe(true);
    expect(registry.has('IAMCOOK')).toBe(true);
    expect(registry.has('RUSSIANFOOD')).toBe(true);
    expect(registry.isAllowlistedType('NOT_CONFIGURED')).toBe(true);
    expect(registry.isAllowlistedType('FOOD_RU')).toBe(true);
    expect(registry.isAllowlistedType('IAMCOOK')).toBe(true);
    expect(registry.isAllowlistedType('RUSSIANFOOD')).toBe(true);
    expect(registry.isAllowlistedType('FoodRuAdapter')).toBe(false);
    expect(() => registry.register(new TestRecipeSourceAdapter())).toThrow(
      /RECIPE_SOURCE_ADAPTER_TYPE_DUPLICATE/,
    );
    expect(() =>
      registry.register({
        adapterType: 'BAD',
        contractVersion: 'recipe-source-adapter/v0',
        parserVersion: 'x',
        descriptor: {
          adapterType: 'BAD',
          contractVersion: 'v0',
          parserVersion: 'x',
          supportedOperations: [],
          collectionModes: [],
          supportedLocales: [],
        },
        searchByProducts: async () => [],
        fetchCandidate: async () => {
          throw new Error('no');
        },
        checkAvailability: async () => {
          throw new Error('no');
        },
      }),
    ).toThrow(/RECIPE_SOURCE_ADAPTER_CONTRACT_MISMATCH/);
  });

  it('test adapter returns deterministic transport payloads without network', async () => {
    const adapter = new TestRecipeSourceAdapter();
    expect(adapter.contractVersion).toBe(RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION);
    const context = {
      sourceId: 's1',
      sourceCode: 'test_fixture_source',
      adapterType: 'TEST_DETERMINISTIC',
      parserVersion: adapter.parserVersion,
      collectionMode: 'API',
      correlationId: 'corr-1',
      actorUserId: 'u1',
      allowlistedHostnames: ['example.com'],
      requestTimeoutMs: 1000,
      rateLimitPerMinute: 10,
      testMode: true,
    };
    const cards = await adapter.searchByProducts(
      {
        primaryProductIds: ['p1'],
        locale: 'ru',
        resultLimit: 2,
        correlationId: 'corr-1',
      },
      context,
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]?.parserVersion).toBe('test-parser/v1');
    expect(cards[0]?.sourceCode).toBe('test_fixture_source');
    expect(cards[0]?.title).toBeTruthy();

    const candidate = await adapter.fetchCandidate('test-card-1', context);
    expect(candidate.ingredients.length).toBeGreaterThan(0);
    expect(candidate.steps.length).toBeGreaterThan(0);
    expect(candidate.warnings).toContain('TRANSPORT_ONLY_NOT_STAGED');
    expect(candidate.parserVersion).toBe(adapter.parserVersion);

    const availability = await adapter.checkAvailability('test-card-1', context);
    expect(availability.available).toBe(true);
    expect(availability.correlationId).toBe('corr-1');

    const health = await adapter.healthCheck(context);
    expect(health.ok).toBe(true);
    expect(health.status).toBe('HEALTHY');
    expect(health.details).toMatch(/no network/i);
  });

  it('maps typed errors without stack traces', () => {
    const err = new RecipeSourceAdapterError({
      code: 'RIGHTS_BLOCKED',
      sourceCode: 'food_ru',
      operation: 'searchByProducts',
      retryable: false,
      safeMessage: 'Rights blocked',
      correlationId: 'c1',
      parserVersion: 'none',
    });
    const pub = err.toPublic();
    expect(pub).toEqual({
      code: 'RIGHTS_BLOCKED',
      sourceCode: 'food_ru',
      operation: 'searchByProducts',
      retryable: false,
      message: 'Rights blocked',
      correlationId: 'c1',
      parserVersion: 'none',
    });
    expect(JSON.stringify(pub)).not.toMatch(/stack/i);
  });

  it('rejects client-controlled security / mass-assignment fields', () => {
    expect(() => assertNoClientControlledSourceFields({ rightsStatus: 'ACTIVE_LICENSED' })).toThrow(
      /RECIPE_SOURCE_CLIENT_FIELD_FORBIDDEN/,
    );
    expect(() => assertNoClientControlledSourceFields({ adapterModule: './evil.js' })).toThrow();
    expect(() => assertNoClientControlledSourceFields({ disableRateLimit: true })).toThrow();
    expect(() =>
      assertNoClientControlledSourceFields({ name: 'ok', rateLimitPerMinute: 12 }),
    ).not.toThrow();
  });
});

describe('RP2-04A URL / network security contract', () => {
  it('normalizes HTTPS baseUrl and rejects credentials / private / localhost', () => {
    expect(normalizeAndValidateSourceBaseUrl('https://www.food.ru/path/').href).toBe(
      'https://www.food.ru/path',
    );
    expect(() => normalizeAndValidateSourceBaseUrl('http://www.food.ru')).toThrow(
      /HTTPS_REQUIRED/,
    );
    expect(() =>
      normalizeAndValidateSourceBaseUrl('https://user:pass@www.food.ru'),
    ).toThrow(/CREDENTIALS_FORBIDDEN/);
    expect(() => normalizeAndValidateSourceBaseUrl('https://127.0.0.1')).toThrow(/PRIVATE/);
    expect(() => normalizeAndValidateSourceBaseUrl('https://localhost')).toThrow(/HOST_FORBIDDEN/);
    expect(() => normalizeAndValidateSourceBaseUrl('https://169.254.169.254')).toThrow(/PRIVATE/);
  });

  it('enforces domain allowlist and redirect revalidation', () => {
    expect(() => assertHostnameAllowlisted('evil.com', ['www.food.ru'])).toThrow(
      /DOMAIN_NOT_ALLOWLISTED/,
    );
    expect(() =>
      assertRedirectHostnameAllowed('www.food.ru', 'cdn.food.ru', ['www.food.ru']),
    ).toThrow(/REDIRECT_OFF_DOMAIN|DOMAIN_NOT_ALLOWLISTED/);
    expect(() =>
      assertRedirectHostnameAllowed('www.food.ru', 'www.food.ru', ['www.food.ru']),
    ).not.toThrow();
    expect(RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT.arbitraryUrlFetchForbidden).toBe(true);
    expect(RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT.dnsRebindingPolicy).toBe(
      'RESOLVE_AND_RECHECK_ALLOWLIST',
    );
  });
});
