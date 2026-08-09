import {
  PRODUCT_DEFAULT_UNITS,
  PRODUCT_FORMS,
  type ProductDefaultUnit,
  type ProductFormCode,
  type UnitConversionResult,
} from './product-foundation.types';

/** Deterministic alias normalization for RU/EN product synonyms (no LLM). */
export function normalizeProductAlias(input: string): string {
  const nfkc = input.normalize('NFKC');
  let value = nfkc.trim().toLowerCase();
  value = value.replace(/ё/g, 'е');
  // Strip common punctuation to spaces.
  value = value.replace(/["""«»„‚''`´.,;:!?\-_/\\|()[\]{}]+/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  if (!value) throw new Error('PRODUCT_ALIAS_INVALID');
  return value;
}

export function assertProductForm(form: string): ProductFormCode {
  if (!(PRODUCT_FORMS as readonly string[]).includes(form)) {
    throw new Error('PRODUCT_FORM_INVALID');
  }
  return form as ProductFormCode;
}

export function assertDefaultUnit(unit: string): ProductDefaultUnit {
  if (!(PRODUCT_DEFAULT_UNITS as readonly string[]).includes(unit)) {
    throw new Error('PRODUCT_DEFAULT_UNIT_INVALID');
  }
  return unit as ProductDefaultUnit;
}

export function validateEdiblePartPercent(value: number | null | undefined): void {
  if (value == null) return;
  if (!(value > 0 && value <= 100)) throw new Error('PRODUCT_EDIBLE_PART_INVALID');
}

export function validateFatPercent(value: number | null | undefined): void {
  if (value == null) return;
  if (!(value >= 0 && value <= 100)) throw new Error('PRODUCT_FAT_PERCENT_INVALID');
}

export function validateDensity(value: number | null | undefined): void {
  if (value == null) return;
  if (!(value > 0)) throw new Error('PRODUCT_DENSITY_INVALID');
}

export function validateYieldCoefficient(value: number | null | undefined): void {
  if (value == null) return;
  if (!(value > 0)) throw new Error('PRODUCT_YIELD_INVALID');
}

export function validateAveragePieceWeightGrams(value: number | null | undefined): void {
  if (value == null) return;
  if (!(value > 0)) throw new Error('PRODUCT_PIECE_WEIGHT_INVALID');
}

/** Reject self-parent and cycles given parent map id → parentId. */
export function assertCategoryHierarchyAcyclic(
  categories: Array<{ id: string; parentId: string | null }>,
  candidateId: string,
  candidateParentId: string | null,
): void {
  if (candidateParentId == null) return;
  if (candidateParentId === candidateId) throw new Error('PRODUCT_CATEGORY_SELF_PARENT');
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  parentOf.set(candidateId, candidateParentId);
  let cursor: string | null = candidateParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === candidateId) throw new Error('PRODUCT_CATEGORY_CYCLE');
    if (seen.has(cursor)) throw new Error('PRODUCT_CATEGORY_CYCLE');
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
}

export function canonicalizeUnitToken(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (['g', 'gram', 'grams', 'гр', 'г'].includes(u)) return 'g';
  if (['kg', 'kilogram', 'килограмм'].includes(u)) return 'kg';
  if (['ml', 'milliliter', 'millilitre', 'мл'].includes(u)) return 'ml';
  if (['l', 'liter', 'litre', 'л'].includes(u)) return 'l';
  if (['piece', 'pcs', 'pc', 'шт'].includes(u)) return 'piece';
  if (['tsp', 'teaspoon', 'ч.л', 'чл'].includes(u)) return 'tsp';
  if (['tbsp', 'tablespoon', 'ст.л', 'стл'].includes(u)) return 'tbsp';
  return u;
}

export function convertToGrams(input: {
  amount: number;
  unit: string;
  density?: number | null;
  averagePieceWeightGrams?: number | null;
}): UnitConversionResult {
  if (!(input.amount > 0)) return { ok: false, reason: 'AMOUNT_INVALID' };
  const unit = canonicalizeUnitToken(input.unit);
  if (unit === 'g') return { ok: true, grams: input.amount };
  if (unit === 'kg') return { ok: true, grams: input.amount * 1000 };
  if (unit === 'ml') {
    if (input.density == null || !(input.density > 0)) return { ok: false, reason: 'CONVERSION_UNAVAILABLE' };
    return { ok: true, grams: input.amount * input.density };
  }
  if (unit === 'l') {
    if (input.density == null || !(input.density > 0)) return { ok: false, reason: 'CONVERSION_UNAVAILABLE' };
    return { ok: true, grams: input.amount * 1000 * input.density };
  }
  if (unit === 'piece') {
    if (input.averagePieceWeightGrams == null || !(input.averagePieceWeightGrams > 0)) {
      return { ok: false, reason: 'CONVERSION_UNAVAILABLE' };
    }
    return { ok: true, grams: input.amount * input.averagePieceWeightGrams };
  }
  if (unit === 'tsp' || unit === 'tbsp') {
    // Volume spoons require density; without density do not guess.
    if (input.density == null || !(input.density > 0)) return { ok: false, reason: 'CONVERSION_UNAVAILABLE' };
    const ml = unit === 'tsp' ? 5 : 15;
    return { ok: true, grams: input.amount * ml * input.density };
  }
  return { ok: false, reason: 'UNIT_UNSUPPORTED' };
}

/** Map canonical allergen codes ↔ STEP_093 legacy filter tokens. */
export function allergenCodeToLegacy(code: string): string[] {
  switch (code) {
    case 'milk':
      return ['milk', 'dairy', 'lactose'];
    case 'eggs':
      return ['eggs', 'egg'];
    case 'peanuts':
      return ['peanuts', 'peanut'];
    case 'tree_nuts':
      return ['tree_nuts', 'nut', 'nuts'];
    default:
      return [code];
  }
}

export function legacyAllergenToCode(token: string): string | null {
  const t = token.trim().toLowerCase();
  if (['dairy', 'milk', 'lactose'].includes(t)) return 'milk';
  if (['egg', 'eggs'].includes(t)) return 'eggs';
  if (['peanut', 'peanuts'].includes(t)) return 'peanuts';
  if (['gluten', 'wheat'].includes(t)) return 'gluten';
  if (['fish'].includes(t)) return 'fish';
  if (['soy', 'soya'].includes(t)) return 'soy';
  if (['shellfish', 'crustacean'].includes(t)) return 'shellfish';
  if (['sesame'].includes(t)) return 'sesame';
  if (['celery'].includes(t)) return 'celery';
  if (['mustard'].includes(t)) return 'mustard';
  if (['sulphite', 'sulphites', 'sulfite'].includes(t)) return 'sulphites';
  if (['nut', 'nuts', 'tree_nut', 'tree_nuts'].includes(t)) return 'tree_nuts';
  return null;
}

export function validateNutritionValues(input: {
  calories: number;
  protein: number;
  fat: number;
  carbohydrate: number;
  fiber?: number | null;
  sodium?: number | null;
}): void {
  for (const [key, value] of Object.entries({
    calories: input.calories,
    protein: input.protein,
    fat: input.fat,
    carbohydrate: input.carbohydrate,
  })) {
    if (!(typeof value === 'number') || Number.isNaN(value) || value < 0) {
      throw new Error(`PRODUCT_NUTRITION_INVALID:${key}`);
    }
  }
  if (input.fiber != null && (!(input.fiber >= 0) || Number.isNaN(input.fiber))) {
    throw new Error('PRODUCT_NUTRITION_INVALID:fiber');
  }
  if (input.sodium != null && (!(input.sodium >= 0) || Number.isNaN(input.sodium))) {
    throw new Error('PRODUCT_NUTRITION_INVALID:sodium');
  }
}

export function assertDietaryTagConflict(tags: string[]): void {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  if (set.has('vegan') && (set.has('pescatarian') || set.has('vegetarian') === false && set.has('meat'))) {
    // vegan implies vegetarian; pescatarian conflicts with vegan
  }
  if (set.has('vegan') && set.has('pescatarian')) throw new Error('PRODUCT_DIETARY_TAG_CONFLICT');
}
