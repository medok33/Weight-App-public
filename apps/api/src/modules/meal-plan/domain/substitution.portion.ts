import { SUBSTITUTION_PORTION } from './substitution.config';
import type { MacroTotals } from './meal-dish.nutrition';
import { scaleMacros } from './meal-dish.nutrition';

export type PortionSuggestion = {
  originalPortionGrams: number;
  suggestedPortionGrams: number;
  scale: number;
  macros: MacroTotals;
  calorieDelta: number;
  calorieDeltaPct: number;
  proteinDelta: number;
  proteinDeltaPct: number;
  fatDelta: number;
  fatDeltaPct: number;
  carbsDelta: number;
  carbsDeltaPct: number;
};

function pct(delta: number, base: number): number {
  if (Math.abs(base) < 1e-6) return delta === 0 ? 0 : 100;
  return Math.round((delta / Math.abs(base)) * 1000) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scale candidate base macros toward source calories first, then nudge toward protein.
 * Deterministic — no LLM.
 */
export function suggestPortion(input: {
  sourceMacros: MacroTotals;
  candidateBaseMacros: MacroTotals;
  candidateBasePortionGrams: number;
  originalPortionGrams: number;
}): PortionSuggestion {
  const { sourceMacros, candidateBaseMacros, candidateBasePortionGrams, originalPortionGrams } = input;
  if (!(candidateBaseMacros.calories > 0) || !(candidateBasePortionGrams > 0)) {
    throw new Error('PORTION_SOURCE_INVALID');
  }

  let scale = sourceMacros.calories / candidateBaseMacros.calories;

  // Secondary: if protein still far off and calories stay within 8%, nudge toward protein match.
  const proteinScale =
    candidateBaseMacros.proteinG > 0 ? sourceMacros.proteinG / candidateBaseMacros.proteinG : scale;
  const calorieAtProtein = candidateBaseMacros.calories * proteinScale;
  if (Math.abs(calorieAtProtein - sourceMacros.calories) / Math.max(sourceMacros.calories, 1) <= 0.08) {
    scale = (scale * 0.7 + proteinScale * 0.3);
  }

  scale = clamp(scale, SUBSTITUTION_PORTION.minScale, SUBSTITUTION_PORTION.maxScale);
  let suggestedPortionGrams = Math.round(candidateBasePortionGrams * scale);
  suggestedPortionGrams = clamp(suggestedPortionGrams, SUBSTITUTION_PORTION.minGrams, SUBSTITUTION_PORTION.maxGrams);
  scale = suggestedPortionGrams / candidateBasePortionGrams;

  const macros = scaleMacros(candidateBaseMacros, scale);
  return {
    originalPortionGrams,
    suggestedPortionGrams,
    scale,
    macros,
    calorieDelta: round1(macros.calories - sourceMacros.calories),
    calorieDeltaPct: pct(macros.calories - sourceMacros.calories, sourceMacros.calories),
    proteinDelta: round1(macros.proteinG - sourceMacros.proteinG),
    proteinDeltaPct: pct(macros.proteinG - sourceMacros.proteinG, sourceMacros.proteinG),
    fatDelta: round1(macros.fatG - sourceMacros.fatG),
    fatDeltaPct: pct(macros.fatG - sourceMacros.fatG, sourceMacros.fatG),
    carbsDelta: round1(macros.carbsG - sourceMacros.carbsG),
    carbsDeltaPct: pct(macros.carbsG - sourceMacros.carbsG, sourceMacros.carbsG),
  };
}

/**
 * For ingredient swap: find grams of replacement product so dish calories match source,
 * keeping other ingredients fixed.
 */
export function suggestIngredientAmount(input: {
  otherMacros: MacroTotals;
  sourceDishMacros: MacroTotals;
  replacementCaloriesPer100g: number;
  minGrams?: number;
  maxGrams?: number;
}): { amountGrams: number; dishMacros: MacroTotals } {
  const remainingCal = Math.max(0, input.sourceDishMacros.calories - input.otherMacros.calories);
  if (!(input.replacementCaloriesPer100g > 0)) throw new Error('INGREDIENT_CALORIES_INVALID');
  let amountGrams = (remainingCal / input.replacementCaloriesPer100g) * 100;

  // Prefer closing protein gap if calories stay close.
  const remainingProtein = Math.max(0, input.sourceDishMacros.proteinG - input.otherMacros.proteinG);
  // proteinPer100 not passed — caller may refine; keep calorie-first here.

  amountGrams = clamp(
    Math.round(amountGrams),
    input.minGrams ?? SUBSTITUTION_PORTION.minGrams,
    input.maxGrams ?? SUBSTITUTION_PORTION.maxGrams,
  );

  const factor = amountGrams / 100;
  const add: MacroTotals = {
    calories: round1(input.replacementCaloriesPer100g * factor),
    proteinG: 0,
    fatG: 0,
    carbsG: 0,
  };
  // protein/fat/carbs filled by caller with full product macros
  void remainingProtein;
  return {
    amountGrams,
    dishMacros: {
      calories: round1(input.otherMacros.calories + add.calories),
      proteinG: input.otherMacros.proteinG,
      fatG: input.otherMacros.fatG,
      carbsG: input.otherMacros.carbsG,
    },
  };
}

export function suggestIngredientAmountWithMacros(input: {
  otherMacros: MacroTotals;
  sourceDishMacros: MacroTotals;
  replacement: {
    caloriesPer100g: number;
    proteinPer100g: number;
    fatPer100g: number;
    carbsPer100g: number;
  };
  minGrams?: number;
  maxGrams?: number;
}): { amountGrams: number; scaleVsOriginal?: number; dishMacros: MacroTotals } {
  const minGrams = input.minGrams ?? SUBSTITUTION_PORTION.minGrams;
  const maxGrams = input.maxGrams ?? SUBSTITUTION_PORTION.maxGrams;
  const calFirst = suggestIngredientAmount({
    otherMacros: input.otherMacros,
    sourceDishMacros: input.sourceDishMacros,
    replacementCaloriesPer100g: input.replacement.caloriesPer100g,
    minGrams,
    maxGrams,
  });

  let amountGrams = calFirst.amountGrams;
  const proteinTarget = Math.max(0, input.sourceDishMacros.proteinG - input.otherMacros.proteinG);
  if (input.replacement.proteinPer100g > 0 && proteinTarget > 0) {
    const proteinGrams = (proteinTarget / input.replacement.proteinPer100g) * 100;
    const blended = Math.round(amountGrams * 0.75 + proteinGrams * 0.25);
    const calAtBlend =
      input.otherMacros.calories + (blended / 100) * input.replacement.caloriesPer100g;
    if (Math.abs(calAtBlend - input.sourceDishMacros.calories) / Math.max(input.sourceDishMacros.calories, 1) <= 0.1) {
      amountGrams = clamp(blended, minGrams, maxGrams);
    }
  }

  const factor = amountGrams / 100;
  const dishMacros: MacroTotals = {
    calories: round1(input.otherMacros.calories + input.replacement.caloriesPer100g * factor),
    proteinG: round1(input.otherMacros.proteinG + input.replacement.proteinPer100g * factor),
    fatG: round1(input.otherMacros.fatG + input.replacement.fatPer100g * factor),
    carbsG: round1(input.otherMacros.carbsG + input.replacement.carbsPer100g * factor),
  };

  return { amountGrams, dishMacros };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
