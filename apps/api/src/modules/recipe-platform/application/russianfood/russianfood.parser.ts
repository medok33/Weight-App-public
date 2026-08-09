/** STEP_215C — RussianFood parser (JSON-LD first, DOM fallback). Synthetic fixtures only. */

import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import {
  canonicalizeRussianFoodUrl,
  extractRussianFoodExternalId,
} from '../../domain/recipe-source-network.policy';
import {
  parseCandidateHtml,
  parseSearchResultJson,
} from '../shared/source-html-parse.utils';
import {
  RUSSIANFOOD_PARSER_VERSION,
  RUSSIANFOOD_SOURCE_CODE,
} from './russianfood.fixtures';

export { RUSSIANFOOD_PARSER_VERSION, RUSSIANFOOD_SOURCE_CODE };

const IDENTITY = {
  sourceCode: RUSSIANFOOD_SOURCE_CODE,
  parserVersion: RUSSIANFOOD_PARSER_VERSION,
  canonicalizeUrl: (url: string) => canonicalizeRussianFoodUrl(url).href,
  extractExternalId: extractRussianFoodExternalId,
};

export function parseRussianFoodCandidateHtml(input: {
  bodyText: string;
  sourceUrl: string;
  statusCode: number;
}): SourceRecipeCandidatePayload {
  return parseCandidateHtml(input, IDENTITY);
}

export function parseRussianFoodSearchJson(bodyText: string) {
  return parseSearchResultJson(bodyText);
}
