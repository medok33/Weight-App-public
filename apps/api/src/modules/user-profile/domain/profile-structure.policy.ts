/**
 * Controlled onboarding/profile selections for hard filters (RP2-03C Phase 0).
 * Free-text is optional note only — never source of truth for STEP_211 hard eligibility.
 */

export const PROFILE_STRUCTURE_STATUSES = [
  'STRUCTURED',
  'LEGACY_UNSTRUCTURED',
  'MIXED',
  'NEEDS_CONFIRMATION',
] as const;
export type ProfileStructureStatus = (typeof PROFILE_STRUCTURE_STATUSES)[number];

/** Canonical allergen codes (Allergen dictionary). */
export const CONTROLLED_ALLERGEN_CODES = [
  'milk',
  'eggs',
  'gluten',
  'fish',
  'peanuts',
  'tree_nuts',
  'soy',
  'shellfish',
  'sesame',
  'celery',
  'mustard',
  'sulphites',
] as const;

/** Canonical dietary profile / tag codes. */
export const CONTROLLED_DIETARY_CODES = [
  'vegetarian',
  'vegan',
  'gluten_free',
  'lactose_free',
  'pescatarian',
  'high_protein',
  'general',
] as const;

/** Intolerances are separate from allergens. */
export const CONTROLLED_INTOLERANCE_CODES = [
  'lactose',
  'fructose',
  'histamine',
  'gluten_sensitivity',
] as const;

/** Equipment codes aligned with coverage equipment profiles + microwave. */
export const CONTROLLED_EQUIPMENT_CODES = [
  'BASIC_STOVE',
  'OVEN',
  'MICROWAVE',
  'MULTICOOKER',
  'BLENDER',
  'GRILL',
  'NO_SPECIAL_EQUIPMENT',
] as const;

export type ControlledAllergenCode = (typeof CONTROLLED_ALLERGEN_CODES)[number];
export type ControlledDietaryCode = (typeof CONTROLLED_DIETARY_CODES)[number];
export type ControlledIntoleranceCode = (typeof CONTROLLED_INTOLERANCE_CODES)[number];
export type ControlledEquipmentCode = (typeof CONTROLLED_EQUIPMENT_CODES)[number];

const ALLERGEN_SET = new Set<string>(CONTROLLED_ALLERGEN_CODES);
const DIETARY_SET = new Set<string>(CONTROLLED_DIETARY_CODES);
const INTOLERANCE_SET = new Set<string>(CONTROLLED_INTOLERANCE_CODES);
const EQUIPMENT_SET = new Set<string>(CONTROLLED_EQUIPMENT_CODES);

export function filterControlledCodes(
  values: string[] | null | undefined,
  allowed: Set<string>,
): string[] {
  if (!values?.length) return [];
  return [...new Set(values.map((v) => String(v).trim()).filter((v) => allowed.has(v)))];
}

export function normalizeAllergenCodes(values: string[] | null | undefined): string[] {
  return filterControlledCodes(values, ALLERGEN_SET);
}

export function normalizeDietaryCodes(values: string[] | null | undefined): string[] {
  return filterControlledCodes(
    values?.map((v) => v.toLowerCase().replace(/-/g, '_')),
    DIETARY_SET,
  );
}

export function normalizeIntoleranceCodes(values: string[] | null | undefined): string[] {
  return filterControlledCodes(
    values?.map((v) => v.toLowerCase().replace(/-/g, '_')),
    INTOLERANCE_SET,
  );
}

export function normalizeEquipmentCodes(values: string[] | null | undefined): string[] {
  return filterControlledCodes(
    values?.map((v) => v.toUpperCase().replace(/-/g, '_')),
    EQUIPMENT_SET,
  );
}

/**
 * Limited deterministic legacy mapping — documented, provenance LEGACY_DETERMINISTIC.
 * Never marks profile as OWNER-reviewed / STRUCTURED automatically.
 */
export const LEGACY_DETERMINISTIC_MAP: Record<
  string,
  { kind: 'allergen' | 'dietary' | 'equipment'; code: string }
> = {
  молоко: { kind: 'allergen', code: 'milk' },
  milk: { kind: 'allergen', code: 'milk' },
  яйца: { kind: 'allergen', code: 'eggs' },
  eggs: { kind: 'allergen', code: 'eggs' },
  глютен: { kind: 'allergen', code: 'gluten' },
  gluten: { kind: 'allergen', code: 'gluten' },
  вегетарианство: { kind: 'dietary', code: 'vegetarian' },
  vegetarian: { kind: 'dietary', code: 'vegetarian' },
  веганство: { kind: 'dietary', code: 'vegan' },
  vegan: { kind: 'dietary', code: 'vegan' },
  духовка: { kind: 'equipment', code: 'OVEN' },
  oven: { kind: 'equipment', code: 'OVEN' },
  плита: { kind: 'equipment', code: 'BASIC_STOVE' },
  микроволновка: { kind: 'equipment', code: 'MICROWAVE' },
  microwave: { kind: 'equipment', code: 'MICROWAVE' },
  мультиварка: { kind: 'equipment', code: 'MULTICOOKER' },
  блендер: { kind: 'equipment', code: 'BLENDER' },
  blender: { kind: 'equipment', code: 'BLENDER' },
};

export function suggestLegacyMappings(freeTextParts: string[]): {
  suggestions: Array<{ raw: string; kind: string; code: string; provenance: 'LEGACY_DETERMINISTIC' }>;
  unmatched: string[];
} {
  const suggestions: Array<{
    raw: string;
    kind: string;
    code: string;
    provenance: 'LEGACY_DETERMINISTIC';
  }> = [];
  const unmatched: string[] = [];
  for (const raw of freeTextParts) {
    const key = raw.trim().toLowerCase();
    const hit = LEGACY_DETERMINISTIC_MAP[key];
    if (hit) {
      suggestions.push({ raw, kind: hit.kind, code: hit.code, provenance: 'LEGACY_DETERMINISTIC' });
    } else if (raw.trim()) {
      unmatched.push(raw.trim());
    }
  }
  return { suggestions, unmatched };
}

export function computeProfileStructureStatus(input: {
  hasStructured: boolean;
  hasLegacyText: boolean;
}): ProfileStructureStatus {
  if (input.hasStructured && input.hasLegacyText) return 'MIXED';
  if (input.hasStructured) return 'STRUCTURED';
  if (input.hasLegacyText) return 'LEGACY_UNSTRUCTURED';
  return 'STRUCTURED';
}

/** Hard filters for STEP_211 / meal engines — structured codes only. */
export function hardFilterProfileFromStructured(input: {
  allergenCodes?: string[] | null;
  dietaryCodes?: string[] | null;
  equipmentCodes?: string[] | null;
  intoleranceCodes?: string[] | null;
}): {
  allergens: string[];
  dietary: string[];
  equipment: string[];
  intolerances: string[];
  usesLegacyFreeText: false;
} {
  return {
    allergens: normalizeAllergenCodes(input.allergenCodes),
    dietary: normalizeDietaryCodes(input.dietaryCodes),
    equipment: normalizeEquipmentCodes(input.equipmentCodes),
    intolerances: normalizeIntoleranceCodes(input.intoleranceCodes),
    usesLegacyFreeText: false,
  };
}
