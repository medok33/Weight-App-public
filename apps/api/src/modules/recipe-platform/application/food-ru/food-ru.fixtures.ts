/** STEP_215B — synthetic Food.ru fixtures. No real pages, cookies, or images. */

export type FoodRuFixtureScenario =
  | 'search-valid'
  | 'recipe-valid-jsonld'
  | 'recipe-dom-fallback'
  | 'missing-quantities'
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
  | 'recipe-valid-structured'
  | 'parity-dish';

export const FOOD_RU_FIXTURE_SCENARIOS: readonly FoodRuFixtureScenario[] = [
  'search-valid',
  'recipe-valid-jsonld',
  'recipe-valid-structured',
  'recipe-dom-fallback',
  'missing-quantities',
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
  'oversized-response',
  'foreign-redirect',
  'duplicate-payload',
  'changed-payload',
  'parity-dish',
] as const;

function recipePage(jsonLd: Record<string, unknown>, extraHtml = ''): string {
  return `<!doctype html><html><head><title>Synthetic Food.ru fixture</title>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body><article data-recipe-id="${String(jsonLd.identifier ?? 'synthetic-1')}">${extraHtml}</article></body></html>`;
}

function baseRecipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    identifier: 'synthetic-chicken-buckwheat',
    name: 'Синтетический салат с курицей',
    description: 'Минимальный synthetic fixture для контрактных тестов',
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

export function resolveFoodRuFixture(scenario: string): {
  statusCode: number;
  contentType: string;
  bodyText: string;
  finalUrl?: string;
} {
  switch (scenario as FoodRuFixtureScenario) {
    case 'search-valid':
      return {
        statusCode: 200,
        contentType: 'application/json',
        bodyText: JSON.stringify({
          results: [
            {
              externalId: 'synthetic-chicken-buckwheat',
              title: 'Синтетический салат с курицей',
              shortDescription: 'Fixture card',
              sourceUrl: 'https://food.ru/recipes/synthetic-chicken-buckwheat',
            },
          ],
        }),
      };
    case 'recipe-valid-jsonld':
    case 'recipe-valid-structured':
    case 'duplicate-payload':
    case 'missing-nutrition':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(
          baseRecipe(scenario === 'missing-nutrition' ? { nutrition: undefined } : {}),
        ),
      };
    case 'parity-dish':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(
          baseRecipe({
            identifier: 'parity-chicken-buckwheat-salad',
            name: 'Синтетический салат курица-гречка',
            description: 'Parity fixture Food.ru — good quantities, incomplete time, detailed steps',
            recipeIngredient: ['курица — 200 г', 'гречка — 80 г', 'огурец — 1 шт', 'зелень — 10 г'],
            recipeInstructions: [
              { '@type': 'HowToStep', position: 1, text: 'Отварить курицу до готовности' },
              { '@type': 'HowToStep', position: 2, text: 'Отварить гречку отдельно' },
              { '@type': 'HowToStep', position: 3, text: 'Нарезать огурец и зелень' },
              { '@type': 'HowToStep', position: 4, text: 'Смешать все ингредиенты' },
            ],
            recipeYield: '2',
            prepTime: undefined,
            cookTime: undefined,
            totalTime: undefined,
            nutrition: undefined,
          }),
        ),
      };
    case 'changed-payload':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(
          baseRecipe({
            name: 'Синтетический салат с курицей (обновлённый fixture)',
            recipeIngredient: ['курица — 220 г', 'гречка — 80 г'],
          }),
        ),
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
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['курица', 'гречка'] })),
      };
    case 'ingredient-to-taste':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['соль — по вкусу', 'курица — 200 г'] })),
      };
    case 'fractional-quantity':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['масло — 1/2 ч. л.'] })),
      };
    case 'quantity-range':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['лук — 2-4 шт'] })),
      };
    case 'unknown-unit':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['зелень — 1 пучок'] })),
      };
    case 'ambiguous-product':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['масло — 10 г'] })),
      };
    case 'unknown-product':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeIngredient: ['xyz-unknown-ingredient — 10 г'] })),
      };
    case 'missing-servings':
      return {
        statusCode: 200,
        contentType: 'text/html',
        bodyText: recipePage(baseRecipe({ recipeYield: undefined })),
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
        bodyText: recipePage(baseRecipe({ name: 'Safe title<script>alert(1)</script>' }), '<img src=x onerror="alert(1)">'),
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
        finalUrl: 'https://evil.example/phish',
      };
    default:
      throw new Error('FOOD_RU_FIXTURE_UNKNOWN');
  }
}
