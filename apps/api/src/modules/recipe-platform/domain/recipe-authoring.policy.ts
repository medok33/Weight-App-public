import { createHash } from 'node:crypto';
import type { SynthesisBrief } from './recipe-knowledge-synthesis.policy';
import { computeBriefContentHash, isApprovalForCurrentBrief, type BriefApprovalRecord } from './recipe-synthesis-brief-approval.policy';

export const CHEF_EDITOR_CONTRACT_VERSION = 'chef-editor/v1' as const;
export const NUTRITION_ENERGY_TOLERANCE = 0.2;
export const SOURCE_NEAR_CLONE_THRESHOLD = 0.9;

export type AuthoringIngredient = { id: string; productId: string; amount: number; unit: string; optional?: boolean; displayName?: string };
export type AuthoringStep = { index: number; text: string; ingredientIds: string[]; durationMinutes?: number; temperatureC?: number };
export type ChefEditorOutput = { contractVersion: typeof CHEF_EDITOR_CONTRACT_VERSION; title: string; description: string; steps: AuthoringStep[]; method: string; presentation: string; notes: string[] };
export type ChefEditorInput = { brief: SynthesisBrief; grammage: AuthoringIngredient[]; approvedProductIds: string[]; evidenceSummary: Record<string, unknown>; unresolvedReviewFlags: string[] };
export type ChefEditorResult = { status: 'SUCCESS' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'SCHEMA_INVALID' | 'POLICY_BLOCKED'; output?: ChefEditorOutput; audit: { provider: string; attempts: number; durationMs: number; contractVersion: string } };

const forbidden = /<\/?(script|iframe|style)\b|(?:ignore\s+(?:all\s+)?previous|system\s+message|publish|database|sql|insert\s+into|create\s+product|tool\s*\()/i;
export function validateChefEditorInput(input: ChefEditorInput): void {
  if (!input.brief || input.brief.status === 'BLOCKED_CONFLICT' || input.brief.approvalState !== 'OWNER_APPROVED') throw new Error('SYNTHESIS_BRIEF_NOT_APPROVED');
  if (input.brief.contentHash) {
    const record = (input.evidenceSummary as { approvalRecord?: BriefApprovalRecord }).approvalRecord ?? null;
    if (input.brief.contentHash !== computeBriefContentHash(input.brief) || !isApprovalForCurrentBrief(input.brief, record)) throw new Error('SYNTHESIS_BRIEF_APPROVAL_HASH_INVALID');
  }
  if (!Array.isArray(input.grammage) || input.grammage.length === 0) throw new Error('GRAMMAGE_REQUIRED');
  const allowed = new Set(input.approvedProductIds);
  for (const item of input.grammage) { if (!allowed.has(item.productId)) throw new Error('PRODUCT_NOT_APPROVED'); if (!(item.amount > 0)) throw new Error('GRAMMAGE_INVALID'); }
  for (const value of [input.brief.objective, ...input.brief.requiredTechniques, ...input.unresolvedReviewFlags]) if (forbidden.test(String(value))) throw new Error('SOURCE_PROMPT_INJECTION_BLOCKED');
}
export function validateChefEditorOutput(value: unknown, ingredientIds: string[]): ChefEditorOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CHEF_EDITOR_SCHEMA_INVALID');
  const v = value as Record<string, unknown>; const required = ['contractVersion','title','description','steps','method','presentation','notes'];
  if (Object.keys(v).some((k) => !required.includes(k)) || required.some((k) => !(k in v))) throw new Error('CHEF_EDITOR_UNKNOWN_OR_MISSING_FIELD');
  if (v.contractVersion !== CHEF_EDITOR_CONTRACT_VERSION || typeof v.title !== 'string' || !v.title.trim() || typeof v.description !== 'string' || typeof v.method !== 'string' || typeof v.presentation !== 'string' || !Array.isArray(v.steps) || !Array.isArray(v.notes)) throw new Error('CHEF_EDITOR_SCHEMA_INVALID');
  const allowed = new Set(ingredientIds); const steps = (v.steps as unknown[]).map((step, i) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('CHEF_EDITOR_STEP_INVALID');
    const s = step as Record<string, unknown>; const keys = ['index','text','ingredientIds','durationMinutes','temperatureC'];
    if (Object.keys(s).some((k) => !keys.includes(k)) || typeof s.index !== 'number' || s.index !== i + 1 || typeof s.text !== 'string' || forbidden.test(s.text) || !Array.isArray(s.ingredientIds)) throw new Error('CHEF_EDITOR_STEP_INVALID');
    for (const id of s.ingredientIds as unknown[]) if (typeof id !== 'string' || !allowed.has(id)) throw new Error('CHEF_EDITOR_STEP_REFERENCE_INVALID');
    return { index: s.index, text: s.text, ingredientIds: s.ingredientIds as string[], ...(typeof s.durationMinutes === 'number' ? { durationMinutes: s.durationMinutes } : {}), ...(typeof s.temperatureC === 'number' ? { temperatureC: s.temperatureC } : {}) };
  });
  return { contractVersion: CHEF_EDITOR_CONTRACT_VERSION, title: v.title, description: v.description, steps, method: v.method, presentation: v.presentation, notes: v.notes.filter((n): n is string => typeof n === 'string') };
}
export function assertNoDirectSourceRewrite(input: { sourceUrl?: string; rawSourceText?: string; brief?: unknown }): void { if (input.sourceUrl || input.rawSourceText) throw new Error('DIRECT_SOURCE_REWRITE_BLOCKED'); if (!input.brief) throw new Error('STRUCTURED_BRIEF_REQUIRED'); }

export type NutritionProduct = { productId: string; state: 'raw'|'dry'|'cooked'|'edible'; caloriesPer100g: number; proteinPer100g: number; fatPer100g: number; carbsPer100g: number; conversionFactor?: number };
export type RecipeNutrition = { total: { kcal: number; proteinG: number; fatG: number; carbohydratesG: number }; perServing: { kcal: number; proteinG: number; fatG: number; carbohydratesG: number }; yieldGrams: number; servings: number; basis: 'CANONICAL_PRODUCT_NUTRITION' };
const r2 = (n: number) => Math.round(n * 100) / 100;
export function calculateRecipeNutrition(items: Array<{ productId: string; amountGrams: number }>, products: NutritionProduct[], servings: number, yieldGrams: number): RecipeNutrition {
  if (!(servings > 0) || !(yieldGrams > 0)) throw new Error('SERVINGS_AND_YIELD_REQUIRED'); const byId = new Map(products.map((p) => [p.productId, p]));
  const total = items.reduce((a, item) => { const p = byId.get(item.productId); if (!p || !Number.isFinite(p.caloriesPer100g) || p.caloriesPer100g < 0) throw new Error('NUTRITION_UNRESOLVED'); const f = item.amountGrams / 100 * (p.conversionFactor ?? 1); a.kcal += p.caloriesPer100g * f; a.proteinG += p.proteinPer100g * f; a.fatG += p.fatPer100g * f; a.carbohydratesG += p.carbsPer100g * f; return a; }, { kcal: 0, proteinG: 0, fatG: 0, carbohydratesG: 0 });
  const out = { kcal: r2(total.kcal), proteinG: r2(total.proteinG), fatG: r2(total.fatG), carbohydratesG: r2(total.carbohydratesG) }; return { total: out, perServing: { kcal: r2(out.kcal / servings), proteinG: r2(out.proteinG / servings), fatG: r2(out.fatG / servings), carbohydratesG: r2(out.carbohydratesG / servings) }, yieldGrams, servings, basis: 'CANONICAL_PRODUCT_NUTRITION' };
}
export function validateNutritionConsistency(n: RecipeNutrition, representedMassGrams: number): { ok: boolean; reasons: string[] } { const derived = n.total.proteinG * 4 + n.total.carbohydratesG * 4 + n.total.fatG * 9; const reasons: string[] = []; if (n.total.kcal > 0 && Math.abs(derived - n.total.kcal) / n.total.kcal > NUTRITION_ENERGY_TOLERANCE) reasons.push('MACRO_ENERGY_MISMATCH'); if (representedMassGrams <= 0 || n.yieldGrams <= 0) reasons.push('YIELD_INVALID'); return { ok: reasons.length === 0, reasons }; }

export type CostLine = { productId: string; amount: number; unit: string; referencePrice: number | null; currency: string; scope: string };
export function calculateConsumedReferenceCost(lines: CostLine[]): { status: 'PASS'|'UNAVAILABLE'; currency: 'RUB'; consumedIngredientReferenceCost: number | null; packagePurchaseCost: null; lines: CostLine[] } { if (!Array.isArray(lines) || lines.some((l) => l.currency !== 'RUB' || l.referencePrice == null || l.referencePrice < 0)) return { status: 'UNAVAILABLE', currency: 'RUB', consumedIngredientReferenceCost: null, packagePurchaseCost: null, lines }; return { status: 'PASS', currency: 'RUB', consumedIngredientReferenceCost: r2(lines.reduce((s, l) => s + l.referencePrice! * l.amount, 0)), packagePurchaseCost: null, lines }; }

export function validateIngredientSteps(input: { ingredients: AuthoringIngredient[]; steps: AuthoringStep[]; noCook?: boolean }): { ok: boolean; reasons: string[] } { const ids = new Set(input.ingredients.map((i) => i.id)); const used = new Set(input.steps.flatMap((s) => s.ingredientIds)); const reasons: string[] = []; for (const s of input.steps) for (const id of s.ingredientIds) if (!ids.has(id)) reasons.push('NONEXISTENT_INGREDIENT'); for (const i of input.ingredients) if (!i.optional && !used.has(i.id)) reasons.push('REQUIRED_INGREDIENT_MISSING'); if (!input.noCook && input.steps.length === 0) reasons.push('COOKING_STEPS_REQUIRED'); if (input.steps.some((s) => s.index < 1)) reasons.push('STEP_ORDER_INVALID'); return { ok: reasons.length === 0, reasons: [...new Set(reasons)] }; }
export function evaluateCulinarySafety(input: { category: 'poultry'|'meat'|'fish'|'egg'|'reheating'|'none'; steps: AuthoringStep[]; storageInstructions?: string }): { status: 'PASS'|'NEEDS_SAFETY_REVIEW'|'FAIL'; reasons: string[] } {
  if (input.category === 'none') return { status: 'PASS', reasons: [] };
  const text = input.steps.map((s) => s.text).join(' ').toLowerCase();
  // An oven/pan setting is an environmental constraint, never evidence that poultry reached a safe internal state.
  const hasCookingTechnique = /варить|жарить|запек|готовить|нагрев|кипят/.test(text);
  if (!hasCookingTechnique) return { status: 'FAIL', reasons: ['REQUIRED_HEAT_HANDLING_MISSING'] };
  if (input.category === 'poultry' && !/до\s+(?:полной\s+)?готовности|готовить\s+до\s+готовности/.test(text)) {
    return { status: 'FAIL', reasons: ['POULTRY_DONENESS_INSTRUCTION_REQUIRED'] };
  }
  if (input.category === 'reheating' && /хранить.*комнат|оставить.*тепл/.test(`${text} ${input.storageInstructions ?? ''}`)) return { status: 'FAIL', reasons: ['REHEAT_STORAGE_CONTRADICTION'] };
  return { status: 'PASS', reasons: [] };
}

export type SimilarityDecision = 'CREATE'|'VARIANT'|'MERGE'|'UPDATE'|'REJECT';
export function evaluateSimilarity(input: { ingredientOverlap: number; quantitySimilarity: number; techniqueSimilarity: number; conceptSimilarity: number; titleSimilarity: number; sourceCloneSimilarity?: number; }): { decision: SimilarityDecision; score: number; autoPublish: boolean } { const score = r2(input.ingredientOverlap * .3 + input.quantitySimilarity * .2 + input.techniqueSimilarity * .2 + input.conceptSimilarity * .2 + input.titleSimilarity * .1); if ((input.sourceCloneSimilarity ?? 0) >= SOURCE_NEAR_CLONE_THRESHOLD) return { decision: 'REJECT', score, autoPublish: false }; if (score >= .97) return { decision: 'MERGE', score, autoPublish: false }; if (score >= .7) return { decision: 'VARIANT', score, autoPublish: false }; return { decision: 'CREATE', score, autoPublish: true }; }

export type HumanReview = { reviewerId: string; reviewedAt: Date; decision: 'NOT_REVIEWED'|'PASS'|'FAIL'|'NEEDS_CHANGES'; notes?: string; defects?: string[]; corrections?: string[] };
export type CookTest = { reviewerId: string; testedAt: Date; actuallyCooked: boolean; actualCookingTimeMinutes: number; actualYieldGrams: number; ingredientMeasurability: boolean; stepExecutability: boolean; equipmentSufficiency: boolean; textureResult: string; tasteResult: string; defects?: string[]; notes?: string; decision: 'PASS'|'FAIL' };
export function canPublish(input: { editorial?: HumanReview; cookTest?: CookTest; validationPass: boolean; costStatus: 'PASS'|'UNAVAILABLE'; similarityAutoPublish?: boolean; automatedQualityPass?: boolean }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.validationPass) reasons.push('VALIDATION_FAILED');
  if (input.similarityAutoPublish === false) reasons.push('SIMILARITY_REVIEW_REQUIRED');
  if (input.cookTest?.decision === 'FAIL') reasons.push('COOK_TEST_FAILED_QUARANTINE');
  // The normal path is backend automated verification. Human evidence remains an optional legacy path.
  const manualPass = input.editorial?.decision === 'PASS' && input.cookTest?.decision === 'PASS' && input.cookTest.actuallyCooked;
  if (input.automatedQualityPass !== true && !manualPass) reasons.push('AUTOMATED_QUALITY_PASS_REQUIRED');
  return { ok: reasons.length === 0, reasons };
}
export function publicationChecksum(payload: unknown): string { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
