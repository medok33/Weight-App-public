/** Stable meal keys stored in DB / returned by API. Display names live in web i18n. */
export const MEAL_KEYS = [
  'greek_yogurt',
  'garden_salad',
  'vegetable_soup',
  'egg_scramble',
  'oatmeal_bowl',
  'whole_grain_pasta',
  'baked_fish',
  'grilled_chicken_bowl',
  'protein_power_bowl',
] as const;

export type MealKey = (typeof MEAL_KEYS)[number];

const LEGACY_MEAL_NAMES: Record<string, MealKey> = {
  'Greek yogurt': 'greek_yogurt',
  'Garden salad': 'garden_salad',
  'Vegetable soup': 'vegetable_soup',
  'Egg scramble': 'egg_scramble',
  'Oatmeal bowl': 'oatmeal_bowl',
  'Whole-grain pasta': 'whole_grain_pasta',
  'Baked fish': 'baked_fish',
  'Grilled chicken bowl': 'grilled_chicken_bowl',
  'Protein power bowl': 'protein_power_bowl',
};

export function stripMealContextPrefix(name: string): string {
  return name.replace(/^\[(?:travel|holiday|shift)\]\s*/, '');
}

export function normalizeMealKey(name: string): string {
  const clean = stripMealContextPrefix(name);
  return LEGACY_MEAL_NAMES[clean] ?? clean;
}
