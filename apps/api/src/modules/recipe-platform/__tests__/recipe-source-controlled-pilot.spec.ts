import { describe, expect, it } from 'vitest';
import { FoodRuSourceAdapter } from '../application/food-ru/food-ru-source.adapter';
import { IamCookSourceAdapter } from '../application/iamcook/iamcook-source.adapter';
import { RussianFoodSourceAdapter } from '../application/russianfood/russianfood-source.adapter';
import { createControlledPilotTransport, RecipeSourceHttpTransport } from '../application/recipe-source-http.transport';

const policy = (sourceId: string, maxTotalRequests = 80) => ({ sourceId, allowControlledPilot: true, maxTotalRequests, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: 20_000, maxRedirects: 3 });
const context = (sourceId: string, sourceCode: string, adapterType: string) => ({ sourceId, sourceCode, adapterType, parserVersion: 'test/v1', collectionMode: 'CONTROLLED_PILOT', correlationId: 'pilot-test', actorUserId: null, allowlistedHostnames: ['www.iamcook.ru', 'www.russianfood.com'], requestTimeoutMs: 20_000, rateLimitPerMinute: 20, testMode: false });

describe('STEP-339A controlled pilot transport', () => {
  it('keeps LIVE_DISABLED as the default and fails unknown mode closed', async () => {
    await expect(new RecipeSourceHttpTransport().request({ sourceCode: 'iamcook', operation: 'HEALTH', url: 'https://www.iamcook.ru/recipe/test', parserVersion: 'test/v1', allowlist: ['www.iamcook.ru'] })).rejects.toMatchObject({ code: 'LIVE_EXECUTION_DISABLED' });
    const unknown = new RecipeSourceHttpTransport({ mode: 'UNKNOWN' as never });
    await expect(unknown.request({ sourceCode: 'iamcook', operation: 'HEALTH', url: 'https://www.iamcook.ru/recipe/test', parserVersion: 'test/v1', allowlist: ['www.iamcook.ru'] })).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
  });

  it('allows explicit controlled pilot only with source policy and fake requester', async () => {
    const transport = createControlledPilotTransport(policy('source-iam'), async () => ({ statusCode: 200, contentType: 'application/json', bodyText: '{"ok":true}', finalUrl: 'https://www.iamcook.ru/recipe/test' }));
    const response = await transport.request({ sourceCode: 'iamcook', operation: 'FETCH_CANDIDATE', url: 'https://www.iamcook.ru/recipe/test', parserVersion: 'test/v1', allowlist: ['www.iamcook.ru'], pilotPolicy: policy('source-iam') });
    expect(response.mode).toBe('CONTROLLED_PILOT');
    expect(response.networkCalls).toBe(1);
  });

  it('enforces request budget and blocks arbitrary/private/redirect hosts', async () => {
    const transport = createControlledPilotTransport(policy('source-iam', 1), async ({ url }) => ({ statusCode: 200, contentType: 'text/html', bodyText: 'ok', finalUrl: url }));
    const input = { sourceCode: 'iamcook', operation: 'FETCH_CANDIDATE' as const, url: 'https://www.iamcook.ru/recipe/test', parserVersion: 'test/v1', allowlist: ['www.iamcook.ru'], pilotPolicy: policy('source-iam', 1) };
    await transport.request(input);
    await expect(transport.request(input)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(createControlledPilotTransport(policy('source-iam'), async () => ({ statusCode: 200, contentType: 'text/html', bodyText: 'ok', finalUrl: 'https://evil.example/recipe/test' })).request({ ...input, pilotPolicy: policy('source-iam') })).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
  });

  it('enables pilot readiness only for IamCook and RussianFood; Food.ru stays blocked', () => {
    expect(new IamCookSourceAdapter().getPilotReadiness()).toMatchObject({ liveExecutionStatus: 'POLICY_BLOCKED', controlledPilotAllowed: true });
    expect(new RussianFoodSourceAdapter().getPilotReadiness()).toMatchObject({ liveExecutionStatus: 'POLICY_BLOCKED', controlledPilotAllowed: true });
    expect(new FoodRuSourceAdapter().getPilotReadiness()).toMatchObject({ controlledPilotAllowed: false });
  });

  it('does not permit an adapter to bypass transport policy', async () => {
    const adapter = new IamCookSourceAdapter();
    await expect(adapter.fetchCandidate('public-id', context('source-iam', 'iamcook', 'IAMCOOK'))).rejects.toMatchObject({ code: 'LIVE_EXECUTION_DISABLED' });
  });
});
