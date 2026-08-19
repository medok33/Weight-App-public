export const RECIPE_CONTRACT_VERSION = 1 as const;
export const FINAL_GRAMMAGE_AUTHORITY = 'CODE' as const;
export const FINAL_NUTRITION_AUTHORITY = 'CODE' as const;
export const FINAL_COST_AUTHORITY = 'CODE' as const;
export const FINAL_SAFETY_AUTHORITY = 'CODE' as const;
export const FINAL_PUBLICATION_AUTHORITY = 'BACKEND_GATE' as const;

export type RecipeQualityStatus = 'STRUCTURED_CANDIDATE' | 'AUTO_VERIFIED' | 'REGENERATE' | 'REJECT';
export type CookTestStatus = 'NOT_PERFORMED' | 'PASSED' | 'FAILED';
export type PublicationState = 'DRAFT' | 'PUBLISHED' | 'QUARANTINED';

export type RecipeIngredientLine = {
  ingredientId: string;
  productId: string;
  grams: number;
  unit: string;
  optional: boolean;
};

export type MethodSkeletonStep = {
  stepId: string;
  order: number;
  ingredientIds: string[];
  technique?: string;
  durationMinutes?: number;
  temperatureC?: number;
  equipment?: string[];
  endCondition?: string;
  processAllocations?: Record<string, number>;
};

export type RecipeEditorText = { stepId: string; text: string };

export type RecipeContractV1 = {
  contractVersion: typeof RECIPE_CONTRACT_VERSION;
  recipeKey: string;
  versionIdentity: string;
  title: string;
  description: string;
  servings: number;
  yieldGrams?: number;
  totalTimeMinutes?: number;
  ingredients: RecipeIngredientLine[];
  equipment: string[];
  methodSkeleton: MethodSkeletonStep[];
  renderedSteps: RecipeEditorText[];
  nutrition: unknown;
  cost: unknown;
  safety: { status: 'PASS' | 'NEEDS_REVIEW' | 'FAIL'; reasons: string[] };
  provenance: { sourceIds: string[]; evidenceIds: string[] };
  similarity: { autoPublish: boolean; decision: string; score: number };
  qualityStatus: RecipeQualityStatus;
  cookTestStatus: CookTestStatus;
  publicationState: PublicationState;
};

export function validateRecipeEditorText(value: unknown, skeleton: MethodSkeletonStep[]): RecipeEditorText[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RECIPE_EDITOR_SCHEMA_INVALID');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['title', 'description', 'steps']);
  if (Object.keys(record).some((key) => !allowed.has(key)) || typeof record.title !== 'string' || typeof record.description !== 'string' || !Array.isArray(record.steps)) throw new Error('RECIPE_EDITOR_SCHEMA_INVALID');
  const injection = /ignore\s+(?:all\s+)?previous|system\s+message|publish\s+to\s+database|create\s+product/i;
  if (injection.test(record.title) || injection.test(record.description)) throw new Error('SOURCE_PROMPT_INJECTION_BLOCKED');
  const skeletonIds = new Set(skeleton.map((step) => step.stepId));
  const seen = new Set<string>();
  const steps = (record.steps as unknown[]).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('RECIPE_EDITOR_STEP_INVALID');
    const step = entry as Record<string, unknown>;
    if (Object.keys(step).some((key) => !['stepId', 'text'].includes(key)) || typeof step.stepId !== 'string' || typeof step.text !== 'string' || !step.text.trim() || !skeletonIds.has(step.stepId) || seen.has(step.stepId)) throw new Error('RECIPE_EDITOR_STEP_INVALID');
    if (injection.test(step.text)) throw new Error('SOURCE_PROMPT_INJECTION_BLOCKED');
    const skeletonStep = skeleton.find((candidate) => candidate.stepId === step.stepId)!;
    if (skeletonStep.durationMinutes !== undefined && new RegExp(`(?:^|\\D)${skeletonStep.durationMinutes + 1}(?:\\D|$)`).test(step.text)) throw new Error('TIME_INCONSISTENT');
    if (skeletonStep.temperatureC !== undefined && new RegExp(`(?:^|\\D)${skeletonStep.temperatureC + 1}(?:\\D|$)`).test(step.text)) throw new Error('TEMPERATURE_INCONSISTENT');
    seen.add(step.stepId);
    return { stepId: step.stepId, text: step.text };
  });
  if (steps.length !== skeleton.length || skeleton.some((step) => !seen.has(step.stepId))) throw new Error('RECIPE_EDITOR_STEP_MISSING');
  return steps;
}

export function validateCanonicalContract(contract: RecipeContractV1): void {
  if (contract.contractVersion !== RECIPE_CONTRACT_VERSION) throw new Error('RECIPE_CONTRACT_VERSION_INVALID');
  if (!contract.recipeKey || !contract.versionIdentity || !contract.title.trim()) throw new Error('RECIPE_IDENTITY_INVALID');
  if (!(contract.servings > 0) || (contract.yieldGrams !== undefined && !(contract.yieldGrams > 0))) throw new Error('RECIPE_SERVINGS_INVALID');
  const productIds = new Set<string>();
  for (const item of contract.ingredients) {
    if (!item.ingredientId || !item.productId || productIds.has(item.ingredientId) || !(item.grams > 0) || !item.unit) throw new Error('RECIPE_INGREDIENT_INVALID');
    productIds.add(item.ingredientId);
  }
  if (contract.methodSkeleton.length === 0 || contract.renderedSteps.length !== contract.methodSkeleton.length) throw new Error('METHOD_SKELETON_REQUIRED');
}
