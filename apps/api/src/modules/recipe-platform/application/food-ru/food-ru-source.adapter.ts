/** STEP_215B — Food.ru fixture-backed adapter. Live HTTP blocked by transport. */

import type {
  RecipeSourceAdapter,
  RecipeSourceAdapterDescriptor,
  RecipeSourceExecutionContext,
  RecipeSourceSearchInput,
  SourceAdapterHealthResult,
  SourceAvailabilityResult,
  SourceRecipeCandidatePayload,
  SourceRecipeCard,
} from '../../domain/recipe-source-adapter.contract';
import {
  assertSearchInput,
  RecipeSourceAdapterError,
} from '../../domain/recipe-source-adapter.contract';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../../domain/recipe-external-source.policy';
import {
  buildFoodRuRecipeUrl,
  buildFoodRuSearchUrl,
  FOOD_RU_HOSTNAME_ALLOWLIST,
} from '../../domain/recipe-source-network.policy';
import {
  createFixtureTransport,
  createLiveDisabledTransport,
  RecipeSourceHttpTransport,
} from '../recipe-source-http.transport';
import { resolveFoodRuFixture } from './food-ru.fixtures';
import {
  FOOD_RU_PARSER_VERSION,
  FOOD_RU_SOURCE_CODE,
  parseFoodRuCandidateHtml,
  parseFoodRuSearchJson,
} from './food-ru.parser';

function mapTransportError(
  error: unknown,
  context: RecipeSourceExecutionContext,
  operation: string,
): never {
  if (error instanceof RecipeSourceAdapterError) throw error;
  const message = error instanceof Error ? error.message : 'NETWORK_ERROR';
  const code =
    message.includes('RESPONSE_TOO_LARGE')
      ? 'RESPONSE_TOO_LARGE'
      : message.includes('UNSUPPORTED_CONTENT_TYPE')
        ? 'UNSUPPORTED_CONTENT_TYPE'
        : message.includes('REDIRECT')
          ? 'REDIRECT_FORBIDDEN'
          : message.includes('DOMAIN_NOT_ALLOWLISTED') ||
              message.includes('HOST_FORBIDDEN') ||
              message.includes('PRIVATE') ||
              message.includes('IP_LITERAL') ||
              message.includes('SCHEME') ||
              message.includes('CRLF') ||
              message.includes('TRAVERSAL') ||
              message.includes('PATH_FORBIDDEN')
            ? 'POLICY_BLOCKED'
            : message === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : message === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : message === 'PARSER_INCOMPATIBLE'
                  ? 'PARSER_INCOMPATIBLE'
                  : message === 'ACCESS_DENIED'
                    ? 'AUTH_REQUIRED'
                    : 'PARSE_ERROR';
  throw new RecipeSourceAdapterError({
    code,
    sourceCode: FOOD_RU_SOURCE_CODE,
    operation,
    retryable: code === 'RATE_LIMITED',
    safeMessage: message,
    correlationId: context.correlationId,
    parserVersion: FOOD_RU_PARSER_VERSION,
  });
}

export class FoodRuSourceAdapter implements RecipeSourceAdapter {
  readonly adapterType = 'FOOD_RU';
  readonly contractVersion = RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION;
  readonly parserVersion = FOOD_RU_PARSER_VERSION;
  readonly descriptor: RecipeSourceAdapterDescriptor = {
    adapterType: this.adapterType,
    contractVersion: this.contractVersion,
    parserVersion: this.parserVersion,
    supportedOperations: ['searchByProducts', 'fetchCandidate', 'checkAvailability', 'healthCheck'],
    collectionModes: ['CONTROLLED_HTML_RESEARCH', 'MANUAL_REFERENCE_ONLY'],
    supportedLocales: ['ru'],
    supportedSourceCodes: [FOOD_RU_SOURCE_CODE],
  };

  private readonly liveTransport: RecipeSourceHttpTransport;
  private readonly fixtureTransport: RecipeSourceHttpTransport;

  constructor(input?: {
    liveTransport?: RecipeSourceHttpTransport;
    fixtureTransport?: RecipeSourceHttpTransport;
  }) {
    this.liveTransport = input?.liveTransport ?? createLiveDisabledTransport();
    this.fixtureTransport =
      input?.fixtureTransport ??
      createFixtureTransport((scenario) => resolveFoodRuFixture(scenario));
  }

  async searchByProducts(
    input: RecipeSourceSearchInput,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCard[]> {
    this.assertContext(context, 'searchByProducts');
    assertSearchInput(input);
    const query = input.primaryProductIds[0] ?? 'synthetic';
    const url = buildFoodRuSearchUrl(String(query).slice(0, 80));
    const transport = this.pickTransport(context);
    try {
      const response = await transport.request({
        sourceCode: FOOD_RU_SOURCE_CODE,
        operation: 'SEARCH',
        url,
        correlationId: context.correlationId,
        fixtureScenario: context.testMode ? 'search-valid' : null,
        allowlist: FOOD_RU_HOSTNAME_ALLOWLIST,
        parserVersion: this.parserVersion,
        pilotPolicy: context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: false, maxTotalRequests: 80, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined,
      });
      const cards = parseFoodRuSearchJson(response.bodyText);
      return cards.slice(0, input.resultLimit).map((card) => ({
        sourceCode: FOOD_RU_SOURCE_CODE,
        externalId: card.externalId,
        sourceUrl: card.sourceUrl,
        title: card.title,
        shortDescription: card.shortDescription,
        imageReference: null,
        estimatedTimeMinutes: null,
        servings: null,
        visibleIngredientNames: [],
        sourceCategories: [],
        availability: 'AVAILABLE' as const,
        fetchedAt: new Date(0).toISOString(),
        parserVersion: this.parserVersion,
        confidence: 0.5,
        rawReferenceHash: null,
      }));
    } catch (error) {
      mapTransportError(error, context, 'searchByProducts');
    }
  }

  async fetchCandidate(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCandidatePayload> {
    this.assertContext(context, 'fetchCandidate');
    const id = String(externalId ?? '').trim();
    if (!id) {
      throw new RecipeSourceAdapterError({
        code: 'NOT_FOUND',
        sourceCode: FOOD_RU_SOURCE_CODE,
        operation: 'fetchCandidate',
        retryable: false,
        safeMessage: 'Candidate not found',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
    const scenario = this.scenarioFromExternalId(id);
    const url = buildFoodRuRecipeUrl(this.urlSlugForScenario(scenario));
    const transport = this.pickTransport(context);
    try {
      const response = await transport.request({
        sourceCode: FOOD_RU_SOURCE_CODE,
        operation: 'FETCH_CANDIDATE',
        url,
        correlationId: context.correlationId,
        fixtureScenario: context.testMode ? scenario : null,
        allowlist: FOOD_RU_HOSTNAME_ALLOWLIST,
        parserVersion: this.parserVersion,
        pilotPolicy: context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: false, maxTotalRequests: 80, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined,
      });
      return parseFoodRuCandidateHtml({
        bodyText: response.bodyText,
        sourceUrl: response.finalUrl,
        statusCode: response.statusCode,
      });
    } catch (error) {
      mapTransportError(error, context, 'fetchCandidate');
    }
  }

  async checkAvailability(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceAvailabilityResult> {
    this.assertContext(context, 'checkAvailability');
    const scenario = this.scenarioFromExternalId(externalId);
    const url = buildFoodRuRecipeUrl(this.urlSlugForScenario(scenario));
    const transport = this.pickTransport(context);
    try {
      const response = await transport.request({
        sourceCode: FOOD_RU_SOURCE_CODE,
        operation: 'CHECK_AVAILABILITY',
        url,
        correlationId: context.correlationId,
        fixtureScenario: context.testMode ? scenario : null,
        allowlist: FOOD_RU_HOSTNAME_ALLOWLIST,
        parserVersion: this.parserVersion,
        pilotPolicy: context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: false, maxTotalRequests: 80, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined,
      });
      const available = response.statusCode >= 200 && response.statusCode < 300;
      return {
        sourceCode: FOOD_RU_SOURCE_CODE,
        externalId,
        available,
        availabilityStatus: available
          ? 'AVAILABLE'
          : response.statusCode === 404
            ? 'REMOVED'
            : response.statusCode === 403
              ? 'ACCESS_DENIED'
              : response.statusCode === 429
                ? 'RATE_LIMITED'
                : 'UNKNOWN',
        reason: available ? null : `HTTP_${response.statusCode}`,
        checkedAt: new Date(0).toISOString(),
        parserVersion: this.parserVersion,
        correlationId: context.correlationId,
        networkCalls: 0,
      };
    } catch (error) {
      if (error instanceof RecipeSourceAdapterError && error.code === 'LIVE_EXECUTION_DISABLED') {
        return {
          sourceCode: FOOD_RU_SOURCE_CODE,
          externalId,
          available: false,
          availabilityStatus: 'LIVE_EXECUTION_DISABLED',
          reason: 'LIVE_EXECUTION_DISABLED',
          checkedAt: new Date().toISOString(),
          parserVersion: this.parserVersion,
          correlationId: context.correlationId,
          networkCalls: 0,
        };
      }
      mapTransportError(error, context, 'checkAvailability');
    }
  }

  async healthCheck(context: RecipeSourceExecutionContext): Promise<SourceAdapterHealthResult> {
    this.assertContext(context, 'healthCheck');
    if (!context.testMode) {
      return {
        adapterType: this.adapterType,
        contractVersion: this.contractVersion,
        parserVersion: this.parserVersion,
        ok: false,
        status: 'CONFIGURATION_ERROR',
        details: 'Live Food.ru execution is policy-blocked; fixture mode required',
        checkedAt: new Date().toISOString(),
      };
    }
    const sample = await this.fetchCandidate('synthetic-chicken-buckwheat', context);
    return {
      adapterType: this.adapterType,
      contractVersion: this.contractVersion,
      parserVersion: this.parserVersion,
      ok: Boolean(sample.title),
      status: 'HEALTHY',
      details: 'Fixture health check only — liveExecution=POLICY_BLOCKED networkCalls=0',
      checkedAt: new Date().toISOString(),
    };
  }

  getPilotReadiness() {
    return {
      sourceCode: FOOD_RU_SOURCE_CODE,
      implementationStatus: 'IMPLEMENTED' as const,
      liveExecutionStatus: 'POLICY_BLOCKED' as const,
      fixtureMode: 'AVAILABLE' as const,
      parserVersion: this.parserVersion,
      contractVersion: this.contractVersion,
      lastLiveRunAt: null,
      lastFixtureRunAt: null,
      networkCalls: 0,
      publicationRights: 'NOT_CONFIRMED' as const,
      imageReuseRights: 'NOT_CONFIRMED' as const,
      circuitState: 'CLOSED' as const,
      continuousLiveCollectionAllowed: false,
      controlledPilotAllowed: false,
    };
  }

  private pickTransport(context: RecipeSourceExecutionContext): RecipeSourceHttpTransport {
    return context.testMode ? this.fixtureTransport : this.liveTransport;
  }

  private scenarioFromExternalId(externalId: string): string {
    const id = String(externalId).trim().toLowerCase();
    if (id.startsWith('fixture:')) return id.slice('fixture:'.length);
    if (id.includes('parity')) return 'parity-dish';
    if (id.includes('removed')) return 'removed-recipe';
    if (id.includes('denied') || id.includes('access')) return 'access-denied';
    if (id.includes('rate')) return 'rate-limited';
    if (id.includes('incompatible')) return 'parser-incompatible';
    if (id.includes('dom')) return 'recipe-dom-fallback';
    if (id.includes('changed')) return 'changed-payload';
    if (id.includes('duplicate')) return 'duplicate-payload';
    if (id.includes('oversized')) return 'oversized-response';
    if (id.includes('foreign') || id.includes('redirect')) return 'foreign-redirect';
    if (id.includes('malicious')) return 'malicious-script';
    if (id.includes('missing-servings')) return 'missing-servings';
    if (id.includes('missing-nutrition')) return 'missing-nutrition';
    if (id.includes('missing-quant')) return 'missing-quantities';
    if (id.includes('to-taste') || id.includes('taste')) return 'ingredient-to-taste';
    if (id.includes('fraction')) return 'fractional-quantity';
    if (id.includes('range')) return 'quantity-range';
    if (id.includes('unknown-unit')) return 'unknown-unit';
    if (id.includes('ambiguous')) return 'ambiguous-product';
    if (id.includes('unknown-product')) return 'unknown-product';
    return 'recipe-valid-jsonld';
  }

  private urlSlugForScenario(scenario: string): string {
    const slug = scenario.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug)) return slug;
    return 'synthetic-chicken-buckwheat';
  }

  private assertContext(context: RecipeSourceExecutionContext, operation: string): void {
    const code = String(context.sourceCode ?? '').toLowerCase();
    const adapterType = String(context.adapterType ?? '');
    const allowedCode = code === FOOD_RU_SOURCE_CODE || code.startsWith('food_ru_');
    if (!allowedCode || (adapterType !== 'FOOD_RU' && adapterType !== 'NOT_CONFIGURED')) {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: context.sourceCode,
        operation,
        retryable: false,
        safeMessage: 'Food.ru adapter sourceCode/adapterType mismatch',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
  }
}
