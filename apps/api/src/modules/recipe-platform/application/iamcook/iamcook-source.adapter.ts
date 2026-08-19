/** STEP_215C — IamCook fixture-backed adapter. Live HTTP blocked by transport. */

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
  buildIamCookRecipeUrl,
  buildIamCookSearchUrl,
  IAMCOOK_HOSTNAME_ALLOWLIST,
} from '../../domain/recipe-source-network.policy';
import {
  createFixtureTransport,
  createLiveDisabledTransport,
  RecipeSourceHttpTransport,
} from '../recipe-source-http.transport';
import {
  mapSourceTransportError,
  scenarioFromExternalId,
  urlSlugForScenario,
} from '../shared/fixture-adapter.helpers';
import { resolveIamCookFixture } from './iamcook.fixtures';
import {
  IAMCOOK_PARSER_VERSION,
  IAMCOOK_SOURCE_CODE,
  parseIamCookCandidateHtml,
  parseIamCookSearchJson,
} from './iamcook.parser';

export class IamCookSourceAdapter implements RecipeSourceAdapter {
  readonly adapterType = 'IAMCOOK';
  readonly contractVersion = RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION;
  readonly parserVersion = IAMCOOK_PARSER_VERSION;
  readonly descriptor: RecipeSourceAdapterDescriptor = {
    adapterType: this.adapterType,
    contractVersion: this.contractVersion,
    parserVersion: this.parserVersion,
    supportedOperations: ['searchByProducts', 'fetchCandidate', 'checkAvailability', 'healthCheck'],
    collectionModes: ['CONTROLLED_HTML_RESEARCH', 'MANUAL_REFERENCE_ONLY'],
    supportedLocales: ['ru'],
    supportedSourceCodes: [IAMCOOK_SOURCE_CODE],
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
      createFixtureTransport((scenario) => resolveIamCookFixture(scenario));
  }

  async searchByProducts(
    input: RecipeSourceSearchInput,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCard[]> {
    this.assertContext(context, 'searchByProducts');
    assertSearchInput(input);
    const query = input.primaryProductIds[0] ?? 'synthetic';
    const url = buildIamCookSearchUrl(String(query).slice(0, 80));
    const transport = this.pickTransport(context);
    try {
      const response = await transport.request({
        sourceCode: IAMCOOK_SOURCE_CODE,
        operation: 'SEARCH',
        url,
        correlationId: context.correlationId,
        fixtureScenario: context.testMode ? 'search-valid' : null,
        allowlist: IAMCOOK_HOSTNAME_ALLOWLIST,
        parserVersion: this.parserVersion,
        pilotPolicy: context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: true, maxTotalRequests: 80, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined,
      });
      const cards = parseIamCookSearchJson(response.bodyText);
      return cards.slice(0, input.resultLimit).map((card) => ({
        sourceCode: IAMCOOK_SOURCE_CODE,
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
      mapSourceTransportError(error, context, 'searchByProducts', IAMCOOK_SOURCE_CODE, this.parserVersion);
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
        sourceCode: IAMCOOK_SOURCE_CODE,
        operation: 'fetchCandidate',
        retryable: false,
        safeMessage: 'Candidate not found',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
    const scenario = scenarioFromExternalId(id);
    const url = buildIamCookRecipeUrl(urlSlugForScenario(scenario, 'synthetic-chicken-buckwheat'));
    const transport = this.pickTransport(context);
    try {
      const response = await transport.request({
        sourceCode: IAMCOOK_SOURCE_CODE,
        operation: 'FETCH_CANDIDATE',
        url,
        correlationId: context.correlationId,
        fixtureScenario: context.testMode ? scenario : null,
        allowlist: IAMCOOK_HOSTNAME_ALLOWLIST,
        parserVersion: this.parserVersion,
        pilotPolicy: context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: true, maxTotalRequests: 80, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined,
      });
      return parseIamCookCandidateHtml({
        bodyText: response.bodyText,
        sourceUrl: response.finalUrl,
        statusCode: response.statusCode,
      });
    } catch (error) {
      mapSourceTransportError(error, context, 'fetchCandidate', IAMCOOK_SOURCE_CODE, this.parserVersion);
    }
  }

  async checkAvailability(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceAvailabilityResult> {
    this.assertContext(context, 'checkAvailability');
    const scenario = scenarioFromExternalId(externalId);
    const url = buildIamCookRecipeUrl(urlSlugForScenario(scenario, 'synthetic-chicken-buckwheat'));
    const transport = this.pickTransport(context);
    try {
      const response = await transport.request({
        sourceCode: IAMCOOK_SOURCE_CODE,
        operation: 'CHECK_AVAILABILITY',
        url,
        correlationId: context.correlationId,
        fixtureScenario: context.testMode ? scenario : null,
        allowlist: IAMCOOK_HOSTNAME_ALLOWLIST,
        parserVersion: this.parserVersion,
        pilotPolicy: context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: true, maxTotalRequests: 80, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined,
      });
      const available = response.statusCode >= 200 && response.statusCode < 300;
      return {
        sourceCode: IAMCOOK_SOURCE_CODE,
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
          sourceCode: IAMCOOK_SOURCE_CODE,
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
      mapSourceTransportError(error, context, 'checkAvailability', IAMCOOK_SOURCE_CODE, this.parserVersion);
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
        details: 'Live IamCook execution is policy-blocked; fixture mode required',
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
      sourceCode: IAMCOOK_SOURCE_CODE,
      implementationStatus: 'IMPLEMENTED' as const,
      liveExecutionStatus: 'POLICY_BLOCKED' as const,
      controlledPilotStatus: 'ENABLED' as const,
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
      controlledPilotAllowed: true,
    };
  }

  private pickTransport(context: RecipeSourceExecutionContext): RecipeSourceHttpTransport {
    return context.testMode ? this.fixtureTransport : this.liveTransport;
  }

  private assertContext(context: RecipeSourceExecutionContext, operation: string): void {
    const code = String(context.sourceCode ?? '').toLowerCase();
    const adapterType = String(context.adapterType ?? '');
    const allowedCode = code === IAMCOOK_SOURCE_CODE || code.startsWith('iamcook_');
    if (!allowedCode || (adapterType !== 'IAMCOOK' && adapterType !== 'NOT_CONFIGURED')) {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: context.sourceCode,
        operation,
        retryable: false,
        safeMessage: 'IamCook adapter sourceCode/adapterType mismatch',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
  }
}
