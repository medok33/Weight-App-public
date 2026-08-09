/** STEP_212 Recipe editorial data classification (not price dataClass). */

export const RECIPE_DATA_CLASSES = [
  'PRODUCTION',
  'TEST_ONLY',
  'FIXTURE',
  'HISTORICAL_ONLY',
  'LEGACY',
  'ARCHIVED_DATA',
] as const;

export type RecipeDataClass = (typeof RECIPE_DATA_CLASSES)[number];

/** Default admin catalog filter: production editorial only. */
export const DEFAULT_RECIPE_CATALOG_DATA_CLASSES: readonly RecipeDataClass[] = ['PRODUCTION'];

const TEST_RECIPE_KEY = /^(cust_|hist_|rp2|rp202|csv_|clone_|e2e_|test_)/i;
const HISTORICAL_RECIPE_KEY = /^hist_/i;
const FIXTURE_RECIPE_KEY = /(fixture|step092|step093)/i;

/** SQL fragment: recipeKey patterns that must never count as PRODUCTION metrics. */
export const RECIPE_TEST_KEY_SQL =
  `(lower(COALESCE("recipeKey", '')) ~ '^(cust_|hist_|rp2|rp202|csv_|clone_|e2e_|test_)' OR lower(COALESCE("recipeKey", '')) LIKE '%_e2e_%' OR lower(COALESCE("recipeKey", '')) LIKE '%_test_%')`;

export function isRecipeDataClass(value: unknown): value is RecipeDataClass {
  return typeof value === 'string' && (RECIPE_DATA_CLASSES as readonly string[]).includes(value);
}

/**
 * Prefer stored dataClass; but a mistaken PRODUCTION default never overrides a clear
 * test/historical/fixture recipeKey or provenance (guards DB pollution from PG tests).
 */
export function resolveRecipeDataClass(input: {
  dataClass?: string | null;
  recipeKey?: string | null;
  provenance?: string | null;
}): RecipeDataClass {
  const derivedFromKey = deriveFromKeyAndProvenance(input.recipeKey, input.provenance);
  if (isRecipeDataClass(input.dataClass)) {
    if (input.dataClass === 'PRODUCTION' && derivedFromKey !== 'PRODUCTION') {
      return derivedFromKey;
    }
    return input.dataClass;
  }
  return derivedFromKey;
}

function deriveFromKeyAndProvenance(
  recipeKey?: string | null,
  provenance?: string | null,
): RecipeDataClass {
  const key = recipeKey?.trim() ?? '';
  if (key && HISTORICAL_RECIPE_KEY.test(key)) return 'HISTORICAL_ONLY';
  if (key && FIXTURE_RECIPE_KEY.test(key)) return 'FIXTURE';
  if (key && TEST_RECIPE_KEY.test(key)) return 'TEST_ONLY';
  const provenanceNorm = (provenance ?? '').toLowerCase();
  if (provenanceNorm.includes('fixture')) return 'FIXTURE';
  if (provenanceNorm.includes('e2e') || provenanceNorm.includes('test')) return 'TEST_ONLY';
  if (provenanceNorm.includes('legacy') || provenanceNorm.includes('backfill')) return 'LEGACY';
  return 'PRODUCTION';
}

/** Suggested reclassification target for repair tooling (never uses display name). */
export function suggestRecipeDataClassRepair(input: {
  dataClass?: string | null;
  recipeKey?: string | null;
  provenance?: string | null;
}): { current: RecipeDataClass; suggested: RecipeDataClass; shouldRepair: boolean; reason: string | null } {
  const current = isRecipeDataClass(input.dataClass) ? input.dataClass : 'PRODUCTION';
  const suggested = resolveRecipeDataClass(input);
  if (current === suggested) {
    return { current, suggested, shouldRepair: false, reason: null };
  }
  if (current !== 'PRODUCTION') {
    // Do not auto-demote explicit non-production classes.
    return { current, suggested: current, shouldRepair: false, reason: 'AMBIGUOUS_NON_PRODUCTION' };
  }
  return {
    current,
    suggested,
    shouldRepair: true,
    reason: `KEY_OR_PROVENANCE_${suggested}`,
  };
}

export function isProductionEditorialRecipe(dataClass: RecipeDataClass | string | null | undefined): boolean {
  return resolveRecipeDataClass({ dataClass: dataClass ?? null }) === 'PRODUCTION';
}

/** Exclude from production coverage / search / default admin list. */
export function isNonProductionRecipeDataClass(
  dataClass: RecipeDataClass | string | null | undefined,
): boolean {
  const resolved = resolveRecipeDataClass({ dataClass: dataClass ?? null });
  return resolved !== 'PRODUCTION';
}

export function parseRecipeDataClassFilter(
  raw: string | null | undefined,
  options?: { defaultProductionOnly?: boolean },
): RecipeDataClass[] | null {
  const defaultProductionOnly = options?.defaultProductionOnly !== false;
  if (raw == null || String(raw).trim() === '') {
    return defaultProductionOnly ? [...DEFAULT_RECIPE_CATALOG_DATA_CLASSES] : null;
  }
  const token = String(raw).trim().toUpperCase();
  if (token === 'ALL' || token === '*') return null;
  const parts = token
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: RecipeDataClass[] = [];
  for (const part of parts) {
    if (!isRecipeDataClass(part)) {
      throw new Error('RECIPE_DATA_CLASS_FILTER_INVALID');
    }
    out.push(part);
  }
  return out.length ? out : defaultProductionOnly ? [...DEFAULT_RECIPE_CATALOG_DATA_CLASSES] : null;
}

export function recipeDataClassLabelRu(dataClass: RecipeDataClass): string {
  switch (dataClass) {
    case 'PRODUCTION':
      return 'Рабочий рецепт';
    case 'TEST_ONLY':
      return 'Тестовый рецепт';
    case 'FIXTURE':
      return 'Тестовые данные';
    case 'HISTORICAL_ONLY':
      return 'Историческая запись';
    case 'LEGACY':
      return 'Устаревшая запись';
    case 'ARCHIVED_DATA':
      return 'Архивные данные';
    default:
      return dataClass;
  }
}
