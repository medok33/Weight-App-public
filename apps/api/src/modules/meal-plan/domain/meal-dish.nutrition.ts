export type MacroTotals = {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type IngredientNutritionInput = {
  amount: number;
  unit: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  /** When unit is piece, grams per piece if known. */
  gramsEquivalent?: number;
};

export const NUTRIENT_TOLERANCE_RATIO = Number(process.env.MEAL_DISH_NUTRIENT_TOLERANCE ?? '0.05');

export function amountToGrams(amount: number, unit: string, gramsEquivalent?: number): number {
  if (!(amount > 0)) throw new Error('INGREDIENT_AMOUNT_INVALID');
  const normalized = unit.toLowerCase();
  if (normalized === 'g' || normalized === 'ml') return amount;
  if (normalized === 'piece') {
    if (!(gramsEquivalent && gramsEquivalent > 0)) throw new Error('INGREDIENT_GRAMS_EQUIVALENT_REQUIRED');
    return amount * gramsEquivalent;
  }
  throw new Error('INGREDIENT_UNIT_UNSUPPORTED');
}

export function macrosFromIngredient(input: IngredientNutritionInput): MacroTotals {
  const grams = amountToGrams(input.amount, input.unit, input.gramsEquivalent);
  const factor = grams / 100;
  return {
    calories: round1(input.caloriesPer100g * factor),
    proteinG: round1(input.proteinPer100g * factor),
    fatG: round1(input.fatPer100g * factor),
    carbsG: round1(input.carbsPer100g * factor),
  };
}

export function sumMacros(items: MacroTotals[]): MacroTotals {
  return items.reduce(
    (acc, item) => ({
      calories: round1(acc.calories + item.calories),
      proteinG: round1(acc.proteinG + item.proteinG),
      fatG: round1(acc.fatG + item.fatG),
      carbsG: round1(acc.carbsG + item.carbsG),
    }),
    { calories: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );
}

export function scaleMacros(totals: MacroTotals, factor: number): MacroTotals {
  if (!(factor > 0)) throw new Error('PORTION_FACTOR_INVALID');
  return {
    calories: round1(totals.calories * factor),
    proteinG: round1(totals.proteinG * factor),
    fatG: round1(totals.fatG * factor),
    carbsG: round1(totals.carbsG * factor),
  };
}

export function validateNonNegativeMacros(totals: MacroTotals): void {
  if (totals.calories < 0 || totals.proteinG < 0 || totals.fatG < 0 || totals.carbsG < 0) {
    throw new Error('NUTRIENT_TOTAL_NEGATIVE');
  }
}

export function macrosWithinTolerance(calculated: MacroTotals, declared: MacroTotals, tolerance = NUTRIENT_TOLERANCE_RATIO): boolean {
  const fields: (keyof MacroTotals)[] = ['calories', 'proteinG', 'fatG', 'carbsG'];
  return fields.every((field) => {
    const base = Math.max(Math.abs(calculated[field]), 1);
    return Math.abs(calculated[field] - declared[field]) / base <= tolerance;
  });
}

export function dayMacroTargets(targetKcal: number, proteinG: number): MacroTotals {
  const fatG = Math.round((targetKcal * 0.3) / 9);
  const carbsG = Math.max(0, Math.round((targetKcal - proteinG * 4 - fatG * 9) / 4));
  return { calories: targetKcal, proteinG, fatG, carbsG };
}

export function shareOfDay(portion: MacroTotals, dayTarget: MacroTotals): MacroTotals {
  const ratio = (value: number, total: number) => (total > 0 ? round1((value / total) * 100) : 0);
  return {
    calories: ratio(portion.calories, dayTarget.calories),
    proteinG: ratio(portion.proteinG, dayTarget.proteinG),
    fatG: ratio(portion.fatG, dayTarget.fatG),
    carbsG: ratio(portion.carbsG, dayTarget.carbsG),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
