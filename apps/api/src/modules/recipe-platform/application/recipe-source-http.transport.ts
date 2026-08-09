/** STEP_215A — centralized source HTTP transport. Adapters must not call fetch/http directly. */

import { randomUUID } from 'node:crypto';
import {
  RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT,
  assertContentTypeAllowed,
  assertForbiddenUrlSchemes,
  assertHostnameAllowlisted,
  assertRedirectHostnameAllowed,
  assertResponseSizeAllowed,
  canonicalizeFoodRuUrl,
  canonicalizeIamCookUrl,
  canonicalizeRussianFoodUrl,
  FOOD_RU_HOSTNAME_ALLOWLIST,
} from '../domain/recipe-source-network.policy';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';

export type RecipeSourceTransportMode = 'LIVE_DISABLED' | 'FIXTURE';

export type RecipeSourceTransportRequest = {
  sourceCode: string;
  operation: 'SEARCH' | 'FETCH_CANDIDATE' | 'CHECK_AVAILABILITY' | 'HEALTH';
  /** Server-built URL only — never accept frontend arbitrary URLs. */
  url: string;
  correlationId?: string;
  fixtureScenario?: string | null;
  allowlist?: readonly string[];
  parserVersion: string;
};

export type RecipeSourceTransportResponse = {
  mode: RecipeSourceTransportMode;
  ok: boolean;
  statusCode: number;
  contentType: string;
  bodyText: string;
  finalUrl: string;
  networkCalls: number;
  requestCount: number;
  correlationId: string;
  redirected: boolean;
  fixtureScenario: string | null;
};

export type RecipeSourceFixtureResolver = (
  scenario: string,
  request: RecipeSourceTransportRequest,
) => { statusCode: number; contentType: string; bodyText: string; finalUrl?: string };

/**
 * Central transport for recipe source adapters.
 * LIVE_DISABLED blocks before any socket.
 * FIXTURE returns deterministic bodies with networkCalls=0.
 */
export class RecipeSourceHttpTransport {
  private requestCount = 0;
  private readonly networkCalls = 0;
  private readonly mode: RecipeSourceTransportMode;
  private readonly fixtures: RecipeSourceFixtureResolver | null;

  constructor(input?: {
    mode?: RecipeSourceTransportMode;
    fixtures?: RecipeSourceFixtureResolver | null;
  }) {
    this.mode = input?.mode ?? 'LIVE_DISABLED';
    this.fixtures = input?.fixtures ?? null;
  }

  getMode(): RecipeSourceTransportMode {
    return this.mode;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  getNetworkCalls(): number {
    return this.networkCalls;
  }

  async request(input: RecipeSourceTransportRequest): Promise<RecipeSourceTransportResponse> {
    this.requestCount += 1;
    const correlationId = input.correlationId?.trim() || randomUUID();
    const allowlist = [...(input.allowlist ?? FOOD_RU_HOSTNAME_ALLOWLIST)];

    const fail = (code: RecipeSourceAdapterError['code'], safeMessage: string): never => {
      throw new RecipeSourceAdapterError({
        code,
        sourceCode: input.sourceCode,
        operation: input.operation,
        retryable: false,
        safeMessage,
        correlationId,
        parserVersion: input.parserVersion,
      });
    };

    try {
      assertForbiddenUrlSchemes(input.url);
    } catch (error) {
      fail('POLICY_BLOCKED', error instanceof Error ? error.message : 'URL_SCHEME_FORBIDDEN');
    }

    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      fail('CONFIGURATION_ERROR', 'Invalid transport URL');
    }

    try {
      assertHostnameAllowlisted(parsed.hostname, allowlist);
    if (input.sourceCode === 'food_ru') {
      canonicalizeFoodRuUrl(input.url);
    } else if (input.sourceCode === 'iamcook') {
      canonicalizeIamCookUrl(input.url);
    } else if (input.sourceCode === 'russianfood') {
      canonicalizeRussianFoodUrl(input.url);
    }
    } catch (error) {
      fail('POLICY_BLOCKED', error instanceof Error ? error.message : 'HOSTNAME_POLICY');
    }

    if (this.mode === 'LIVE_DISABLED') {
      // Blocked before any socket / DNS / fetch.
      fail('LIVE_EXECUTION_DISABLED', 'Live source HTTP is disabled by transport policy');
    }

    if (this.mode === 'FIXTURE') {
      if (!this.fixtures) {
        fail('CONFIGURATION_ERROR', 'Fixture resolver is not configured');
      }
      const scenario = String(input.fixtureScenario ?? 'recipe-valid-jsonld').trim();
      if (!scenario) {
        fail('CONFIGURATION_ERROR', 'Fixture scenario required');
      }
      let fixture: ReturnType<RecipeSourceFixtureResolver>;
      try {
        fixture = this.fixtures(scenario, input);
      } catch (error) {
        fail('CONFIGURATION_ERROR', error instanceof Error ? error.message : 'FIXTURE_RESOLVE_FAILED');
      }
      try {
        assertContentTypeAllowed(fixture.contentType);
        assertResponseSizeAllowed(Buffer.byteLength(fixture.bodyText, 'utf8'));
        if (fixture.finalUrl && fixture.finalUrl !== input.url) {
          const from = parsed.hostname;
          const to = new URL(fixture.finalUrl).hostname;
          assertRedirectHostnameAllowed(from, to, allowlist);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TRANSPORT_POLICY';
        if (message.includes('RESPONSE_TOO_LARGE')) fail('RESPONSE_TOO_LARGE', message);
        if (message.includes('UNSUPPORTED_CONTENT_TYPE')) fail('UNSUPPORTED_CONTENT_TYPE', message);
        if (message.includes('REDIRECT')) fail('REDIRECT_FORBIDDEN', message);
        fail('POLICY_BLOCKED', message);
      }
      return {
        mode: 'FIXTURE',
        ok: fixture.statusCode >= 200 && fixture.statusCode < 300,
        statusCode: fixture.statusCode,
        contentType: fixture.contentType,
        bodyText: fixture.bodyText,
        finalUrl: fixture.finalUrl ?? input.url,
        networkCalls: 0,
        requestCount: this.requestCount,
        correlationId,
        redirected: Boolean(fixture.finalUrl && fixture.finalUrl !== input.url),
        fixtureScenario: scenario,
      };
    }

    fail('CONFIGURATION_ERROR', 'Unknown transport mode');
  }

  getSecurityContract() {
    return RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT;
  }
}

export function createLiveDisabledTransport(): RecipeSourceHttpTransport {
  return new RecipeSourceHttpTransport({ mode: 'LIVE_DISABLED' });
}

export function createFixtureTransport(fixtures: RecipeSourceFixtureResolver): RecipeSourceHttpTransport {
  return new RecipeSourceHttpTransport({ mode: 'FIXTURE', fixtures });
}
