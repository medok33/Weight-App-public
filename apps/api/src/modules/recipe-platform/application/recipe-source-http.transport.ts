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

export type RecipeSourceTransportMode = 'LIVE_DISABLED' | 'CONTROLLED_PILOT' | 'FIXTURE';

export type ControlledPilotPolicy = {
  sourceId: string;
  allowControlledPilot: boolean;
  maxTotalRequests: number;
  maxConcurrentRequests: number;
  perHostMinIntervalMs: number;
  requestTimeoutMs: number;
  maxRedirects: number;
};

export type RecipeSourceRequester = (input: {
  url: string;
  signal: AbortSignal;
}) => Promise<{ statusCode: number; contentType: string; bodyText: string; finalUrl: string }>;

export type RecipeSourceTransportRequest = {
  sourceCode: string;
  operation: 'SEARCH' | 'FETCH_CANDIDATE' | 'CHECK_AVAILABILITY' | 'HEALTH';
  /** Server-built URL only — never accept frontend arbitrary URLs. */
  url: string;
  correlationId?: string;
  fixtureScenario?: string | null;
  allowlist?: readonly string[];
  parserVersion: string;
  pilotPolicy?: ControlledPilotPolicy;
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
  private readonly pilotPolicy: ControlledPilotPolicy | null;
  private readonly requester: RecipeSourceRequester | null;
  private activeRequests = 0;
  private lastRequestAt = new Map<string, number>();

  constructor(input?: {
    mode?: RecipeSourceTransportMode;
    fixtures?: RecipeSourceFixtureResolver | null;
    pilotPolicy?: ControlledPilotPolicy;
    requester?: RecipeSourceRequester;
  }) {
    this.mode = input?.mode ?? 'LIVE_DISABLED';
    this.fixtures = input?.fixtures ?? null;
    this.pilotPolicy = input?.pilotPolicy ?? null;
    this.requester = input?.requester ?? null;
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

    if (this.mode === 'CONTROLLED_PILOT') {
      const policy = this.pilotPolicy;
      if (!policy || !policy.allowControlledPilot || !input.pilotPolicy || input.pilotPolicy.sourceId !== policy.sourceId) {
        fail('POLICY_BLOCKED', 'Controlled pilot requires explicit source policy permission');
      }
      if (policy.maxTotalRequests < 1 || policy.maxTotalRequests > 80 || policy.maxConcurrentRequests < 1 || policy.maxConcurrentRequests > 2 || policy.perHostMinIntervalMs < 2500 || policy.requestTimeoutMs > 20000 || policy.maxRedirects > 3) {
        fail('POLICY_BLOCKED', 'Controlled pilot request bounds invalid');
      }
      if (this.requestCount > policy.maxTotalRequests) fail('RATE_LIMITED', 'Controlled pilot request budget exhausted');
      if (this.activeRequests >= policy.maxConcurrentRequests) fail('RATE_LIMITED', 'Controlled pilot concurrency limit reached');
      const previous = this.lastRequestAt.get(parsed.hostname) ?? 0;
      const elapsed = Date.now() - previous;
      if (elapsed < policy.perHostMinIntervalMs) await new Promise((resolve) => setTimeout(resolve, policy.perHostMinIntervalMs - elapsed));
      this.activeRequests += 1;
      this.lastRequestAt.set(parsed.hostname, Date.now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.requestTimeoutMs);
      try {
        const response = this.requester
          ? await this.requester({ url: input.url, signal: controller.signal })
          : await this.defaultRequester(input.url, controller.signal, policy.maxRedirects, allowlist);
        assertContentTypeAllowed(response.contentType);
        assertResponseSizeAllowed(Buffer.byteLength(response.bodyText, 'utf8'));
        const finalHost = new URL(response.finalUrl).hostname;
        assertRedirectHostnameAllowed(parsed.hostname, finalHost, allowlist);
        return { mode: 'CONTROLLED_PILOT', ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, contentType: response.contentType, bodyText: response.bodyText, finalUrl: response.finalUrl, networkCalls: 1, requestCount: this.requestCount, correlationId, redirected: response.finalUrl !== input.url, fixtureScenario: null };
      } catch (error) {
        if (error instanceof RecipeSourceAdapterError) throw error;
        if (error instanceof Error && /REDIRECT|HOSTNAME|PRIVATE|ALLOWLIST|POLICY/.test(error.message)) fail('POLICY_BLOCKED', 'Controlled pilot network policy blocked request');
        const message = error instanceof Error && error.name === 'AbortError' ? 'Controlled pilot request timed out' : 'Controlled pilot request failed';
        fail(error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', message);
      } finally {
        clearTimeout(timer);
        this.activeRequests -= 1;
      }
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

    fail('POLICY_BLOCKED', 'Unknown transport mode');
  }

  private async defaultRequester(url: string, signal: AbortSignal, maxRedirects: number, allowlist: string[]) {
    let current = url;
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const response = await fetch(current, { method: 'GET', redirect: 'manual', signal, headers: { 'user-agent': RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT.safeUserAgent, accept: 'text/html,application/json' } });
      if (response.status < 300 || response.status >= 400) return { statusCode: response.status, contentType: response.headers.get('content-type') ?? '', bodyText: await response.text(), finalUrl: current };
      const location = response.headers.get('location');
      if (!location) throw new Error('REDIRECT_FORBIDDEN');
      const next = new URL(location, current).toString();
      assertRedirectHostnameAllowed(new URL(current).hostname, new URL(next).hostname, allowlist);
      current = next;
    }
    throw new Error('REDIRECT_FORBIDDEN');
  }

  getSecurityContract() {
    return RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT;
  }
}

export function createLiveDisabledTransport(): RecipeSourceHttpTransport {
  return new RecipeSourceHttpTransport({ mode: 'LIVE_DISABLED' });
}

export function createControlledPilotTransport(policy: ControlledPilotPolicy, requester?: RecipeSourceRequester): RecipeSourceHttpTransport {
  return new RecipeSourceHttpTransport({ mode: 'CONTROLLED_PILOT', pilotPolicy: policy, requester });
}

export function createFixtureTransport(fixtures: RecipeSourceFixtureResolver): RecipeSourceHttpTransport {
  return new RecipeSourceHttpTransport({ mode: 'FIXTURE', fixtures });
}
