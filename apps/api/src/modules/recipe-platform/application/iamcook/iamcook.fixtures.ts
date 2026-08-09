/** STEP_215C — IamCook synthetic fixtures. No real pages, cookies, or images. */

import {
  resolveCommonFixture,
  type FixtureSiteConfig,
} from '../shared/synthetic-fixture.factory';

export const IAMCOOK_SOURCE_CODE = 'iamcook' as const;
export const IAMCOOK_PARSER_VERSION = 'iamcook/v1' as const;

const CONFIG: FixtureSiteConfig = {
  siteLabel: 'IamCook synthetic',
  sourceCode: IAMCOOK_SOURCE_CODE,
  hostname: 'www.iamcook.ru',
  recipePathPrefix: '/recipe',
  defaultExternalId: 'synthetic-chicken-buckwheat',
  defaultTitle: 'Синтетический салат с курицей (IamCook)',
  foreignRedirectHost: 'evil.example',
  // Exact times + ambiguous unit + declared nutrition
  parityRecipe: {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    identifier: 'parity-chicken-buckwheat-salad',
    name: 'Синтетический салат курица-гречка',
    description: 'Parity fixture IamCook — exact time, ambiguous unit, declared nutrition',
    recipeIngredient: ['курица — 200 г', 'масло — 1 столовая ложка', 'гречка — 80 г'],
    recipeInstructions: [
      { '@type': 'HowToStep', position: 1, text: 'Отварить гречку' },
      { '@type': 'HowToStep', position: 2, text: 'Смешать с курицей' },
    ],
    recipeYield: '2',
    prepTime: 'PT10M',
    cookTime: 'PT15M',
    totalTime: 'PT25M',
    recipeCategory: ['MAIN'],
    cookingMethod: 'stove',
    nutrition: {
      '@type': 'NutritionInformation',
      calories: '380 kcal',
      proteinContent: '28 g',
      fatContent: '12 g',
      carbohydrateContent: '32 g',
    },
  },
};

export function resolveIamCookFixture(scenario: string) {
  return resolveCommonFixture(scenario, CONFIG);
}
