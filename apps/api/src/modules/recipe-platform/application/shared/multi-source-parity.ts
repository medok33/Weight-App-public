/** STEP_215C — deterministic multi-source adapter contract parity validator. */

import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../../domain/recipe-external-source.policy';
import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import { FoodRuSourceAdapter } from '../food-ru/food-ru-source.adapter';
import { IamCookSourceAdapter } from '../iamcook/iamcook-source.adapter';
import { RussianFoodSourceAdapter } from '../russianfood/russianfood-source.adapter';
import { assertCanonicalCandidateShape, CANONICAL_CANDIDATE_KEYS } from './source-html-parse.utils';

const PARITY_EXTERNAL_ID = 'parity-chicken-buckwheat-salad';

function fixtureCtx(sourceCode: string, adapterType: string, parserVersion: string) {
  return {
    sourceId: `src-${sourceCode}`,
    sourceCode,
    adapterType,
    parserVersion,
    collectionMode: 'CONTROLLED_HTML_RESEARCH',
    correlationId: 'parity-215c',
    actorUserId: 'owner-1',
    allowlistedHostnames: [],
    requestTimeoutMs: 5000,
    rateLimitPerMinute: 10,
    testMode: true,
  };
}

export type MultiSourceParityReport = {
  ok: boolean;
  contractVersion: typeof RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION;
  requiredKeys: readonly string[];
  sources: Array<{
    sourceCode: string;
    adapterType: string;
    parserVersion: string;
    missingKeys: string[];
    nutritionTrust: string | null;
    warnings: string[];
    completeness: string;
    servings: number | null;
    totalTime: number | null;
    ingredientCount: number;
    stepCount: number;
    payloadChecksum: string | null;
    identityChecksum: string | null;
    externalId: string;
  }>;
  crossSourceIdentityDistinct: boolean;
  sameContractVersion: boolean;
  networkCalls: 0;
};

export async function validateMultiSourceFixtureParity(): Promise<MultiSourceParityReport> {
  const foodRu = new FoodRuSourceAdapter();
  const iamcook = new IamCookSourceAdapter();
  const russianfood = new RussianFoodSourceAdapter();

  const payloads: SourceRecipeCandidatePayload[] = [
    await foodRu.fetchCandidate(
      PARITY_EXTERNAL_ID,
      fixtureCtx('food_ru', 'FOOD_RU', foodRu.parserVersion),
    ),
    await iamcook.fetchCandidate(
      PARITY_EXTERNAL_ID,
      fixtureCtx('iamcook', 'IAMCOOK', iamcook.parserVersion),
    ),
    await russianfood.fetchCandidate(
      PARITY_EXTERNAL_ID,
      fixtureCtx('russianfood', 'RUSSIANFOOD', russianfood.parserVersion),
    ),
  ];

  const sources = payloads.map((p) => ({
    sourceCode: p.sourceCode,
    adapterType:
      p.sourceCode === 'food_ru' ? 'FOOD_RU' : p.sourceCode === 'iamcook' ? 'IAMCOOK' : 'RUSSIANFOOD',
    parserVersion: p.parserVersion,
    missingKeys: assertCanonicalCandidateShape(p),
    nutritionTrust:
      p.sourceNutrition && typeof p.sourceNutrition === 'object'
        ? String((p.sourceNutrition as { trust?: string }).trust ?? null)
        : null,
    warnings: [...p.warnings],
    completeness: p.completeness,
    servings: p.servings,
    totalTime: p.totalTime ?? null,
    ingredientCount: p.ingredients.length,
    stepCount: p.steps.length,
    payloadChecksum: p.payloadChecksum ?? null,
    identityChecksum: p.identityChecksum ?? null,
    externalId: p.externalId,
  }));

  const identities = new Set(sources.map((s) => s.identityChecksum));
  const sameContractVersion = payloads.every(
    (p) => p.contractVersion === RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
  );
  const ok =
    sources.every((s) => s.missingKeys.length === 0) &&
    identities.size === 3 &&
    sameContractVersion &&
    sources.every((s) => s.externalId === PARITY_EXTERNAL_ID);

  return {
    ok,
    contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
    requiredKeys: CANONICAL_CANDIDATE_KEYS,
    sources,
    crossSourceIdentityDistinct: identities.size === 3,
    sameContractVersion,
    networkCalls: 0,
  };
}
