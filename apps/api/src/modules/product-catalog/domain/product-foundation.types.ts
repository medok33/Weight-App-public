/** RP2-01A canonical product foundation domain types. */

export const PRODUCT_FORMS = [
  'RAW',
  'DRY',
  'BOILED',
  'BAKED',
  'FRIED',
  'STEWED',
  'FROZEN',
  'CANNED',
  'DRAINED',
  'READY_TO_EAT',
] as const;

export type ProductFormCode = (typeof PRODUCT_FORMS)[number];

export const PRODUCT_DEFAULT_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'tsp',
  'tbsp',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
  'PIECE',
  'TEASPOON',
  'TABLESPOON',
] as const;

export type ProductDefaultUnit = (typeof PRODUCT_DEFAULT_UNITS)[number];

export type ProductNutritionSnapshot = {
  calories: number;
  protein: number;
  fat: number;
  carbohydrate: number;
  fiber: number | null;
  sodium: number | null;
  version: number | null;
  source: string | null;
  status: 'CURRENT_VERSION' | 'UNVERSIONED_LEGACY' | 'MISSING';
};

export type AliasResolveKind = 'EXACT' | 'UNIQUE_NORMALIZED_MATCH' | 'AMBIGUOUS' | 'NOT_FOUND';

export type AliasResolveResult = {
  kind: AliasResolveKind;
  productIds: string[];
  normalizedAlias: string;
};

export type ProductRestrictionSnapshot = {
  productId: string;
  allergenCodes: string[];
  /** Legacy-compatible codes used by STEP_093 hard filters (dairy, egg, peanut, …). */
  allergenLegacyCodes: string[];
  dietaryTagCodes: string[];
  allergenPresenceKnown: boolean;
};

export type UnitConversionResult =
  | { ok: true; grams: number }
  | { ok: false; reason: 'CONVERSION_UNAVAILABLE' | 'UNIT_UNSUPPORTED' | 'AMOUNT_INVALID' };
