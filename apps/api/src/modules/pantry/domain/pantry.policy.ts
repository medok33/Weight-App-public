import type {
  PantryExpiryStatus,
  PantryItemInput,
  PantryItemRecord,
  PantryItemView,
  PantryIngredient,
  PantryMealCandidate,
  PantryUsageExplanation,
  PantryUnit,
} from './pantry.types';

const UNITS: readonly PantryUnit[] = ['pcs', 'g', 'ml', 'kg', 'l'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePantryItemInput(input: {
  name?: string;
  quantity?: number;
  unit?: string;
  expiresOn?: string | null;
}): PantryItemInput {
  const name = input.name?.trim() ?? '';
  if (name.length < 1 || name.length > 120) throw new Error('PANTRY_ITEM_INVALID');
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('PANTRY_ITEM_QUANTITY_INVALID');
  }
  const unit = (input.unit?.trim() ?? '') as PantryUnit;
  if (!UNITS.includes(unit)) throw new Error('PANTRY_ITEM_UNIT_INVALID');
  let expiresOn: string | null = null;
  if (input.expiresOn != null && String(input.expiresOn).trim() !== '') {
    const raw = String(input.expiresOn).trim().slice(0, 10);
    if (!DATE.test(raw)) throw new Error('PANTRY_ITEM_EXPIRY_INVALID');
    expiresOn = raw;
  }
  return { name, quantity: Number(input.quantity), unit, expiresOn };
}

export function assertPantryOwner(pantryUserId: string, actorUserId: string) {
  if (!pantryUserId || !actorUserId || pantryUserId !== actorUserId) {
    throw new Error('PANTRY_FORBIDDEN');
  }
}

/** Pure expiry classification relative to a YYYY-MM-DD "today". */
export function classifyExpiry(expiresOn: string | null, today: string): PantryExpiryStatus {
  if (!expiresOn) return 'unknown';
  if (!DATE.test(today) || !DATE.test(expiresOn)) return 'unknown';
  if (expiresOn < today) return 'expired';
  const soon = addDays(today, 3);
  if (expiresOn <= soon) return 'soon';
  return 'ok';
}

export function withExpiryStatus(items: PantryItemRecord[], today: string): PantryItemView[] {
  return items.map((item) => ({
    ...item,
    expiryStatus: classifyExpiry(item.expiresOn, today),
  }));
}

/** Available stock excludes expired items; matching is intentionally conservative and normalized. */
export function availablePantryStock(items: PantryItemRecord[], today: string): PantryItemRecord[] {
  return items.filter((item) => classifyExpiry(item.expiresOn, today) !== 'expired' && item.quantity > 0);
}

export function pantryMatchScore(
  candidate: PantryMealCandidate,
  pantryItems: PantryItemRecord[],
  today: string,
  ingredientsForMeal: (mealName: string) => PantryIngredient[],
): number {
  const stock = availablePantryStock(pantryItems, today);
  const ingredients = ingredientsForMeal(candidate.name);
  return ingredients.reduce((score, ingredient) => {
    const item = stock.find((stockItem) => namesMatch(stockItem.name, ingredient.productKey ?? ingredient.name));
    if (!item) return score;
    return score + 1 + (classifyExpiry(item.expiresOn, today) === 'soon' ? 0.5 : 0);
  }, 0);
}

/**
 * Safety filters happen before all preference ranking. This function neither writes plans
 * nor relaxes nutrition validation; it is safe to use only as a candidate ordering hint.
 */
export function selectPantryFirstCandidates<T extends PantryMealCandidate>(
  candidates: T[],
  excludedTags: string[],
  pantryItems: PantryItemRecord[],
  today: string,
  ingredientsForMeal: (mealName: string) => PantryIngredient[],
): T[] {
  return candidates
    .filter((candidate) => !candidate.tags?.some((tag) => excludedTags.includes(tag)))
    .map((candidate) => ({ candidate, score: pantryMatchScore(candidate, pantryItems, today, ingredientsForMeal) }))
    .sort((a, b) => b.score - a.score || a.candidate.calories - b.candidate.calories)
    .map(({ candidate }) => candidate);
}

export function explainPantryUsage(
  mealNames: string[],
  pantryItems: PantryItemRecord[],
  today: string,
  ingredientsForMeal: (mealName: string) => PantryIngredient[],
): PantryUsageExplanation {
  const stock = availablePantryStock(pantryItems, today);
  const ingredients = mealNames.flatMap(ingredientsForMeal);
  const used = ingredients.filter((ingredient) => stock.some((item) => namesMatch(item.name, ingredient.productKey ?? ingredient.name)));
  const missing = ingredients.filter((ingredient) => !used.includes(ingredient));
  return {
    available: stock.map((item) => item.name),
    usedFromPantry: unique(used.map((item) => item.productKey ?? item.name)),
    toBuy: unique(missing.map((item) => item.productKey ?? item.name)),
    soonExpiring: stock.filter((item) => classifyExpiry(item.expiresOn, today) === 'soon').map((item) => item.name),
  };
}

function namesMatch(a: string, b: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '');
  const left = normalize(a);
  const right = normalize(b);
  return left === right || left.includes(right) || right.includes(left);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
