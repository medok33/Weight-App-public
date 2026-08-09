/** Shared synthetic fixture factory for fixture-backed source adapters. */

export type CommonFixtureScenario =
  | 'search-valid'
  | 'recipe-valid-structured'
  | 'recipe-valid-jsonld'
  | 'recipe-dom-fallback'
  | 'missing-quantities'
  | 'missing-quantity'
  | 'ingredient-to-taste'
  | 'fractional-quantity'
  | 'quantity-range'
  | 'unknown-unit'
  | 'ambiguous-product'
  | 'unknown-product'
  | 'missing-servings'
  | 'missing-nutrition'
  | 'removed-recipe'
  | 'access-denied'
  | 'rate-limited'
  | 'parser-incompatible'
  | 'malicious-script'
  | 'oversized-response'
  | 'foreign-redirect'
  | 'duplicate-payload'
  | 'changed-payload'
  | 'parity-dish';

export type FixtureSiteConfig = {
  siteLabel: string;
  sourceCode: string;
  hostname: string;
  recipePathPrefix: string;
  defaultExternalId: string;
  defaultTitle: string;
  foreignRedirectHost: string;
  parityRecipe: Record<string, unknown>;
  searchExtra?: Array<Record<string, unknown>>;
};

export function recipePage(jsonLd: Record<string, unknown>, extraHtml = '', siteLabel = 'Synthetic'): string {
  return `<!doctype html><html><head><title>${siteLabel} fixture</title>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body><article data-recipe-id="${String(jsonLd.identifier ?? 'synthetic-1')}">${extraHtml}</article></body></html>`;
}

export function baseStructuredRecipe(
  config: FixtureSiteConfig,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    identifier: config.defaultExternalId,
    name: config.defaultTitle,
    description: `Минимальный synthetic fixture (${config.sourceCode})`,
    recipeIngredient: ['курица — 200 г', 'гречка — 80 г'],
    recipeInstructions: [
      { '@type': 'HowToStep', position: 1, text: 'Подготовить продукты' },
      { '@type': 'HowToStep', position: 2, text: 'Приготовить до готовности' },
    ],
    recipeYield: '2',
    prepTime: 'PT5M',
    cookTime: 'PT20M',
    totalTime: 'PT25M',
    recipeCategory: ['MAIN'],
    cookingMethod: 'stove',
    nutrition: {
      '@type': 'NutritionInformation',
      calories: '420 kcal',
    },
    ...overrides,
  };
}

export function resolveCommonFixture(
  scenario: string,
  config: FixtureSiteConfig,
): {
  statusCode: number;
  contentType: string;
  bodyText: string;
  finalUrl?: string;
} {
  const recipeUrl = `https://${config.hostname}${config.recipePathPrefix}/${config.defaultExternalId}`;
  const normalized = scenario === 'missing-quantity' ? 'missing-quantities' : scenario;
  const recipe = (overrides?: Record<string, unknown>) =>
    recipePage(baseStructuredRecipe(config, overrides), '', config.siteLabel);

  switch (normalized as CommonFixtureScenario) {
    case 'search-valid':
      return {
        statusCode: 200,
        contentType: 'application/json',
        bodyText: JSON.stringify({
          results: [
            {
              externalId: config.defaultExternalId,
              title: config.defaultTitle,
              shortDescription: 'Fixture card',
              sourceUrl: recipeUrl,
            },
            ...(config.searchExtra ?? []),
          ],
        }),
      };
    case 'recipe-valid-structured':
    case 'recipe-valid-jsonld':
    case 'duplicate-payload':
    case 'missing-nutrition':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe(normalized === 'missing-nutrition' ? { nutrition: undefined } : {}),
      };
    case 'changed-payload':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({
          name: `${config.defaultTitle} (обновлённый fixture)`,
          recipeIngredient: ['курица — 220 г', 'гречка — 80 г'],
        }),
      };
    case 'recipe-dom-fallback':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: `<!doctype html><html><body>
<article data-recipe-id="synthetic-dom-fallback" data-title="DOM fallback fixture" data-servings="2">
<ul data-ingredients>
<li data-name="курица" data-amount="200" data-unit="г"></li>
<li data-name="гречка" data-amount="80" data-unit="г"></li>
</ul>
<ol data-steps><li>Подготовить</li><li>Приготовить</li></ol>
</article></body></html>`,
      };
    case 'missing-quantities':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['курица', 'гречка'] }),
      };
    case 'ingredient-to-taste':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['соль — по вкусу', 'курица — 200 г'] }),
      };
    case 'fractional-quantity':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['масло — 1/2 ч. л.'] }),
      };
    case 'quantity-range':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['лук — 2-4 шт'] }),
      };
    case 'unknown-unit':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['зелень — 1 пучок'] }),
      };
    case 'ambiguous-product':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['масло — 10 г'] }),
      };
    case 'unknown-product':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeIngredient: ['xyz-unknown-ingredient — 10 г'] }),
      };
    case 'missing-servings':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipe({ recipeYield: undefined }),
      };
    case 'removed-recipe':
      return { statusCode: 404, contentType: 'text/html', bodyText: '<html><body>removed</body></html>' };
    case 'access-denied':
      return { statusCode: 403, contentType: 'text/html', bodyText: '<html><body>denied</body></html>' };
    case 'rate-limited':
      return { statusCode: 429, contentType: 'application/json', bodyText: '{"error":"rate"}' };
    case 'parser-incompatible':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: '<html><body><div>no recipe schema</div></body></html>',
      };
    case 'malicious-script':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(
          baseStructuredRecipe(config, { name: 'Safe title<script>alert(1)</script>' }),
          '<img src=x onerror="alert(1)">',
          config.siteLabel,
        ),
      };
    case 'oversized-response':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: 'x'.repeat(2_000_001),
      };
    case 'foreign-redirect':
      return {
        statusCode: 302,
        contentType: 'text/html',
        bodyText: 'redirect',
        finalUrl: `https://${config.foreignRedirectHost}/phish`,
      };
    case 'parity-dish':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(config.parityRecipe, '', config.siteLabel),
      };
    default:
      throw new Error(`${config.sourceCode.toUpperCase()}_FIXTURE_UNKNOWN`);
  }
}

export const COMMON_FIXTURE_SCENARIOS: readonly CommonFixtureScenario[] = [
  'search-valid',
  'recipe-valid-structured',
  'recipe-dom-fallback',
  'missing-quantity',
  'ingredient-to-taste',
  'fractional-quantity',
  'quantity-range',
  'unknown-unit',
  'ambiguous-product',
  'unknown-product',
  'missing-servings',
  'missing-nutrition',
  'removed-recipe',
  'access-denied',
  'rate-limited',
  'parser-incompatible',
  'malicious-script',
  'duplicate-payload',
  'changed-payload',
  'parity-dish',
] as const;
