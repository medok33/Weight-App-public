export const CULINARY_CRITIC_CONTRACT_VERSION = 'culinary-critic/v1' as const;
export const CULINARY_CRITIC_ISSUE_CODES = ['MISSING_REQUIRED_INGREDIENT_USE','PHANTOM_INGREDIENT','INGREDIENT_BUDGET_VIOLATION','OPTIONALITY_CONTRADICTION','STEP_ORDER_IMPLAUSIBLE','TECHNIQUE_CONTRADICTION','TIME_INCONSISTENT','TEMPERATURE_INCONSISTENT','EQUIPMENT_CONTRADICTION','UNCLEAR_INSTRUCTION','CULINARY_LOGIC_CONCERN','FOOD_SAFETY_CONCERN','SOURCE_SIMILARITY_CONCERN','IMPOSSIBLE_OR_UNCOOKABLE'] as const;
export const CULINARY_CRITIC_VERDICTS = ['PASS', 'REGENERATE', 'REJECT'] as const;
export type CulinaryCriticIssueCode = (typeof CULINARY_CRITIC_ISSUE_CODES)[number];
export type CulinaryCriticVerdict = (typeof CULINARY_CRITIC_VERDICTS)[number];
export type CulinaryCriticResult = { contractVersion: typeof CULINARY_CRITIC_CONTRACT_VERSION; verdict: CulinaryCriticVerdict; issues: Array<{ code: CulinaryCriticIssueCode; message?: string }> };

/** Single source for runtime validation and model instructions; no free-form issue objects are accepted. */
export function culinaryCriticContractInstruction(): string {
  return `Return only one JSON object: {contractVersion:${CULINARY_CRITIC_CONTRACT_VERSION},verdict:PASS|REGENERATE|REJECT,issues:[{code:<allowed>,message?:string}]}. Allowed issue codes: ${CULINARY_CRITIC_ISSUE_CODES.join('|')}. PASS requires issues:[]. Do not add fields or change culinary judgment merely to repair formatting.`;
}

export function culinaryCriticRepairInstruction(errors: readonly string[]): string {
  return `${culinaryCriticContractInstruction()} Validator errors: ${errors.join('|')}. Preserve the prior culinary verdict and findings; change only schema formatting.`;
}

export function validateCulinaryCriticResult(value: unknown): CulinaryCriticResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CULINARY_CRITIC_SCHEMA_INVALID');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !['contractVersion', 'verdict', 'issues'].includes(key)) || v.contractVersion !== CULINARY_CRITIC_CONTRACT_VERSION || !CULINARY_CRITIC_VERDICTS.includes(v.verdict as CulinaryCriticVerdict) || !Array.isArray(v.issues)) throw new Error('CULINARY_CRITIC_SCHEMA_INVALID');
  const codes = new Set<CulinaryCriticIssueCode>(CULINARY_CRITIC_ISSUE_CODES);
  const issues = (v.issues as unknown[]).map((issue) => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) throw new Error('CULINARY_CRITIC_ISSUE_INVALID');
    const i = issue as Record<string, unknown>;
    if (Object.keys(i).some((key) => !['code', 'message'].includes(key)) || typeof i.code !== 'string' || !codes.has(i.code as CulinaryCriticIssueCode) || (i.message !== undefined && typeof i.message !== 'string')) throw new Error('CULINARY_CRITIC_ISSUE_INVALID');
    return { code: i.code as CulinaryCriticIssueCode, ...(typeof i.message === 'string' ? { message: i.message } : {}) };
  });
  return { contractVersion: CULINARY_CRITIC_CONTRACT_VERSION, verdict: v.verdict as CulinaryCriticVerdict, issues };
}
