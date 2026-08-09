export type ContentNamespace = 'meal' | 'workout' | 'product' | 'category' | 'unit' | 'card';

export type ContentDictionaries = Record<ContentNamespace, Record<string, string>>;

/** Legacy English / old keys → stable content keys (for rows already in DB). */
export const CONTENT_ALIASES: Record<ContentNamespace, Record<string, string>> = {
  meal: {
    'Greek yogurt': 'greek_yogurt',
    'Garden salad': 'garden_salad',
    'Vegetable soup': 'vegetable_soup',
    'Egg scramble': 'egg_scramble',
    'Oatmeal bowl': 'oatmeal_bowl',
    'Whole-grain pasta': 'whole_grain_pasta',
    'Baked fish': 'baked_fish',
    'Grilled chicken bowl': 'grilled_chicken_bowl',
    'Protein power bowl': 'protein_power_bowl',
    Meal: 'greek_yogurt',
  },
  workout: {
    'Morning walk': 'morning_walk',
    'Bodyweight squats': 'bodyweight_squats',
    Stretching: 'stretching',
    'Light jog': 'light_jog',
    'Core plank': 'core_plank',
    'Mobility flow': 'mobility_flow',
    'Recovery walk': 'recovery_walk',
    'Push-ups': 'push_ups',
    'Glute bridge': 'glute_bridge',
    'Dead bug': 'dead_bug',
    'Band row': 'band_row',
    'Band pull-apart': 'band_pull_apart',
    'Dumbbell row': 'dumbbell_row',
    'Goblet squat': 'goblet_squat',
    'Machine leg press': 'machine_leg_press',
    'Cable row': 'cable_row',
    'Treadmill walk': 'treadmill_walk',
    Rest: 'rest',
    Exercise: 'morning_walk',
    'Not planned': 'not_planned',
  },
  product: {
    'Greek yogurt': 'greek_yogurt',
    Honey: 'honey',
    Lettuce: 'lettuce',
    Tomato: 'tomato',
    'Olive oil': 'olive_oil',
    Carrot: 'carrot',
    Onion: 'onion',
    Potato: 'potato',
    Eggs: 'eggs',
    Butter: 'butter',
    Oats: 'oats',
    Milk: 'milk',
    'Whole-grain pasta': 'whole_grain_pasta_product',
    'Tomato sauce': 'tomato_sauce',
    'White fish': 'white_fish',
    Lemon: 'lemon',
    'Chicken breast': 'chicken_breast',
    Rice: 'rice',
    Broccoli: 'broccoli',
    Quinoa: 'quinoa',
    Avocado: 'avocado',
    'chicken-breast': 'chicken_breast',
    'greek-yogurt': 'greek_yogurt',
    'olive-oil': 'olive_oil',
    'tomato-sauce': 'tomato_sauce',
    'white-fish': 'white_fish',
    'pantry-staple': 'pantry_staple',
  },
  category: {
    produce: 'vegetables',
  },
  unit: {},
  card: {},
};

/** Normalize dynamic catalog tokens (product names / keys) into snake_case candidates. */
export function normalizeContentToken(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve a stable dictionary key for a content namespace.
 * Never invents translations — only maps aliases / normalized forms.
 */
export function resolveContentKey(namespace: ContentNamespace, raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return trimmed;
  const aliases = CONTENT_ALIASES[namespace];
  if (aliases[trimmed]) return aliases[trimmed];
  const normalized = normalizeContentToken(trimmed);
  if (normalized && aliases[normalized]) return aliases[normalized];
  // Prefer normalized productKey-style tokens when the raw value is a display name.
  if (normalized) return normalized;
  return trimmed;
}

export type ContentLookupDicts = Record<ContentNamespace, Record<string, string>>;

/**
 * Look up a localized content label.
 * Returns null when no dictionary entry exists — callers must fall back to the raw API/display string.
 * Building i18n keys from unbounded product/meal names is unsafe; missing entries must not crash the UI.
 */
export function lookupContentLabel(
  namespace: ContentNamespace,
  raw: string,
  primary: ContentLookupDicts,
  fallback: ContentLookupDicts,
): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  const aliases = CONTENT_ALIASES[namespace];
  const normalized = normalizeContentToken(trimmed);
  const candidates = [
    aliases[trimmed],
    trimmed,
    normalized,
    normalized ? aliases[normalized] : undefined,
  ].filter((value): value is string => Boolean(value));

  const seen = new Set<string>();
  for (const key of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = primary[namespace][key] ?? fallback[namespace][key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** Localized label when known; otherwise the original display/API string (never throws). */
export function formatContentLabel(
  namespace: ContentNamespace,
  raw: string,
  primary: ContentLookupDicts,
  fallback: ContentLookupDicts,
): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  return lookupContentLabel(namespace, trimmed, primary, fallback) ?? trimmed;
}
