/** STEP_215C — IamCook parser (JSON-LD first, DOM fallback). Synthetic fixtures only. */

import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import {
  canonicalizeIamCookUrl,
  extractIamCookExternalId,
} from '../../domain/recipe-source-network.policy';
import {
  parseCandidateHtml,
  parseSearchResultJson,
} from '../shared/source-html-parse.utils';
import { IAMCOOK_PARSER_VERSION, IAMCOOK_SOURCE_CODE } from './iamcook.fixtures';

export { IAMCOOK_PARSER_VERSION, IAMCOOK_SOURCE_CODE };

const IDENTITY = {
  sourceCode: IAMCOOK_SOURCE_CODE,
  parserVersion: IAMCOOK_PARSER_VERSION,
  canonicalizeUrl: (url: string) => canonicalizeIamCookUrl(url).href,
  extractExternalId: extractIamCookExternalId,
};

export function parseIamCookCandidateHtml(input: {
  bodyText: string;
  sourceUrl: string;
  statusCode: number;
}): SourceRecipeCandidatePayload {
  return parseCandidateHtml(input, IDENTITY);
}

export function parseIamCookSearchJson(bodyText: string) {
  return parseSearchResultJson(bodyText);
}
