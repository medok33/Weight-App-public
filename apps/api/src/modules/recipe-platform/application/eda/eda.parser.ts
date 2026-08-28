import { candidateFromJsonLd, extractJsonLdRecipes, type CandidateParseIdentity } from '../shared/source-html-parse.utils';
import type { SourceRecipeCandidatePayload } from '../../domain/recipe-source-adapter.contract';
import { canonicalizeEdaUrl } from '../../domain/recipe-source-network.policy';

export const EDA_SOURCE_CODE = 'eda';
export const EDA_PARSER_VERSION = 'eda/jsonld-v1';

const identity: CandidateParseIdentity = { sourceCode: EDA_SOURCE_CODE, parserVersion: EDA_PARSER_VERSION, canonicalizeUrl: canonicalizeEdaUrl, extractExternalId: (url) => url.match(/-(\d+)(?:\/?$)/)?.[1] ?? 'unknown' };

export function extractEdaSitemapUrls(xml: string, limit = 50): string[] {
  const out: string[] = [];
  const re = /<loc>\s*(https:\/\/eda\.rambler\.ru\/recepty\/[^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < Math.min(Math.max(limit, 1), 100)) {
    try { const url = canonicalizeEdaUrl(m[1]!); if (!out.includes(url)) out.push(url); } catch { /* policy rejects */ }
  }
  return out;
}

export function extractEdaSitemapChildUrls(xml: string, limit = 5): string[] {
  const out: string[] = [];
  const re = /<loc>\s*(https:\/\/eda\.rambler\.ru\/[^<]+\.xml(?:\.gz)?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < Math.min(Math.max(limit, 1), 10)) { try { const url = `https://eda.rambler.ru${new URL(m[1]!).pathname}`; if (!out.includes(url)) out.push(url); } catch { /* ignore */ } }
  return out;
}

export function parseEdaHtml(input: { bodyText: string | Uint8Array; sourceUrl: string; statusCode: number; retrievedAt?: string }): SourceRecipeCandidatePayload {
  if (input.statusCode >= 400) throw new Error(`EDA_HTTP_${input.statusCode}`);
  const body = typeof input.bodyText === 'string' ? input.bodyText : new TextDecoder().decode(input.bodyText);
  const recipe = extractJsonLdRecipes(body)[0];
  if (!recipe) throw new Error('EDA_RECIPE_JSONLD_NOT_FOUND');
  const candidate = candidateFromJsonLd(recipe, input.sourceUrl, identity, ['SOURCE_NUTRITION_UNTRUSTED']);
  candidate.fetchedAt = input.retrievedAt ?? new Date().toISOString();
  return candidate;
}

export function extractEdaListingUrls(html: string, limit = 30): string[] {
  const out: string[] = [];
  const re = /href=["']([^"']*\/recepty\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < Math.min(Math.max(limit, 1), 50)) {
    try { const url = canonicalizeEdaUrl(m[1]!.startsWith('http') ? m[1]! : `https://eda.rambler.ru${m[1]!}`); if (!out.includes(url)) out.push(url); } catch { /* ignore */ }
  }
  return out;
}
