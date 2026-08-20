/** STEP_215C — IamCook parser (JSON-LD first, DOM fallback). Synthetic fixtures only. */

import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import {
  canonicalizeIamCookUrl,
  extractIamCookExternalId,
} from '../../domain/recipe-source-network.policy';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../../domain/recipe-external-source.policy';
import {
  parseCandidateHtml,
  parseSearchResultJson,
  parseIngredientLine,
  stripTags,
  withSourceChecksums,
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

function decodeEntities(value: string): string {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanHtml(value: string): string {
  return decodeEntities(value.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ''));
}

function blockTexts(block: string): string[] {
  const out: string[] = [];
  const re = /<(?:li|p|div)[^>]*>([\s\S]*?)<\/(?:li|p|div)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const text = stripTags(m[1] ?? '').trim();
    if (text && !/^реклама$/i.test(text)) out.push(text);
  }
  return out;
}

/** Parse the server-rendered IamCook page; JSON-LD ingredients are optional. */
export function parseIamCookHtml(input: { bodyText: string; sourceUrl: string; statusCode: number; retrievedAt?: string }) {
  const html = cleanHtml(input.bodyText);
  const title = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const ingredientBlock = html.match(/<div\b[^>]*class=["'][^"']*\bilist\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const ingredients = blockTexts(ingredientBlock).map(parseIngredientLine).filter((x) => x.name.length > 1);
  const instructionsBlock = html.match(/<div\b[^>]*class=["'][^"']*\binstructions\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const steps = blockTexts(instructionsBlock).map((text, index) => ({ ordinal: index + 1, text, timeMinutes: null }));
  const params = stripTags(html.match(/<ul\b[^>]*class=["'][^"']*\bilparams\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? '');
  const servingsMatch = params.match(/(?:порци|выход|servings?)[^\d]{0,30}(\d+)/i);
  const timeMatch = params.match(/(?:время|time)[^\d]{0,30}(\d+)/i);
  const externalId = extractIamCookExternalId(input.sourceUrl);
  const warnings = ['SOURCE_NUTRITION_UNTRUSTED'];
  if (!ingredients.length) warnings.push('MISSING_SOURCE_INGREDIENTS');
  if (!steps.length) warnings.push('MISSING_SOURCE_STEPS');
  const payload = {
    sourceCode: IAMCOOK_SOURCE_CODE, externalId, sourceUrl: input.sourceUrl,
    canonicalSourceUrl: canonicalizeIamCookUrl(input.sourceUrl).href,
    title: title || `IamCook ${externalId}`, description: null, ingredients, steps,
    servings: servingsMatch ? Number(servingsMatch[1]) : null,
    preparationTime: null, cookingTime: timeMatch ? Number(timeMatch[1]) : null, totalTime: null,
    temperatures: [], cookingMethods: [], sourceNutrition: null, categories: [], mediaReferences: [],
    availabilityStatus: 'AVAILABLE' as const, fetchedAt: input.retrievedAt ?? new Date().toISOString(),
    parserVersion: IAMCOOK_PARSER_VERSION, contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
    completeness: ingredients.length >= 2 && steps.length ? 'FULL' as const : 'PARTIAL' as const, warnings,
  };
  return withSourceChecksums(payload, IAMCOOK_SOURCE_CODE);
}

export function extractIamCookListingUrls(bodyText: string, limit = 10): string[] {
  const out: string[] = [];
  const re = /href=["'](https?:\/\/[^"']+|\/(?:recipe\/[^"'#?]+|showrecipe\/\d+))["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyText)) && out.length < Math.min(Math.max(limit, 1), 20)) {
    try {
      const raw = m[1]!.startsWith('http') ? m[1]! : `https://www.iamcook.ru${m[1]!}`;
      const canonical = canonicalizeIamCookUrl(raw);
      if (canonical.kind === 'recipe' && !out.includes(canonical.href)) out.push(canonical.href);
    } catch { /* ignore unrelated links */ }
  }
  return out;
}
