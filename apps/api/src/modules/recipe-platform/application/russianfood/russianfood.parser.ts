/** STEP_215C — RussianFood parser (JSON-LD first, DOM fallback). Synthetic fixtures only. */

import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import {
  canonicalizeRussianFoodUrl,
  extractRussianFoodExternalId,
} from '../../domain/recipe-source-network.policy';
import {
  parseCandidateHtml,
  parseSearchResultJson,
  parseIngredientLine,
  stripTags,
  withSourceChecksums,
} from '../shared/source-html-parse.utils';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../../domain/recipe-external-source.policy';
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

function decodeEntities(value: string): string {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function decodeCp1251(value: string | Uint8Array): string {
  if (typeof value === 'string') return value;
  return new TextDecoder('windows-1251').decode(value);
}

function cleanHtml(value: string): string {
  return decodeEntities(value.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ''));
}

function blockTexts(block: string): string[] {
  const out: string[] = [];
  const re = /<(?:tr|td|li|p|div)[^>]*>([\s\S]*?)<\/(?:tr|td|li|p|div)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const text = stripTags(m[1] ?? '').trim();
    if (text && !/^(реклама|ингредиенты)$/i.test(text)) out.push(text);
  }
  return out;
}

/** Parse RussianFood HTML, including legacy cp1251 pages, without JSON assumptions. */
export function parseRussianFoodHtml(input: { bodyText: string | Uint8Array; sourceUrl: string; statusCode: number; retrievedAt?: string }) {
  const html = cleanHtml(decodeCp1251(input.bodyText));
  const title = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const ingredientBlock = html.match(/<table\b[^>]*class=["'][^"']*\bingr(?:_block)?\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? '';
  const ingredients = blockTexts(ingredientBlock).map(parseIngredientLine).filter((x) => x.name.length > 1);
  const stepBlock = html;
  const steps: { ordinal: number; text: string; timeMinutes: null }[] = [];
  const stepRe = /<div\b[^>]*class=["'][^"']*step_n\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null; let ordinal = 1;
  while ((m = stepRe.exec(stepBlock))) {
    const text = stripTags(m[1] ?? '').trim();
    if (text) steps.push({ ordinal: ordinal++, text, timeMinutes: null });
  }
  if (!steps.length) {
    const fallback = blockTexts(stepBlock).filter((x) => !/реклама|подпис/i.test(x));
    for (const text of fallback.slice(0, 30)) steps.push({ ordinal: ordinal++, text, timeMinutes: null });
  }
  const portion = stripTags(html.match(/<span\b[^>]*class=["'][^"']*portion\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').match(/\d+/)?.[0];
  const externalId = extractRussianFoodExternalId(input.sourceUrl);
  const warnings = ['SOURCE_NUTRITION_UNTRUSTED'];
  if (!ingredients.length) warnings.push('MISSING_SOURCE_INGREDIENTS');
  if (!steps.length) warnings.push('MISSING_SOURCE_STEPS');
  const payload = {
    sourceCode: RUSSIANFOOD_SOURCE_CODE, externalId, sourceUrl: input.sourceUrl,
    canonicalSourceUrl: canonicalizeRussianFoodUrl(input.sourceUrl).href,
    title: title || `RussianFood ${externalId}`, description: null, ingredients, steps,
    servings: portion ? Number(portion) : null,
    preparationTime: null, cookingTime: null, totalTime: null, temperatures: [], cookingMethods: [],
    sourceNutrition: null, categories: [], mediaReferences: [], availabilityStatus: 'AVAILABLE' as const,
    fetchedAt: input.retrievedAt ?? new Date().toISOString(), parserVersion: RUSSIANFOOD_PARSER_VERSION,
    contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
    completeness: ingredients.length >= 2 && steps.length ? 'FULL' as const : 'PARTIAL' as const, warnings,
  };
  return withSourceChecksums(payload, RUSSIANFOOD_SOURCE_CODE);
}

export function extractRussianFoodListingUrls(bodyText: string, limit = 10): string[] {
  const out: string[] = [];
  const re = /href=["'](https?:\/\/[^"']+|\/recipes\/recipe\.php\?[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyText)) && out.length < Math.min(Math.max(limit, 1), 20)) {
    try {
      const raw = m[1]!.startsWith('http') ? m[1]! : `https://www.russianfood.com${m[1]!}`;
      const canonical = canonicalizeRussianFoodUrl(raw);
      if (canonical.kind === 'recipe' && !out.includes(canonical.href)) out.push(canonical.href);
    } catch { /* ignore unrelated links */ }
  }
  return out;
}

/** Bounded traversal of ordinary same-domain recipe links exposed by an accessible detail page. */
export function extractRussianFoodDetailLinks(bodyText: string, seedUrl: string, limit = 10): string[] {
  const seed = canonicalizeRussianFoodUrl(seedUrl);
  if (seed.kind !== 'recipe') return [];
  return extractRussianFoodListingUrls(bodyText, limit).filter((url) => url !== seed.href).slice(0, Math.min(limit, 10));
}
