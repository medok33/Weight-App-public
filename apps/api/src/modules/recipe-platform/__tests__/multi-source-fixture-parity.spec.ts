import { describe, expect, it } from 'vitest';
import { IamCookSourceAdapter } from '../application/iamcook/iamcook-source.adapter';
import { resolveIamCookFixture } from '../application/iamcook/iamcook.fixtures';
import {
  IAMCOOK_PARSER_VERSION,
  parseIamCookCandidateHtml,
} from '../application/iamcook/iamcook.parser';
import { RussianFoodSourceAdapter } from '../application/russianfood/russianfood-source.adapter';
import { resolveRussianFoodFixture } from '../application/russianfood/russianfood.fixtures';
import {
  parseRussianFoodCandidateHtml,
  RUSSIANFOOD_PARSER_VERSION,
} from '../application/russianfood/russianfood.parser';
import { RecipeSourceAdapterRegistry } from '../application/recipe-source-adapter.registry';
import { validateMultiSourceFixtureParity } from '../application/shared/multi-source-parity';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../domain/recipe-external-source.policy';
import {
  buildIamCookRecipeUrl,
  buildRussianFoodRecipeUrl,
  canonicalizeIamCookUrl,
  canonicalizeRussianFoodUrl,
} from '../domain/recipe-source-network.policy';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';

function fixtureContext(sourceCode: string, adapterType: string, parserVersion: string) {
  return {
    sourceId: 'src-1',
    sourceCode,
    adapterType,
    parserVersion,
    collectionMode: 'CONTROLLED_HTML_RESEARCH',
    correlationId: 'corr-215c',
    actorUserId: 'owner-1',
    allowlistedHostnames: [],
    requestTimeoutMs: 5000,
    rateLimitPerMinute: 10,
    testMode: true,
  };
}

describe('STEP_215C IamCookSourceAdapter', () => {
  it('registers with contract/parser versions and capabilities', () => {
    const registry = new RecipeSourceAdapterRegistry();
    const adapter = registry.getOrThrow('IAMCOOK');
    expect(adapter.adapterType).toBe('IAMCOOK');
    expect(adapter.contractVersion).toBe(RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION);
    expect(adapter.parserVersion).toBe(IAMCOOK_PARSER_VERSION);
  });

  it('canonicalizes URLs and parses structured/DOM fixtures; live blocked', async () => {
    expect(canonicalizeIamCookUrl('https://www.iamcook.ru/recipe/Synthetic-Chicken/?utm_source=x').externalId).toBe(
      'synthetic-chicken',
    );
    expect(buildIamCookRecipeUrl('synthetic-chicken-buckwheat')).toContain('/recipe/');

    const structured = parseIamCookCandidateHtml({
      bodyText: resolveIamCookFixture('recipe-valid-structured').bodyText,
      sourceUrl: 'https://www.iamcook.ru/recipe/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    expect(structured.parserVersion).toBe(IAMCOOK_PARSER_VERSION);
    expect(structured.sourceNutrition?.trust).toBe('UNTRUSTED_SOURCE');

    const dom = parseIamCookCandidateHtml({
      bodyText: resolveIamCookFixture('recipe-dom-fallback').bodyText,
      sourceUrl: 'https://www.iamcook.ru/recipe/synthetic-dom-fallback',
      statusCode: 200,
    });
    expect(dom.warnings).toContain('DOM_FALLBACK_USED');

    const adapter = new IamCookSourceAdapter();
    const availability = await adapter.checkAvailability(
      'fixture:removed-recipe',
      fixtureContext('iamcook', 'IAMCOOK', IAMCOOK_PARSER_VERSION),
    );
    expect(availability.networkCalls).toBe(0);
    expect(availability.availabilityStatus).toBe('REMOVED');

    await expect(
      adapter.fetchCandidate(
        'synthetic-chicken-buckwheat',
        { ...fixtureContext('iamcook', 'IAMCOOK', IAMCOOK_PARSER_VERSION), testMode: false },
      ),
    ).rejects.toMatchObject({ code: 'LIVE_EXECUTION_DISABLED' });

    await expect(
      adapter.fetchCandidate(
        'fixture:parser-incompatible',
        fixtureContext('iamcook', 'IAMCOOK', IAMCOOK_PARSER_VERSION),
      ),
    ).rejects.toBeInstanceOf(RecipeSourceAdapterError);
  });

  it('maps duplicate vs changed checksums', () => {
    const a = parseIamCookCandidateHtml({
      bodyText: resolveIamCookFixture('duplicate-payload').bodyText,
      sourceUrl: 'https://www.iamcook.ru/recipe/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    const b = parseIamCookCandidateHtml({
      bodyText: resolveIamCookFixture('duplicate-payload').bodyText,
      sourceUrl: 'https://www.iamcook.ru/recipe/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    const c = parseIamCookCandidateHtml({
      bodyText: resolveIamCookFixture('changed-payload').bodyText,
      sourceUrl: 'https://www.iamcook.ru/recipe/synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    expect(a.payloadChecksum).toBe(b.payloadChecksum);
    expect(a.payloadChecksum).not.toBe(c.payloadChecksum);
    expect(a.identityChecksum).toBe(c.identityChecksum);
  });
});

describe('STEP_215C RussianFoodSourceAdapter', () => {
  it('registers with contract/parser versions and capabilities', () => {
    const registry = new RecipeSourceAdapterRegistry();
    const adapter = registry.getOrThrow('RUSSIANFOOD');
    expect(adapter.adapterType).toBe('RUSSIANFOOD');
    expect(adapter.parserVersion).toBe(RUSSIANFOOD_PARSER_VERSION);
  });

  it('canonicalizes URLs and parses fixtures; live blocked', async () => {
    expect(
      canonicalizeRussianFoodUrl(
        'https://www.russianfood.com/recipes/recipe.php?rid=Synthetic-1&utm_source=x',
      ).externalId,
    ).toBe('synthetic-1');
    expect(buildRussianFoodRecipeUrl('synthetic-chicken-buckwheat')).toContain('rid=');

    const parsed = parseRussianFoodCandidateHtml({
      bodyText: resolveRussianFoodFixture('recipe-valid-structured').bodyText,
      sourceUrl: 'https://www.russianfood.com/recipes/recipe.php?rid=synthetic-chicken-buckwheat',
      statusCode: 200,
    });
    expect(parsed.parserVersion).toBe(RUSSIANFOOD_PARSER_VERSION);

    const adapter = new RussianFoodSourceAdapter();
    await expect(
      adapter.fetchCandidate(
        'synthetic-chicken-buckwheat',
        { ...fixtureContext('russianfood', 'RUSSIANFOOD', RUSSIANFOOD_PARSER_VERSION), testMode: false },
      ),
    ).rejects.toMatchObject({ code: 'LIVE_EXECUTION_DISABLED' });
  });
});

describe('STEP_215C multi-source parity', () => {
  it('validates canonical contract across Food.ru / IamCook / RussianFood', async () => {
    const report = await validateMultiSourceFixtureParity();
    expect(report.ok).toBe(true);
    expect(report.networkCalls).toBe(0);
    expect(report.crossSourceIdentityDistinct).toBe(true);
    expect(report.sameContractVersion).toBe(true);
    expect(report.sources).toHaveLength(3);
    expect(new Set(report.sources.map((s) => s.sourceCode)).size).toBe(3);
    // Source differences preserved
    const food = report.sources.find((s) => s.sourceCode === 'food_ru')!;
    const iam = report.sources.find((s) => s.sourceCode === 'iamcook')!;
    const rf = report.sources.find((s) => s.sourceCode === 'russianfood')!;
    expect(food.totalTime).toBeNull();
    expect(iam.totalTime).toBe(25);
    expect(rf.servings).toBeNull();
    expect(iam.nutritionTrust).toBe('UNTRUSTED_SOURCE');
  });
});
