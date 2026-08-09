export type AllergenPresence = 'CONTAINS' | 'MAY_CONTAIN' | 'CROSS_CONTAMINATION_RISK';

export type CanonicalAllergenCode =
  | 'PEANUT'
  | 'TREE_NUT'
  | 'MILK'
  | 'EGG'
  | 'FISH'
  | 'SHELLFISH'
  | 'SOY'
  | 'GLUTEN'
  | 'SESAME'
  | 'CELERY'
  | 'MUSTARD'
  | 'SULPHITE'
  | 'LUPIN'
  | 'MOLLUSC';

export type UserAllergenDto = {
  code: CanonicalAllergenCode;
  label: string;
  presence: AllergenPresence;
};

export type CanonicalDietaryCode =
  | 'VEGAN'
  | 'VEGETARIAN'
  | 'GLUTEN_FREE'
  | 'LACTOSE_FREE'
  | 'DAIRY_FREE'
  | 'HIGH_PROTEIN'
  | 'LOW_CARB';

export type UserDietaryTagDto = {
  code: CanonicalDietaryCode;
  label: string;
};

export type DishRestrictionWarning = {
  code: string;
  message: string;
  conflictingCodes?: string[];
};

const ALLERGEN_LABELS_RU: Record<CanonicalAllergenCode, string> = {
  PEANUT: 'Арахис',
  TREE_NUT: 'Орехи',
  MILK: 'Молоко',
  EGG: 'Яйцо',
  FISH: 'Рыба',
  SHELLFISH: 'Ракообразные',
  SOY: 'Соя',
  GLUTEN: 'Глютен',
  SESAME: 'Кунжут',
  CELERY: 'Сельдерей',
  MUSTARD: 'Горчица',
  SULPHITE: 'Сульфиты',
  LUPIN: 'Люпин',
  MOLLUSC: 'Моллюски',
};

const DIETARY_LABELS_RU: Record<CanonicalDietaryCode, string> = {
  VEGAN: 'Веганское',
  VEGETARIAN: 'Вегетарианское',
  GLUTEN_FREE: 'Без глютена',
  LACTOSE_FREE: 'Без лактозы',
  DAIRY_FREE: 'Без молочных',
  HIGH_PROTEIN: 'Высокобелковое',
  LOW_CARB: 'Низкоуглеводное',
};

/** Lactose is intolerance, not automatically MILK allergen. */
const ALLERGEN_ALIASES: Record<string, CanonicalAllergenCode> = {
  peanut: 'PEANUT',
  peanuts: 'PEANUT',
  peanut_butter: 'PEANUT',
  tree_nut: 'TREE_NUT',
  tree_nuts: 'TREE_NUT',
  nut: 'TREE_NUT',
  nuts: 'TREE_NUT',
  milk: 'MILK',
  dairy: 'MILK',
  egg: 'EGG',
  eggs: 'EGG',
  fish: 'FISH',
  shellfish: 'SHELLFISH',
  crustacean: 'SHELLFISH',
  soy: 'SOY',
  soya: 'SOY',
  gluten: 'GLUTEN',
  wheat: 'GLUTEN',
  sesame: 'SESAME',
  celery: 'CELERY',
  mustard: 'MUSTARD',
  sulphite: 'SULPHITE',
  sulphites: 'SULPHITE',
  sulfite: 'SULPHITE',
  sulfites: 'SULPHITE',
  lupin: 'LUPIN',
  mollusc: 'MOLLUSC',
  molluscs: 'MOLLUSC',
};

const DIETARY_ALIASES: Record<string, CanonicalDietaryCode> = {
  vegan: 'VEGAN',
  vegetarian: 'VEGETARIAN',
  'gluten-free': 'GLUTEN_FREE',
  gluten_free: 'GLUTEN_FREE',
  glutenfree: 'GLUTEN_FREE',
  'lactose-free': 'LACTOSE_FREE',
  lactose_free: 'LACTOSE_FREE',
  lactosefree: 'LACTOSE_FREE',
  'dairy-free': 'DAIRY_FREE',
  dairy_free: 'DAIRY_FREE',
  'high-protein': 'HIGH_PROTEIN',
  high_protein: 'HIGH_PROTEIN',
  'low-carb': 'LOW_CARB',
  low_carb: 'LOW_CARB',
};

const ANIMAL_MEAT_KEYS =
  /chicken|turkey|beef|pork|lamb|meat|fish|salmon|tuna|shrimp|egg|курица|куриц|индейк|говядин|свинин|баранин|мясо|рыб|лосос|тунец|креветк|яйц/i;
const DAIRY_KEYS =
  /milk|yogurt|yoghurt|cheese|butter|cream|dairy|lactose|молоко|молоч|йогурт|сыр|масло|сливк|лактоз/i;
const GLUTEN_KEYS =
  /wheat|gluten|flour|pasta|bread|oat(?!meal_gf)|пшениц|глютен|мука|макарон|хлеб|овсян/i;

export function canonicalizeAllergenToken(token: string): CanonicalAllergenCode | null {
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/-/g, '_');
  if ((Object.keys(ALLERGEN_LABELS_RU) as CanonicalAllergenCode[]).includes(upper as CanonicalAllergenCode)) {
    return upper as CanonicalAllergenCode;
  }
  // Lactose intolerance is NOT auto-mapped to MILK allergen.
  if (['lactose', 'LACTOSE'].includes(raw) || upper === 'LACTOSE') return null;
  return ALLERGEN_ALIASES[raw.toLowerCase().replace(/-/g, '_')] ?? null;
}

export function canonicalizeDietaryToken(token: string): CanonicalDietaryCode | null {
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/-/g, '_');
  if ((Object.keys(DIETARY_LABELS_RU) as CanonicalDietaryCode[]).includes(upper as CanonicalDietaryCode)) {
    return upper as CanonicalDietaryCode;
  }
  return DIETARY_ALIASES[raw.toLowerCase()] ?? DIETARY_ALIASES[raw.toLowerCase().replace(/-/g, '_')] ?? null;
}

export function allergenLabelRu(code: CanonicalAllergenCode): string {
  return ALLERGEN_LABELS_RU[code];
}

export function dietaryLabelRu(code: CanonicalDietaryCode): string {
  return DIETARY_LABELS_RU[code];
}

export function resolveDishAllergens(input: {
  recipeTokens?: string[];
  productAllergenCodes?: string[];
  presenceByCode?: Partial<Record<string, AllergenPresence>>;
}): { user: UserAllergenDto[]; internalCodes: CanonicalAllergenCode[]; warnings: DishRestrictionWarning[] } {
  const map = new Map<CanonicalAllergenCode, AllergenPresence>();
  const warnings: DishRestrictionWarning[] = [];
  for (const token of [...(input.recipeTokens ?? []), ...(input.productAllergenCodes ?? [])]) {
    const code = canonicalizeAllergenToken(token);
    if (!code) continue;
    const presence =
      input.presenceByCode?.[code] ??
      input.presenceByCode?.[token] ??
      'CONTAINS';
    const prior = map.get(code);
    map.set(code, prior === 'CONTAINS' || presence === 'CONTAINS' ? 'CONTAINS' : presence);
  }
  const internalCodes = [...map.keys()].sort();
  return {
    internalCodes,
    warnings,
    user: internalCodes.map((code) => ({
      code,
      label: allergenLabelRu(code),
      presence: map.get(code) ?? 'CONTAINS',
    })),
  };
}

export function resolveDishDietaryTags(input: {
  claimedTags?: string[];
  ingredientNames?: string[];
  ingredientProductKeys?: string[];
  allergenCodes?: CanonicalAllergenCode[];
  unknownComposition?: boolean;
}): {
  user: UserDietaryTagDto[];
  internalAccepted: CanonicalDietaryCode[];
  warnings: DishRestrictionWarning[];
} {
  const warnings: DishRestrictionWarning[] = [];
  if (input.unknownComposition) {
    return { user: [], internalAccepted: [], warnings: [{ code: 'UNKNOWN_COMPOSITION', message: 'Unknown composition blocks positive dietary claims' }] };
  }

  const claimed = new Set<CanonicalDietaryCode>();
  for (const token of input.claimedTags ?? []) {
    const code = canonicalizeDietaryToken(token);
    if (code) claimed.add(code);
  }

  const haystack = [
    ...(input.ingredientNames ?? []),
    ...(input.ingredientProductKeys ?? []),
  ].join(' ');
  const allergens = new Set(input.allergenCodes ?? []);
  const hasAnimal = ANIMAL_MEAT_KEYS.test(haystack) || allergens.has('FISH') || allergens.has('SHELLFISH') || allergens.has('EGG');
  const hasDairy = DAIRY_KEYS.test(haystack) || allergens.has('MILK');
  const hasGluten = GLUTEN_KEYS.test(haystack) || allergens.has('GLUTEN');
  const hasMeatOrFish =
    /chicken|turkey|beef|pork|lamb|meat|fish|salmon|tuna|shrimp|курица|куриц|индейк|говядин|свинин|баранин|мясо|рыб|лосос|тунец|креветк/i.test(
      haystack,
    ) ||
    allergens.has('FISH') ||
    allergens.has('SHELLFISH');

  const accepted: CanonicalDietaryCode[] = [];
  for (const code of claimed) {
    if (code === 'VEGAN' && (hasAnimal || hasDairy || hasMeatOrFish)) {
      warnings.push({ code: 'DIETARY_CONFLICT_VEGAN', message: 'VEGAN claim conflicts with animal ingredients', conflictingCodes: [code] });
      continue;
    }
    if (code === 'VEGETARIAN' && hasMeatOrFish) {
      warnings.push({
        code: 'DIETARY_CONFLICT_VEGETARIAN',
        message: 'VEGETARIAN claim conflicts with meat/fish ingredients',
        conflictingCodes: [code],
      });
      continue;
    }
    if (code === 'GLUTEN_FREE' && hasGluten) {
      warnings.push({
        code: 'DIETARY_CONFLICT_GLUTEN_FREE',
        message: 'GLUTEN_FREE claim conflicts with gluten-containing ingredients',
        conflictingCodes: [code],
      });
      continue;
    }
    if ((code === 'LACTOSE_FREE' || code === 'DAIRY_FREE') && hasDairy) {
      warnings.push({
        code: 'DIETARY_CONFLICT_DAIRY',
        message: `${code} claim conflicts with dairy/lactose ingredients`,
        conflictingCodes: [code],
      });
      continue;
    }
    accepted.push(code);
  }

  accepted.sort();
  return {
    internalAccepted: accepted,
    warnings,
    user: accepted.map((code) => ({ code, label: dietaryLabelRu(code) })),
  };
}

/** USER-facing strings only — never raw internal tokens. */
export function userAllergenLabels(allergens: UserAllergenDto[]): string[] {
  return allergens.map((item) => item.label);
}

export function userDietaryLabels(tags: UserDietaryTagDto[]): string[] {
  return tags.map((item) => item.label);
}
