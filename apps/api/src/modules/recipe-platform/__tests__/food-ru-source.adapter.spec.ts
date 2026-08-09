import { describe, expect, it } from 'vitest';
import {
  createFixtureTransport,
  createLiveDisabledTransport,
} from '../application/recipe-source-http.transport';
import { FoodRuSourceAdapter } from '../application/food-ru/food-ru-source.adapter';
import { resolveFoodRuFixture } from '../application/food-ru/food-ru.fixtures';
import {
  FOOD_RU_PARSER_VERSION,
  parseFoodRuCandidateHtml,
} from '../application/food-ru/food-ru.parser';
import { RecipeSourceAdapterRegistry } from '../application/recipe-source-adapter.registry';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../domain/recipe-external-source.policy';
import {
  assertHostnameAllowlisted,
  assertRedirectHostnameAllowed,
  buildFoodRuRecipeUrl,
  buildFoodRuSearchUrl,
  canonicalizeFoodRuUrl,
} from '../domain/recipe-source-network.policy';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';

function fixtureContext(overrides?: Partial<{ testMode: boolean; sourceCode: string }>) {
  return {
    sourceId: 'src-1',
    sourceCode: overrides?.sourceCode ?? 'food_ru',
    adapterType: 'FOOD_RU',
    parserVersion: FOOD_RU_PARSER_VERSION,
    collectionMode: 'CONTROLLED_HTML_RESEARCH',
    correlationId: 'corr-215',
    actorUserId: 'owner-1',
    allowlistedHostnames: ['food.ru'],
    requestTimeoutMs: 5000,
    rateLimitPerMinute: 10,
    testMode: overrides?.testMode ?? true,
  };
}

describe('STEP_215A RecipeSourceHttpTransport', () => {
  it('LIVE_DISABLED blocks before socket with networkCalls=0', async () => {
    const transport = createLiveDisabledTransport();
    await expect(
      transport.request({
        sourceCode: 'food_ru',
        operation: 'FETCH_CANDIDATE',
        url: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
        parserVersion: FOOD_RU_PARSER_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'LIVE_EXECUTION_DISABLED' });
    expect(transport.getNetworkCalls()).toBe(0);
  });

  it('rejects localhost, private IP, metadata, schemes, CRLF, traversal', async () => {
    const transport = createLiveDisabledTransport();
    const bad = [
      'https://localhost/recipes/x',
      'https://127.0.0.1/recipes/x',
      'https://169.254.169.254/latest',
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://food.ru/recipes/x%0d%0aInjected',
      '//food.ru/recipes/x',
    ];
    for (const url of bad) {
      await expect(
        transport.request({
          sourceCode: 'food_ru',
          operation: 'FETCH_CANDIDATE',
          url,
          parserVersion: FOOD_RU_PARSER_VERSION,
        }),
      ).rejects.toBeInstanceOf(RecipeSourceAdapterError);
    }
  });

  it('FIXTURE returns body with networkCalls=0 and blocks foreign redirect', async () => {
    const transport = createFixtureTransport((scenario) => resolveFoodRuFixture(scenario));
    const ok = await transport.request({
      sourceCode: 'food_ru',
      operation: 'FETCH_CANDIDATE',
      url: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
      fixtureScenario: 'recipe-valid-jsonld',
      parserVersion: FOOD_RU_PARSER_VERSION,
    });
    expect(ok.networkCalls).toBe(0);
    expect(ok.statusCode).toBe(200);

    await expect(
      transport.request({
        sourceCode: 'food_ru',
        operation: 'FETCH_CANDIDATE',
        url: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
        fixtureScenario: 'foreign-redirect',
        parserVersion: FOOD_RU_PARSER_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'REDIRECT_FORBIDDEN' });

    await expect(
      transport.request({
        sourceCode: 'food_ru',
        operation: 'FETCH_CANDIDATE',
        url: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
        fixtureScenario: 'oversized-response',
        parserVersion: FOOD_RU_PARSER_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
});

describe('STEP_215A Food.ru URL policy', () => {
  it('canonicalizes recipe/search URLs and strips tracking', () => {
    const recipe = canonicalizeFoodRuUrl(
      'https://food.ru/recipes/Synthetic-Chicken-Buckwheat/?utm_source=x#frag',
    );
    expect(recipe.href).toBe('https://food.ru/recipes/synthetic-chicken-buckwheat');
    expect(recipe.externalId).toBe('synthetic-chicken-buckwheat');
    expect(buildFoodRuSearchUrl('курица').startsWith('https://food.ru/search?q=')).toBe(true);
    expect(buildFoodRuRecipeUrl('synthetic-chicken-buckwheat')).toContain('/recipes/');
  });

  it('rejects off-domain redirect and non-allowlisted hosts', () => {
    expect(() => assertHostnameAllowlisted('evil.example', ['food.ru'])).toThrow();
    expect(() => assertRedirectHostnameAllowed('food.ru', 'evil.example', ['food.ru'])).toThrow();
  });
});

describe('STEP_215B FoodRuSourceAdapter', () => {
  it('registers with contract/parser versions and capabilities', () => {
    const registry = new RecipeSourceAdapterRegistry();
    const adapter = registry.getOrThrow('FOOD_RU');
    expect(adapter.adapterType).toBe('FOOD_RU');
    expect(adapter.contractVersion).toBe(RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION);
    expect(adapter.parserVersion).toBe(FOOD_RU_PARSER_VERSION);
    expect(adapter.descriptor.supportedOperations).toEqual(
      expect.arrayContaining(['searchByProducts', 'fetchCandidate', 'checkAvailability', 'healthCheck']),
    );
  });

  it('parses JSON-LD and DOM fallback fixtures; strips script', () => {
    const jsonLd = resolveFoodRuFixture('recipe-valid-jsonld');
    const parsed = parseFoodRuCandidateHtml({
      bodyText: jsonLd.bodyText,
      sourceUrl: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    expect(parsed.title).toContain('Синтетический');
    expect(parsed.ingredients.length).toBeGreaterThanOrEqual(2);
    expect(parsed.sourceNutrition?.trust).toBe('UNTRUSTED_SOURCE');
    expect(parsed.payloadChecksum).toBeTruthy();

    const dom = resolveFoodRuFixture('recipe-dom-fallback');
    const domParsed = parseFoodRuCandidateHtml({
      bodyText: dom.bodyText,
      sourceUrl: 'https://food.ru/recipes/synthetic-dom-fallback',
      statusCode: 200,
    });
    expect(domParsed.warnings).toContain('DOM_FALLBACK_USED');

    const malicious = resolveFoodRuFixture('malicious-script');
    const safe = parseFoodRuCandidateHtml({
      bodyText: malicious.bodyText,
      sourceUrl: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    expect(safe.title).not.toMatch(/<script/i);
  });

  it('fixture search/fetch/availability keep networkCalls=0; live blocked', async () => {
    const adapter = new FoodRuSourceAdapter();
    const cards = await adapter.searchByProducts(
      {
        primaryProductIds: ['synthetic'],
        locale: 'ru',
        resultLimit: 3,
        correlationId: 'u-1',
      },
      fixtureContext(),
    );
    expect(cards[0]?.sourceCode).toBe('food_ru');

    const candidate = await adapter.fetchCandidate('synthetic-chicken-buckwheat', fixtureContext());
    expect(candidate.parserVersion).toBe(FOOD_RU_PARSER_VERSION);

    const availability = await adapter.checkAvailability('fixture:removed-recipe', fixtureContext());
    expect(availability.networkCalls).toBe(0);
    expect(availability.availabilityStatus).toBe('REMOVED');

    await expect(
      adapter.fetchCandidate('synthetic-chicken-buckwheat', fixtureContext({ testMode: false })),
    ).rejects.toMatchObject({ code: 'LIVE_EXECUTION_DISABLED' });
  });

  it('maps changed vs duplicate checksums differently', () => {
    const a = parseFoodRuCandidateHtml({
      bodyText: resolveFoodRuFixture('duplicate-payload').bodyText,
      sourceUrl: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    const b = parseFoodRuCandidateHtml({
      bodyText: resolveFoodRuFixture('duplicate-payload').bodyText,
      sourceUrl: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    const c = parseFoodRuCandidateHtml({
      bodyText: resolveFoodRuFixture('changed-payload').bodyText,
      sourceUrl: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    expect(a.payloadChecksum).toBe(b.payloadChecksum);
    expect(a.payloadChecksum).not.toBe(c.payloadChecksum);
    expect(a.identityChecksum).toBe(c.identityChecksum);
  });
});
