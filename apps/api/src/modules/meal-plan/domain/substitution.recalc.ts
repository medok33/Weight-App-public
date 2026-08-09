import type { MacroTotals } from './meal-dish.nutrition';
import { sumMacros } from './meal-dish.nutrition';
import type { ShoppingListDeltaDto } from './substitution.types';

export function replaceMealMacrosInDay(input: {
  dayMeals: MacroTotals[];
  mealIndex: number;
  nextMacros: MacroTotals;
}): { before: MacroTotals; after: MacroTotals } {
  const before = sumMacros(input.dayMeals);
  const afterMeals = input.dayMeals.map((m, i) => (i === input.mealIndex ? input.nextMacros : m));
  return { before, after: sumMacros(afterMeals) };
}

export function weekTotals(days: MacroTotals[]): {
  total: MacroTotals;
  avgDailyCalories: number;
} {
  const total = sumMacros(days);
  const n = Math.max(days.length, 1);
  return {
    total,
    avgDailyCalories: Math.round((total.calories / n) * 10) / 10,
  };
}

export function shoppingDelta(input: {
  before: Array<{ productId: string; displayName: string; amount: number; unit: string }>;
  after: Array<{ productId: string; displayName: string; amount: number; unit: string }>;
}): ShoppingListDeltaDto {
  const beforeMap = aggregate(input.before);
  const afterMap = aggregate(input.after);
  const removed: ShoppingListDeltaDto['removed'] = [];
  const added: ShoppingListDeltaDto['added'] = [];
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const key of keys) {
    const prev = beforeMap.get(key);
    const next = afterMap.get(key);
    const prevAmt = prev?.amount ?? 0;
    const nextAmt = next?.amount ?? 0;
    const delta = nextAmt - prevAmt;
    if (delta < -1e-6 && prev) {
      removed.push({
        productId: prev.productId,
        displayName: prev.displayName,
        amount: round1(Math.abs(delta)),
        unit: prev.unit,
      });
    } else if (delta > 1e-6 && next) {
      added.push({
        productId: next.productId,
        displayName: next.displayName,
        amount: round1(delta),
        unit: next.unit,
      });
    }
  }

  return {
    removed,
    added,
    mergedNotes: ['Одинаковые товары объединены; отрицательные количества не создаются.'],
  };
}

function aggregate(
  lines: Array<{ productId: string; displayName: string; amount: number; unit: string }>,
): Map<string, { productId: string; displayName: string; amount: number; unit: string }> {
  const map = new Map<string, { productId: string; displayName: string; amount: number; unit: string }>();
  for (const line of lines) {
    if (!(line.amount > 0)) continue;
    const key = `${line.productId}:${line.unit}`;
    const prev = map.get(key);
    if (prev) {
      prev.amount = round1(prev.amount + line.amount);
    } else {
      map.set(key, { ...line });
    }
  }
  return map;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function costDelta(before: number | null, after: number | null): number | null {
  if (before == null || after == null) return null;
  return Math.round((after - before) * 100) / 100;
}
