import { COMPENSATION_BY_CLASS, SUBSTITUTION_CLASS_THRESHOLDS } from './substitution.config';
import type { CompensationOption, SubstitutionClassification } from './substitution.types';
import type { MacroTotals } from './meal-dish.nutrition';

function absPct(after: number, before: number): number {
  if (Math.abs(before) < 1e-6) return after === 0 ? 0 : 1;
  return Math.abs(after - before) / Math.abs(before);
}

export function classifySubstitution(input: {
  source: MacroTotals;
  candidate: MacroTotals;
  requiresOtherMealAdjust: boolean;
}): { classification: SubstitutionClassification; reasons: string[]; warnings: string[]; compensationOptions: CompensationOption[] } {
  const cal = absPct(input.candidate.calories, input.source.calories);
  const pro = absPct(input.candidate.proteinG, input.source.proteinG);
  const fat = absPct(input.candidate.fatG, input.source.fatG);
  const carbs = absPct(input.candidate.carbsG, input.source.carbsG);
  const maxMacro = Math.max(fat, carbs);

  const t = SUBSTITUTION_CLASS_THRESHOLDS;
  let classification: SubstitutionClassification;

  if (
    cal <= t.equivalentMaxCaloriePct &&
    pro <= t.equivalentMaxProteinPct &&
    maxMacro <= t.equivalentMaxMacroPct &&
    !input.requiresOtherMealAdjust
  ) {
    classification = 'EQUIVALENT';
  } else if (cal <= t.adjustableMaxCaloriePct && pro <= t.adjustableMaxProteinPct) {
    classification = 'ADJUSTABLE';
  } else {
    classification = 'CONFLICTING';
  }

  const reasons: string[] = [];
  const warnings: string[] = [];
  if (classification === 'EQUIVALENT') {
    reasons.push('Близко по калориям и БЖУ без изменения других блюд.');
  } else if (classification === 'ADJUSTABLE') {
    reasons.push('Допустимо, но нужна корректировка порции или лёгкая правка дня.');
    if (input.requiresOtherMealAdjust) warnings.push('Может потребоваться скорректировать другой приём пищи.');
  } else {
    reasons.push('Заметно меняет калории или БЖУ относительно исходного варианта.');
    warnings.push(
      'Если регулярно сохранять такое изменение и не корректировать остальной рацион или активность, расчётный срок может сдвинуться.',
    );
  }

  return {
    classification,
    reasons,
    warnings,
    compensationOptions: COMPENSATION_BY_CLASS[classification],
  };
}
