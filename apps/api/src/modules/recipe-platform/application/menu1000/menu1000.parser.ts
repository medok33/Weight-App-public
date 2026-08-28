import { candidateFromJsonLd, extractJsonLdRecipes, parseIngredientLine, stripTags, type CandidateParseIdentity } from '../shared/source-html-parse.utils';
import type { SourceRecipeCandidatePayload, SourceRecipeIngredient, SourceRecipeStep } from '../../domain/recipe-source-adapter.contract';
import { canonicalize1000MenuUrl } from '../../domain/recipe-source-network.policy';

export const MENU1000_SOURCE_CODE = '1000menu';
export const MENU1000_PARSER_VERSION = '1000menu/microdata-v1';
const identity: CandidateParseIdentity = { sourceCode: MENU1000_SOURCE_CODE, parserVersion: MENU1000_PARSER_VERSION, canonicalizeUrl: canonicalize1000MenuUrl, extractExternalId: (url) => url.match(/\/cooking\/(\d+)/i)?.[1] ?? 'unknown' };

function attrs(html: string, prop: string): string[] {
  const out: string[] = []; const re = new RegExp(`<[^>]*itemprop=["']${prop}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi'); let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(stripTags(m[1] ?? ''));
  return out.filter(Boolean);
}

export function extract1000MenuListingUrls(html: string, limit = 30): string[] {
  const out: string[] = []; const re = /href=["']([^"']*\/cooking\/\d+-[^"']+)["']/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < Math.min(Math.max(limit, 1), 50)) { try { const url = canonicalize1000MenuUrl(m[1]!.startsWith('http') ? m[1]! : `https://1000.menu${m[1]!}`); if (!out.includes(url)) out.push(url); } catch { /* ignore */ } }
  return out;
}

export function parse1000MenuHtml(input: { bodyText: string | Uint8Array; sourceUrl: string; statusCode: number; retrievedAt?: string }): SourceRecipeCandidatePayload {
  if (input.statusCode >= 400) throw new Error(`1000MENU_HTTP_${input.statusCode}`);
  const body = typeof input.bodyText === 'string' ? input.bodyText : new TextDecoder().decode(input.bodyText);
  const json = extractJsonLdRecipes(body)[0];
  if (json) { const candidate = candidateFromJsonLd(json, input.sourceUrl, identity, ['SOURCE_NUTRITION_UNTRUSTED']); candidate.fetchedAt = input.retrievedAt ?? new Date().toISOString(); return candidate; }
  const ingredients: SourceRecipeIngredient[] = attrs(body, 'recipeIngredient').map(parseIngredientLine);
  const steps: SourceRecipeStep[] = attrs(body, 'recipeInstructions').map((text, index) => ({ ordinal: index + 1, text, timeMinutes: null }));
  const title = stripTags(body.match(/<h1[^>]*>([\s\S]*?)<\//i)?.[1] ?? body.match(/<[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? body.match(/<title[^>]*>([\s\S]*?)<\//i)?.[1] ?? '');
  const externalId = identity.extractExternalId(input.sourceUrl);
  const candidate: SourceRecipeCandidatePayload = { sourceCode: MENU1000_SOURCE_CODE, externalId, sourceUrl: input.sourceUrl, canonicalSourceUrl: canonicalize1000MenuUrl(input.sourceUrl), title, description: null, ingredients, steps, servings: null, preparationTime: null, cookingTime: null, totalTime: null, temperatures: [], cookingMethods: [], sourceNutrition: null, categories: [], mediaReferences: [], availabilityStatus: 'AVAILABLE', fetchedAt: input.retrievedAt ?? new Date().toISOString(), parserVersion: MENU1000_PARSER_VERSION, completeness: ingredients.length && steps.length ? 'PARTIAL' : 'MINIMAL', warnings: ['SOURCE_NUTRITION_UNTRUSTED', 'MICRODATA_FALLBACK'] };
  return candidate;
}
