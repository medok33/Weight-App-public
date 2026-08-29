import { describe, expect, it, vi } from 'vitest';
import { BoundedSynthesisOrchestrator } from '../application/bounded-synthesis.orchestrator';
import { RecipeQualityOrchestrator } from '../application/recipe-quality.orchestrator';
import { type RecipeContractV1 } from '../domain/recipe-contract.v1';
import { resolveSynthesisTarget } from '../domain/synthesis-target-contract';
import type { SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';

const brief = (clusterId: string, products: string[], ownerDecisions: Record<string, string> = {}): SynthesisBrief => ({
  briefId: `brief_${clusterId.slice(-24)}`, briefVersion: 'recipe-knowledge-synthesis/v1', clusterId, coverageSlot: null, objective: 'test', approvedProducts: products, forbiddenProducts: [], allowedEquipment: ['pan'], requiredTechniques: [], optionalTechniques: [], requiredFacts: [], conflictingFacts: [], unresolvedFacts: [], differentiationReason: 'test', evidenceSummary: { candidateIds: ['c1'], sourceCodes: ['test'], factIds: [], rejectedFactIds: [], conflictLevels: ['NONE'], scores: { sourceQuality: 1, weightAppFit: 1 } }, status: 'APPROVED_FOR_SYNTHESIS', approvalState: 'OWNER_APPROVED', ownerDecisions, totalTimeMinutes: 30,
});

const base = (clusterId: string, products: string[]): Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'> => ({
  contractVersion: 1, recipeKey: clusterId, versionIdentity: `${clusterId}:v1`, title: 'Test', description: 'Test', servings: 2, totalTimeMinutes: 30,
  ingredients: products.map((productId, index) => ({ ingredientId: `i${index}`, productId, grams: 10, unit: 'g', optional: false })), equipment: ['pan'],
  methodSkeleton: [{ stepId: 's1', order: 1, ingredientIds: products.map((_, i) => `i${i}`), durationMinutes: 10 }], nutrition: { kcal: 1 }, cost: {}, safety: { status: 'PASS', reasons: [] }, provenance: { sourceIds: ['source'], evidenceIds: ['evidence'] }, similarity: { autoPublish: true, decision: 'PASS', score: 1 }, cookTestStatus: 'NOT_PERFORMED', publicationState: 'DRAFT',
});

const output = (text: string) => ({ title: 'Test', description: 'Test', steps: [{ stepId: 's1', text }] });

describe('bounded synthesis target orchestration', () => {
  const tomato = (products = ['egg', 'tomato', 'sunflower_oil'], decisions = { sunflowerOil: 'sunflower_oil', butterRequired: 'NO' }) => ({ brief: brief('dcluster_87b96a2fc22b24da2b6baa44', products, decisions), base: base('dcluster_87b96a2fc22b24da2b6baa44', products) });
  const rice = (products = ['rice', 'pumpkin'], decisions = { orangeZestRequired: 'NO', orangeZestIncluded: 'NO' }) => ({ brief: brief('dcluster_06210e70a9392b5421aa0155', products, decisions), base: base('dcluster_06210e70a9392b5421aa0155', products) });
  const reject = async (args: ReturnType<typeof tomato> | ReturnType<typeof rice>) => new BoundedSynthesisOrchestrator(new RecipeQualityOrchestrator()).synthesize({ ...args, hasCurrentApproval: async () => true, editor: async () => output('яйца помидоры рис тыква'), critic: async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] }), publish: async () => null });

  it('registers only the bounded target set and denies unknown clusters', () => {
    expect(resolveSynthesisTarget('dcluster_87b96a2fc22b24da2b6baa44').label).toBe('Tomato Omelet');
    expect(resolveSynthesisTarget('dcluster_06210e70a9392b5421aa0155').label).toBe('Rice/Pumpkin Porridge');
    expect(() => resolveSynthesisTarget('unknown')).toThrow('SYNTHESIS_TARGET_NOT_REGISTERED');
  });

  it('runs Tomato through approval, editor, critic and publication using brief products', async () => {
    const editor = vi.fn(async () => output('Взбейте яйца с помидорами и добавьте подсолнечное масло.'));
    const critic = vi.fn(async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] }));
    const publish = vi.fn(async () => 'published');
    const result = await new BoundedSynthesisOrchestrator(new RecipeQualityOrchestrator()).synthesize({ brief: brief('dcluster_87b96a2fc22b24da2b6baa44', ['egg', 'tomato', 'sunflower_oil'], { sunflowerOil: 'sunflower_oil', butterRequired: 'NO' }), base: base('dcluster_87b96a2fc22b24da2b6baa44', ['egg', 'tomato', 'sunflower_oil']), hasCurrentApproval: async () => true, editor, critic, publish });
    expect(result.status).toBe('PUBLISHED'); expect(editor).toHaveBeenCalledTimes(1); expect(critic).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(1);
  });

  it('runs Rice and keeps orange zest excluded', async () => {
    const editor = vi.fn(async () => output('Сварите рис с тыквой до мягкости.'));
    const critic = vi.fn(async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] }));
    const result = await new BoundedSynthesisOrchestrator(new RecipeQualityOrchestrator()).synthesize({ brief: brief('dcluster_06210e70a9392b5421aa0155', ['rice', 'pumpkin'], { orangeZestRequired: 'NO', orangeZestIncluded: 'NO' }), base: base('dcluster_06210e70a9392b5421aa0155', ['rice', 'pumpkin']), hasCurrentApproval: async () => true, editor, critic, publish: async () => 'published' });
    expect(result.status).toBe('PUBLISHED'); expect(critic).toHaveBeenCalledTimes(1);
  });

  it('fails closed before Editor without current approval', async () => {
    const editor = vi.fn();
    const result = await new BoundedSynthesisOrchestrator(new RecipeQualityOrchestrator()).synthesize({ brief: brief('dcluster_87b96a2fc22b24da2b6baa44', ['egg', 'tomato'], { sunflowerOil: 'sunflower_oil', butterRequired: 'NO' }), base: base('dcluster_87b96a2fc22b24da2b6baa44', ['egg', 'tomato']), hasCurrentApproval: async () => false, editor, critic: async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] }), publish: async () => null });
    expect(result.status).toBe('REJECT'); expect(result.editorCalls).toBe(0); expect(editor).not.toHaveBeenCalled();
  });

  it('fails closed when Editor output is invalid and does not call Critic', async () => {
    const critic = vi.fn();
    const result = await new BoundedSynthesisOrchestrator(new RecipeQualityOrchestrator()).synthesize({ brief: brief('dcluster_87b96a2fc22b24da2b6baa44', ['egg', 'tomato'], { sunflowerOil: 'sunflower_oil', butterRequired: 'NO' }), base: base('dcluster_87b96a2fc22b24da2b6baa44', ['egg', 'tomato']), hasCurrentApproval: async () => true, editor: async () => output('рис с помидорами'), critic, publish: async () => null });
    expect(result.status).toBe('REJECT'); expect(critic).not.toHaveBeenCalled();
  });

  it('preserves Julienne registry semantics without publishing', () => {
    const target = resolveSynthesisTarget('dcluster_8c521f996b1e8844f530ff12');
    expect(target.requiredTerms).toEqual(['курин', 'шампин', 'сметан', 'сыр', 'оливков']);
    expect(target.forbiddenTerms.test('рис и майонез')).toBe(true);
  });

  it.each([
    ['butter required', { sunflowerOil: 'sunflower_oil', butterRequired: 'YES' }],
    ['wrong oil decision', { sunflowerOil: 'olive_oil', butterRequired: 'NO' }],
  ])('rejects Tomato %s before Editor', async (_label, decisions) => {
    const result = await reject(tomato(['egg', 'tomato', 'sunflower_oil'], decisions));
    expect(result.status).toBe('REJECT'); expect(result.editorCalls).toBe(0);
  });

  it('rejects Tomato time over 45 minutes before Editor', async () => {
    const args = tomato(); args.base.totalTimeMinutes = 46;
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.editorCalls).toBe(0);
  });

  it('rejects Tomato unsupported required Product through exact-brief drift', async () => {
    const args = tomato(); args.base.ingredients.push({ ingredientId: 'unsupported', productId: 'butter', grams: 10, unit: 'g', optional: false });
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.reasons).toContain('PRODUCT_SELECTION_DRIFT');
  });

  it('rejects Tomato invalid quantity before Critic', async () => {
    const args = tomato(); args.base.ingredients[0]!.grams = 0;
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.criticCalls).toBe(0);
  });

  it('rejects Rice orange zest reintroduction before Editor', async () => {
    const result = await reject(rice(['rice', 'pumpkin', 'orange_zest'], { orangeZestRequired: 'YES', orangeZestIncluded: 'YES' }));
    expect(result.status).toBe('REJECT'); expect(result.editorCalls).toBe(0);
  });

  it('rejects Rice time over 45 minutes before Editor', async () => {
    const args = rice(); args.base.totalTimeMinutes = 46;
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.editorCalls).toBe(0);
  });

  it('rejects Rice wrong canonical Product through exact-brief drift', async () => {
    const args = rice(); args.base.ingredients.push({ ingredientId: 'wrong', productId: 'orange_zest', grams: 10, unit: 'g', optional: false });
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.reasons).toContain('PRODUCT_SELECTION_DRIFT');
  });

  it('rejects Rice unsupported required ingredient through exact-brief drift', async () => {
    const args = rice(); args.base.ingredients.push({ ingredientId: 'unsupported', productId: 'cinnamon', grams: 10, unit: 'g', optional: false });
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.reasons).toContain('PRODUCT_SELECTION_DRIFT');
  });

  it('rejects Rice invalid quantity before Critic', async () => {
    const args = rice(); args.base.ingredients[0]!.grams = -1;
    const result = await reject(args); expect(result.status).toBe('REJECT'); expect(result.criticCalls).toBe(0);
  });
});
