export const CULINARY_CRITIC_CONTRACT_VERSION = 'culinary-critic/v1' as const;
export type CulinaryCriticIssueCode = 'MISSING_REQUIRED_INGREDIENT_USE' | 'PHANTOM_INGREDIENT' | 'INGREDIENT_BUDGET_VIOLATION' | 'OPTIONALITY_CONTRADICTION' | 'STEP_ORDER_IMPLAUSIBLE' | 'TECHNIQUE_CONTRADICTION' | 'TIME_INCONSISTENT' | 'TEMPERATURE_INCONSISTENT' | 'EQUIPMENT_CONTRADICTION' | 'UNCLEAR_INSTRUCTION' | 'CULINARY_LOGIC_CONCERN' | 'FOOD_SAFETY_CONCERN' | 'SOURCE_SIMILARITY_CONCERN' | 'IMPOSSIBLE_OR_UNCOOKABLE';
export type CulinaryCriticVerdict = 'PASS' | 'REGENERATE' | 'REJECT';
export type CulinaryCriticResult = { contractVersion: typeof CULINARY_CRITIC_CONTRACT_VERSION; verdict: CulinaryCriticVerdict; issues: Array<{ code: CulinaryCriticIssueCode; message?: string }> };

export function validateCulinaryCriticResult(value: unknown): CulinaryCriticResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CULINARY_CRITIC_SCHEMA_INVALID');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !['contractVersion', 'verdict', 'issues'].includes(key)) || v.contractVersion !== CULINARY_CRITIC_CONTRACT_VERSION || !['PASS', 'REGENERATE', 'REJECT'].includes(String(v.verdict)) || !Array.isArray(v.issues)) throw new Error('CULINARY_CRITIC_SCHEMA_INVALID');
  const codes = new Set<CulinaryCriticIssueCode>(['MISSING_REQUIRED_INGREDIENT_USE','PHANTOM_INGREDIENT','INGREDIENT_BUDGET_VIOLATION','OPTIONALITY_CONTRADICTION','STEP_ORDER_IMPLAUSIBLE','TECHNIQUE_CONTRADICTION','TIME_INCONSISTENT','TEMPERATURE_INCONSISTENT','EQUIPMENT_CONTRADICTION','UNCLEAR_INSTRUCTION','CULINARY_LOGIC_CONCERN','FOOD_SAFETY_CONCERN','SOURCE_SIMILARITY_CONCERN','IMPOSSIBLE_OR_UNCOOKABLE']);
  const issues = (v.issues as unknown[]).map((issue) => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) throw new Error('CULINARY_CRITIC_ISSUE_INVALID');
    const i = issue as Record<string, unknown>;
    if (Object.keys(i).some((key) => !['code', 'message'].includes(key)) || typeof i.code !== 'string' || !codes.has(i.code as CulinaryCriticIssueCode) || (i.message !== undefined && typeof i.message !== 'string')) throw new Error('CULINARY_CRITIC_ISSUE_INVALID');
    return { code: i.code as CulinaryCriticIssueCode, ...(typeof i.message === 'string' ? { message: i.message } : {}) };
  });
  return { contractVersion: CULINARY_CRITIC_CONTRACT_VERSION, verdict: v.verdict as CulinaryCriticVerdict, issues };
}
