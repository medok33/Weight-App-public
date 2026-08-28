export type BudgetLine = { key: string; approved: number; unit: string; required?: boolean; optional?: boolean };
export type Consumption = { key: string; amount: number; unit: string; discarded?: boolean };

export function validateIngredientBudget(input: { approved: BudgetLine[]; consumption: Consumption[]; usedIngredientKeys?: string[] }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const approved = new Map(input.approved.map((line) => [line.key, line]));
  const totals = new Map<string, number>();
  for (const use of input.consumption) {
    const line = approved.get(use.key);
    if (!line || line.unit !== use.unit || !(use.amount > 0)) { reasons.push('PHANTOM_INGREDIENT'); continue; }
    totals.set(use.key, (totals.get(use.key) ?? 0) + use.amount);
  }
  for (const line of input.approved) {
    const total = totals.get(line.key) ?? 0;
    if (total > line.approved + 1e-9) reasons.push('INGREDIENT_BUDGET_VIOLATION');
    if (line.required && total <= 0) reasons.push('MISSING_REQUIRED_INGREDIENT_USE');
    if (line.optional && total > 0 && line.required) reasons.push('OPTIONALITY_CONTRADICTION');
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export const validateProcessInputBudget = validateIngredientBudget;
