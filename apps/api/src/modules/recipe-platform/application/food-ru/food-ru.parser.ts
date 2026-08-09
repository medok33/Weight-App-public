/** STEP_215B/C — Food.ru parser (JSON-LD first, DOM fallback). Synthetic fixtures only. */

import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import {
  canonicalizeFoodRuUrl,
  extractFoodRuExternalId,
} from '../../domain/recipe-source-network.policy';
import {
  parseCandidateHtml,
  parseSearchResultJson,
} from '../shared/source-html-parse.utils';

export const FOOD_RU_PARSER_VERSION = 'food-ru/v1' as const;
export const FOOD_RU_SOURCE_CODE = 'food_ru' as const;

const IDENTITY = {
  sourceCode: FOOD_RU_SOURCE_CODE,
  parserVersion: FOOD_RU_PARSER_VERSION,
  canonicalizeUrl: (url: string) => canonicalizeFoodRuUrl(url).href,
  extractExternalId: extractFoodRuExternalId,
};

export function parseFoodRuCandidateHtml(input: {
  bodyText: string;
  sourceUrl: string;
  statusCode: number;
}): SourceRecipeCandidatePayload {
  return parseCandidateHtml(input, IDENTITY);
}

export function parseFoodRuSearchJson(bodyText: string) {
  return parseSearchResultJson(bodyText);
}
