import type { MessageKey } from '../../../i18n/types';

/** Mirrors apps/api profile-structure.policy CONTROLLED_* lists. */
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

export const CONTROLLED_DIETARY_CODES = [
  'vegetarian',
  'vegan',
  'gluten_free',
  'lactose_free',
  'pescatarian',
  'high_protein',
  'general',
] as const;

export const CONTROLLED_INTOLERANCE_CODES = [
  'lactose',
  'fructose',
  'histamine',
  'gluten_sensitivity',
] as const;

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

export type ProfileStructureStatus =
  | 'STRUCTURED'
  | 'LEGACY_UNSTRUCTURED'
  | 'MIXED'
  | 'NEEDS_CONFIRMATION';

export function profileAllergenKey(code: string): MessageKey {
  return `profile.allergen.${code}` as MessageKey;
}

export function profileDietaryKey(code: string): MessageKey {
  return `profile.dietary.${code}` as MessageKey;
}

export function profileIntoleranceKey(code: string): MessageKey {
  return `profile.intolerance.${code}` as MessageKey;
}

export function profileEquipmentKey(code: string): MessageKey {
  return `profile.equipment.${code}` as MessageKey;
}

export function toggleCode(list: string[], code: string): string[] {
  return list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
}
