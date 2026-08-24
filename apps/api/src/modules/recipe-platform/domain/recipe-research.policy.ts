import { createHash } from 'node:crypto';

export const RECIPE_RESEARCH_NORMALIZATION_VERSION = 'recipe-normalization/v1';
export const RECIPE_RESEARCH_ALLOWED_DECISIONS = ['RESEARCH_REQUIRED', 'CREATE_FAMILY_VARIANT'] as const;

export type RecipeResearchDecisionRecommendation = (typeof RECIPE_RESEARCH_ALLOWED_DECISIONS)[number];
export type RecipeResearchOperation = 'TEST_SEARCH_AND_FETCH' | 'FETCH_CANDIDATE' | 'MANUAL_ENTRY' | 'RETENTION';
export type ReviewFlagType =
  | 'UNKNOWN_PRODUCT'
  | 'AMBIGUOUS_PRODUCT'
  | 'UNKNOWN_UNIT'
  | 'INVALID_QUANTITY'
  | 'LOW_COMPLETENESS'
  | 'SOURCE_NUTRITION_UNTRUSTED';

export type SourceIngredientLike = {
  name: string;
  amountText?: string | null;
  unitText?: string | null;
  notes?: string | null;
};

export type ProductAliasCandidate = {
  productId: string;
  canonicalName: string;
  name: string | null;
  alias: string;
  normalizedAlias: string | null;
  confidence: number;
};

export type IngredientMapping = {
  index: number;
  sourceName: string;
  normalizedName: string;
  productId: string | null;
  productName: string | null;
  matchType: 'EXACT_ALIAS' | 'EXACT_CANONICAL' | 'AMBIGUOUS' | 'UNKNOWN';
  confidence: number;
  quantity: number | null;
  unit: string | null;
  unitStatus: 'KNOWN' | 'UNKNOWN' | 'MISSING';
  quantityStatus: 'VALID' | 'INVALID' | 'MISSING';
  notes: string | null;
};

export type ReviewFlag = {
  type: ReviewFlagType;
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  ingredientIndex?: number;
  sourceValue?: string;
  suggestion?: Record<string, unknown>;
};

const UNIT_ALIASES = new Map<string, string>([
  ['g', 'g'],
  ['гр', 'g'],
  ['г', 'g'],
  ['gram', 'g'],
  ['kg', 'kg'],
  ['кг', 'kg'],
  ['ml', 'ml'],
  ['мл', 'ml'],
  ['l', 'l'],
  ['л', 'l'],
  ['шт', 'pcs'],
  ['штука', 'pcs'],
  ['штуки', 'pcs'],
  ['pcs', 'pcs'],
  ['ч. л.', 'tsp'],
  ['ч л', 'tsp'],
  ['ч.л.', 'tsp'],
  ['чайн л', 'tsp'],
  ['чайн.л.', 'tsp'],
  ['tsp', 'tsp'],
  ['ст. л.', 'tbsp'],
  ['ст л', 'tbsp'],
  ['ст.л.', 'tbsp'],
  ['стол л', 'tbsp'],
  ['стол.л.', 'tbsp'],
  ['tbsp', 'tbsp'],
  ['щепотка', 'pinch'],
  ['pinch', 'pinch'],
  ['по вкусу', 'to_taste'],
]);

export function assertResearchDecisionAllowed(recommendation: string): asserts recommendation is RecipeResearchDecisionRecommendation {
  if (!RECIPE_RESEARCH_ALLOWED_DECISIONS.includes(recommendation as RecipeResearchDecisionRecommendation)) {
    throw new Error('RECIPE_RESEARCH_DECISION_NOT_ALLOWED');
  }
}

export function assertResearchIdempotencyKey(value: string): string {
  const key = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(key)) throw new Error('RECIPE_RESEARCH_IDEMPOTENCY_KEY_INVALID');
  return key;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

export function stableJsonChecksum(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function payloadByteLength(value: unknown): number {
  return Buffer.byteLength(stableJson(value), 'utf8');
}

export function normalizeFoodText(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s.%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseQuantity(value: string | null | undefined): { value: number | null; status: 'VALID' | 'INVALID' | 'MISSING' } {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return { value: null, status: 'MISSING' };
  if (/по вкусу/i.test(raw)) return { value: null, status: 'MISSING' };
  const fraction = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const a = Number(fraction[1]);
    const b = Number(fraction[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return { value: Number((a / b).toFixed(4)), status: 'VALID' };
  }
  const range = raw.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { value: Number(((a + b) / 2).toFixed(4)), status: 'VALID' };
  }
  const direct = raw.match(/\d+(?:\.\d+)?/);
  if (!direct) return { value: null, status: 'INVALID' };
  const n = Number(direct[0]);
  return Number.isFinite(n) ? { value: n, status: 'VALID' } : { value: null, status: 'INVALID' };
}

export function normalizeUnit(value: string | null | undefined): { unit: string | null; status: 'KNOWN' | 'UNKNOWN' | 'MISSING' } {
  const raw = normalizeFoodText(String(value ?? ''));
  if (!raw) return { unit: null, status: 'MISSING' };
  return UNIT_ALIASES.has(raw)
    ? { unit: UNIT_ALIASES.get(raw)!, status: 'KNOWN' }
    : { unit: null, status: 'UNKNOWN' };
}

export function mapIngredients(
  ingredients: SourceIngredientLike[],
  aliases: ProductAliasCandidate[],
): { mappings: IngredientMapping[]; flags: ReviewFlag[] } {
  const byAlias = new Map<string, ProductAliasCandidate[]>();
  for (const alias of aliases) {
    for (const key of [alias.normalizedAlias, alias.alias, alias.canonicalName, alias.name].filter(Boolean)) {
      const normalized = normalizeFoodText(String(key));
      if (!normalized) continue;
      const arr = byAlias.get(normalized) ?? [];
      arr.push(alias);
      byAlias.set(normalized, arr);
    }
  }

  const flags: ReviewFlag[] = [];
  const mappings = ingredients.map((ingredient, index) => {
    const sourceName = String(ingredient.name ?? '').trim();
    const normalizedName = normalizeFoodText(sourceName);
    const matches = dedupeByProduct(byAlias.get(normalizedName) ?? []);
    const qty = parseQuantity(ingredient.amountText);
    const unit = normalizeUnit(ingredient.unitText);
    let matchType: IngredientMapping['matchType'] = 'UNKNOWN';
    let productId: string | null = null;
    let productName: string | null = null;
    let confidence = 0;

    if (matches.length === 1) {
      const match = matches[0]!;
      productId = match.productId;
      productName = match.name ?? match.canonicalName;
      confidence = match.confidence;
      matchType = normalizeFoodText(match.canonicalName) === normalizedName ? 'EXACT_CANONICAL' : 'EXACT_ALIAS';
    } else if (matches.length > 1) {
      matchType = 'AMBIGUOUS';
      confidence = Math.max(...matches.map((m) => m.confidence));
      flags.push({
        type: 'AMBIGUOUS_PRODUCT',
        severity: 'BLOCKER',
        ingredientIndex: index,
        sourceValue: sourceName,
        suggestion: { productIds: matches.slice(0, 5).map((m) => m.productId) },
      });
    } else {
      flags.push({ type: 'UNKNOWN_PRODUCT', severity: 'BLOCKER', ingredientIndex: index, sourceValue: sourceName });
    }
    if (unit.status === 'UNKNOWN') {
      flags.push({ type: 'UNKNOWN_UNIT', severity: 'WARNING', ingredientIndex: index, sourceValue: ingredient.unitText ?? '' });
    }
    if (qty.status === 'INVALID') {
      flags.push({ type: 'INVALID_QUANTITY', severity: 'WARNING', ingredientIndex: index, sourceValue: ingredient.amountText ?? '' });
    }
    return {
      index,
      sourceName,
      normalizedName,
      productId,
      productName,
      matchType,
      confidence,
      quantity: qty.value,
      unit: unit.unit,
      unitStatus: unit.status,
      quantityStatus: qty.status,
      notes: ingredient.notes ?? null,
    };
  });
  return { mappings, flags };
}

export function computeCompleteness(input: {
  title?: string | null;
  ingredients?: unknown[];
  steps?: unknown[];
  servings?: number | null;
  preparationTime?: number | null;
  cookingTime?: number | null;
}): number {
  let score = 0;
  if (String(input.title ?? '').trim()) score += 0.2;
  if ((input.ingredients?.length ?? 0) > 0) score += 0.3;
  if ((input.steps?.length ?? 0) > 0) score += 0.25;
  if (Number(input.servings ?? 0) > 0) score += 0.1;
  if (input.preparationTime != null || input.cookingTime != null) score += 0.1;
  if ((input.ingredients?.length ?? 0) >= 2 && (input.steps?.length ?? 0) >= 2) score += 0.05;
  return Number(Math.min(score, 1).toFixed(4));
}

export function sanitizeManualPayload(body: Record<string, unknown>): Record<string, unknown> {
  const title = String(body.title ?? '').trim();
  if (!title) throw new Error('RECIPE_RESEARCH_MANUAL_TITLE_REQUIRED');
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!ingredients.length) throw new Error('RECIPE_RESEARCH_MANUAL_INGREDIENTS_REQUIRED');
  if (!steps.length) throw new Error('RECIPE_RESEARCH_MANUAL_STEPS_REQUIRED');
  const forbiddenKeys = ['rawHtml', 'html', 'script', 'cookies', 'authorization', 'headers', 'recipeId', 'recipeVersionId', 'productId'];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) throw new Error('RECIPE_RESEARCH_CLIENT_FIELD_FORBIDDEN');
  }
  return {
    sourceCode: 'manual_editorial',
    externalId: String(body.externalId ?? `manual:${stableJsonChecksum({ title, ingredients, steps }).slice(0, 16)}`),
    sourceUrl: body.sourceUrl ? String(body.sourceUrl) : null,
    title,
    description: body.description ? String(body.description) : null,
    ingredients,
    steps,
    servings: body.servings == null ? null : Number(body.servings),
    preparationTime: body.preparationTime == null ? null : Number(body.preparationTime),
    cookingTime: body.cookingTime == null ? null : Number(body.cookingTime),
    temperatures: Array.isArray(body.temperatures) ? body.temperatures.map(String) : [],
    cookingMethods: Array.isArray(body.cookingMethods) ? body.cookingMethods.map(String) : [],
    sourceNutrition: body.sourceNutrition && typeof body.sourceNutrition === 'object' ? body.sourceNutrition : null,
    categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
    mediaReferences: [],
    fetchedAt: new Date().toISOString(),
    parserVersion: 'manual-entry/v1',
    completeness: 'PARTIAL',
    warnings: ['MANUAL_STAGING_ONLY_NOT_RECIPE'],
  };
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, sortStable(val)]),
    );
  }
  return value;
}

function dedupeByProduct(matches: ProductAliasCandidate[]): ProductAliasCandidate[] {
  const map = new Map<string, ProductAliasCandidate>();
  for (const match of matches) {
    const existing = map.get(match.productId);
    if (!existing || match.confidence > existing.confidence) map.set(match.productId, match);
  }
  return [...map.values()];
}
