/** Shared HTML/JSON-LD parsing helpers for fixture-backed source adapters (STEP_215C). */

import { createHash } from 'node:crypto';
import type {
  SourceRecipeCandidatePayload,
  SourceRecipeIngredient,
  SourceRecipeStep,
} from '../../domain/recipe-source-adapter.contract';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../../domain/recipe-external-source.policy';
import { stableJsonChecksum } from '../../domain/recipe-research.policy';

export function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIsoDurationMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

export function parseIngredientLine(line: string): SourceRecipeIngredient {
  const cleaned = stripTags(line);
  const parts = cleaned.split(/\s*[—\-–]\s*/);
  if (parts.length >= 2) {
    const name = parts[0]!.trim();
    const rest = parts.slice(1).join(' ').trim();
    const qty = rest.match(
      /^(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?|\d+\s*\/\s*\d+|по вкусу)\s*(.*)$/i,
    );
    return {
      name,
      amountText: qty?.[1]?.trim() || rest,
      unitText: qty?.[2]?.trim() || null,
      notes: null,
    };
  }
  return { name: cleaned, amountText: null, unitText: null, notes: null };
}

export function extractJsonLdRecipes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const stack = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of stack) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const type = rec['@type'];
        if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) out.push(rec);
      }
    } catch {
      // ignore malformed block
    }
  }
  return out;
}

export function parseSearchResultJson(bodyText: string): Array<{
  externalId: string;
  title: string;
  shortDescription: string | null;
  sourceUrl: string;
}> {
  const parsed = JSON.parse(bodyText) as {
    results?: Array<{
      externalId?: string;
      title?: string;
      shortDescription?: string;
      sourceUrl?: string;
    }>;
  };
  return (parsed.results ?? [])
    .filter((row) => row.externalId && row.title && row.sourceUrl)
    .map((row) => ({
      externalId: String(row.externalId).toLowerCase(),
      title: String(row.title),
      shortDescription: row.shortDescription ? String(row.shortDescription) : null,
      sourceUrl: String(row.sourceUrl),
    }));
}

export function assertHttpStatusForParse(statusCode: number): void {
  if (statusCode === 404) {
    throw Object.assign(new Error('NOT_FOUND'), { availabilityStatus: 'REMOVED' });
  }
  if (statusCode === 403) {
    throw Object.assign(new Error('ACCESS_DENIED'), { availabilityStatus: 'ACCESS_DENIED' });
  }
  if (statusCode === 429) {
    throw Object.assign(new Error('RATE_LIMITED'), { availabilityStatus: 'RATE_LIMITED' });
  }
  if (statusCode >= 500) {
    throw Object.assign(new Error('TEMPORARILY_UNAVAILABLE'), {
      availabilityStatus: 'TEMPORARILY_UNAVAILABLE',
    });
  }
}

export type CandidateParseIdentity = {
  sourceCode: string;
  parserVersion: string;
  canonicalizeUrl: (url: string) => string;
  extractExternalId: (url: string) => string;
};

export function withSourceChecksums(
  payload: SourceRecipeCandidatePayload,
  sourceCode: string,
): SourceRecipeCandidatePayload {
  payload.payloadChecksum = stableJsonChecksum({
    title: payload.title,
    ingredients: payload.ingredients,
    steps: payload.steps,
    servings: payload.servings,
  });
  payload.identityChecksum = createHash('sha256')
    .update(`${sourceCode}:${payload.externalId}`)
    .digest('hex');
  return payload;
}

export function candidateFromJsonLd(
  recipe: Record<string, unknown>,
  sourceUrl: string,
  identity: CandidateParseIdentity,
  extraWarnings: string[] = [],
): SourceRecipeCandidatePayload {
  const externalId = String(
    recipe.identifier ?? identity.extractExternalId(sourceUrl),
  ).toLowerCase();
  const ingredientLines = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient.map((x) => String(x))
    : [];
  const ingredients = ingredientLines.map(parseIngredientLine);
  const instructions = Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [];
  const steps: SourceRecipeStep[] = instructions.map((item, index) => {
    if (typeof item === 'string') return { ordinal: index + 1, text: stripTags(item), timeMinutes: null };
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      return {
        ordinal: Number(rec.position ?? index + 1),
        text: stripTags(String(rec.text ?? '')),
        timeMinutes: null,
      };
    }
    return { ordinal: index + 1, text: '', timeMinutes: null };
  });
  const yieldRaw = recipe.recipeYield;
  let servings: number | null = null;
  if (typeof yieldRaw === 'number' && Number.isFinite(yieldRaw)) servings = yieldRaw;
  if (typeof yieldRaw === 'string') {
    const n = Number(yieldRaw.match(/\d+/)?.[0]);
    servings = Number.isFinite(n) ? n : null;
  }
  const nutrition =
    recipe.nutrition && typeof recipe.nutrition === 'object'
      ? {
          ...(recipe.nutrition as Record<string, unknown>),
          trust: 'UNTRUSTED_SOURCE',
          policy: 'SOURCE_DECLARED',
        }
      : null;
  const title = stripTags(String(recipe.name ?? ''));
  const temperatures = Array.isArray(recipe.temperature)
    ? recipe.temperature.map(String)
    : typeof recipe.temperature === 'string'
      ? [String(recipe.temperature)]
      : [];
  const warnings = [
    'SOURCE_NUTRITION_UNTRUSTED',
    'FIXTURE_TRANSPORT_ONLY',
    ...extraWarnings,
  ];
  if (!nutrition) warnings.push('MISSING_SOURCE_NUTRITION');
  if (servings == null) warnings.push('MISSING_SERVINGS');
  const payload: SourceRecipeCandidatePayload = {
    sourceCode: identity.sourceCode,
    externalId,
    sourceUrl,
    canonicalSourceUrl: identity.canonicalizeUrl(sourceUrl),
    title: title || `Fixture ${externalId}`,
    description: recipe.description ? stripTags(String(recipe.description)) : null,
    ingredients,
    steps,
    servings,
    preparationTime: parseIsoDurationMinutes(recipe.prepTime),
    cookingTime: parseIsoDurationMinutes(recipe.cookTime),
    totalTime: parseIsoDurationMinutes(recipe.totalTime),
    temperatures,
    cookingMethods: recipe.cookingMethod ? [String(recipe.cookingMethod)] : [],
    sourceNutrition: nutrition,
    categories: Array.isArray(recipe.recipeCategory) ? recipe.recipeCategory.map(String) : [],
    mediaReferences: Array.isArray(recipe.image)
      ? recipe.image.map((x) => (typeof x === 'string' ? x : String((x as { url?: string }).url ?? '')))
          .filter(Boolean)
          .map((url) => `meta:${url}`)
      : typeof recipe.image === 'string'
        ? [`meta:${recipe.image}`]
        : [],
    availabilityStatus: 'AVAILABLE',
    fetchedAt: new Date(0).toISOString(),
    parserVersion: identity.parserVersion,
    contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
    completeness: ingredients.length >= 2 && steps.length >= 1 && servings ? 'FULL' : 'PARTIAL',
    warnings,
  };
  return withSourceChecksums(payload, identity.sourceCode);
}

export function candidateFromDomFallback(
  html: string,
  sourceUrl: string,
  identity: CandidateParseIdentity,
): SourceRecipeCandidatePayload | null {
  const idMatch = html.match(/data-recipe-id=["']([^"']+)["']/i);
  const titleMatch = html.match(/data-title=["']([^"']+)["']/i);
  if (!idMatch && !titleMatch) return null;
  const externalId = (idMatch?.[1] ?? identity.extractExternalId(sourceUrl)).toLowerCase();
  const ingredients: SourceRecipeIngredient[] = [];
  const ingRe =
    /data-name=["']([^"']+)["'][^>]*data-amount=["']([^"']*)["'][^>]*data-unit=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = ingRe.exec(html))) {
    ingredients.push({
      name: m[1] ?? '',
      amountText: m[2] || null,
      unitText: m[3] || null,
      notes: null,
    });
  }
  const steps: SourceRecipeStep[] = [];
  const stepsBlock = html.match(/<ol[^>]*data-steps[^>]*>([\s\S]*?)<\/ol>/i)?.[1] ?? '';
  const stepRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let stepOrdinal = 1;
  while ((m = stepRe.exec(stepsBlock))) {
    steps.push({ ordinal: stepOrdinal, text: stripTags(m[1] ?? ''), timeMinutes: null });
    stepOrdinal += 1;
  }
  const servingsRaw = html.match(/data-servings=["']([^"']+)["']/i)?.[1];
  const servings = servingsRaw && Number.isFinite(Number(servingsRaw)) ? Number(servingsRaw) : null;
  return withSourceChecksums(
    {
      sourceCode: identity.sourceCode,
      externalId,
      sourceUrl,
      canonicalSourceUrl: identity.canonicalizeUrl(sourceUrl),
      title: titleMatch?.[1] ?? `Fixture ${externalId}`,
      description: null,
      ingredients,
      steps,
      servings,
      preparationTime: null,
      cookingTime: null,
      totalTime: null,
      temperatures: [],
      cookingMethods: [],
      sourceNutrition: null,
      categories: [],
      mediaReferences: [],
      availabilityStatus: 'AVAILABLE',
      fetchedAt: new Date(0).toISOString(),
      parserVersion: identity.parserVersion,
      contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
      completeness: ingredients.length && steps.length ? 'PARTIAL' : 'MINIMAL',
      warnings: ['DOM_FALLBACK_USED', 'SOURCE_NUTRITION_UNTRUSTED', 'FIXTURE_TRANSPORT_ONLY'],
    },
    identity.sourceCode,
  );
}

export function parseCandidateHtml(
  input: { bodyText: string; sourceUrl: string; statusCode: number },
  identity: CandidateParseIdentity,
): SourceRecipeCandidatePayload {
  assertHttpStatusForParse(input.statusCode);
  const jsonLd = extractJsonLdRecipes(input.bodyText);
  if (jsonLd[0]) return candidateFromJsonLd(jsonLd[0], input.sourceUrl, identity);
  const dom = candidateFromDomFallback(input.bodyText, input.sourceUrl, identity);
  if (dom) return dom;
  throw Object.assign(new Error('PARSER_INCOMPATIBLE'), {
    availabilityStatus: 'PARSER_INCOMPATIBLE',
  });
}

/** Canonical field keys every adapter candidate must expose. */
export const CANONICAL_CANDIDATE_KEYS = [
  'sourceCode',
  'externalId',
  'sourceUrl',
  'canonicalSourceUrl',
  'title',
  'description',
  'ingredients',
  'steps',
  'servings',
  'preparationTime',
  'cookingTime',
  'totalTime',
  'temperatures',
  'cookingMethods',
  'sourceNutrition',
  'categories',
  'mediaReferences',
  'availabilityStatus',
  'fetchedAt',
  'parserVersion',
  'contractVersion',
  'completeness',
  'warnings',
  'payloadChecksum',
  'identityChecksum',
] as const;

export function assertCanonicalCandidateShape(payload: SourceRecipeCandidatePayload): string[] {
  const missing: string[] = [];
  for (const key of CANONICAL_CANDIDATE_KEYS) {
    if (!(key in payload)) missing.push(key);
  }
  return missing;
}
