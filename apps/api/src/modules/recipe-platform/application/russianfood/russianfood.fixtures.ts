/** STEP_215C — RussianFood synthetic fixtures. No real pages, cookies, or images. */

import {
  resolveCommonFixture,
  type FixtureSiteConfig,
} from '../shared/synthetic-fixture.factory';

export const RUSSIANFOOD_SOURCE_CODE = 'russianfood' as const;
export const RUSSIANFOOD_PARSER_VERSION = 'russianfood/v1' as const;

const CONFIG: FixtureSiteConfig = {
  siteLabel: 'RussianFood synthetic',
  sourceCode: RUSSIANFOOD_SOURCE_CODE,
  hostname: 'www.russianfood.com',
  recipePathPrefix: '/recipes/recipe.php?rid=',
  defaultExternalId: 'synthetic-chicken-buckwheat',
  defaultTitle: 'Синтетический салат с курицей (RussianFood)',
  foreignRedirectHost: 'evil.example',
  // Good ingredients + quantity range + missing servings
  parityRecipe: {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    identifier: 'parity-chicken-buckwheat-salad',
    name: 'Синтетический салат курица-гречка',
    description: 'Parity fixture RussianFood — range quantity, no servings',
    recipeIngredient: [
      'курица — 180-220 г',
      'гречка — 80 г',
      'огурец — 1 шт',
      'соль — по вкусу',
    ],
    recipeInstructions: [
      { '@type': 'HowToStep', position: 1, text: 'Нарезать ингредиенты' },
      { '@type': 'HowToStep', position: 2, text: 'Смешать и посолить' },
    ],
    recipeCategory: ['SALAD'],
    cookingMethod: 'raw',
  },
};

export function resolveRussianFoodFixture(scenario: string) {
  // Override recipe URLs in search results for query-param style paths.
  const result = resolveCommonFixture(scenario, {
    ...CONFIG,
    recipePathPrefix: '/recipes', // used only for defaultExternalId join in factory search URL
  });
  if (scenario === 'search-valid') {
    return {
      statusCode: 200,
      contentType: 'application/json',
      bodyText: JSON.stringify({
        results: [
          {
            externalId: CONFIG.defaultExternalId,
            title: CONFIG.defaultTitle,
            shortDescription: 'Fixture card',
            sourceUrl: `https://www.russianfood.com/recipes/recipe.php?rid=${CONFIG.defaultExternalId}`,
          },
        ],
      }),
    };
  }
  return result;
}
