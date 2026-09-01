import { describe, expect, it } from 'vitest';
import { RECIPE_CONTRACT_VERSION, type MethodSkeletonStep, type RecipeContractV1 } from '../domain/recipe-contract.v1';
import { RecipeQualityOrchestrator } from '../application/recipe-quality.orchestrator';
import { RecipePublicationService, assertReceiptMatchesPublication } from '../application/recipe-publication.service';

/**
 * Direct behavioral tests for the canonical verified-DRAFT boundary (07C2A-R2).
 * Rejection cases run before any database access, so a stub PrismaService is
 * enough; state/concurrency semantics live in
 * apps/api/test/database/recipe-draft-publication.persistence.spec.ts.
 */

const skeleton: MethodSkeletonStep[] = [{ stepId: 's1', order: 1, ingredientIds: ['i1'], technique: 'boil', durationMinutes: 20, temperatureC: 190 }];

function contractBase(overrides: Partial<RecipeContractV1> = {}): Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'> {
  return {
    contractVersion: RECIPE_CONTRACT_VERSION,
    recipeKey: 'draft-spec',
    versionIdentity: 'draft-spec:v1',
    title: 'Soup',
    description: 'Simple',
    servings: 2,
    yieldGrams: 400,
    totalTimeMinutes: 20,
    ingredients: [{ ingredientId: 'i1', productId: 'p1', grams: 100, unit: 'g', optional: false }],
    equipment: ['pot'],
    methodSkeleton: skeleton,
    nutrition: {},
    cost: {},
    safety: { status: 'PASS' as const, reasons: [] },
    provenance: { sourceIds: [], evidenceIds: [] },
    similarity: { autoPublish: true, decision: 'CREATE', score: 0.1 },
    cookTestStatus: 'NOT_PERFORMED' as const,
    publicationState: 'DRAFT' as const,
    ...overrides,
  } as Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'>;
}

const editor = async () => ({ title: 'Soup', description: 'Simple', steps: [{ stepId: 's1', text: 'Boil for 20 minutes at 190 C.' }] });
const criticPass = async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] });

async function verifiedFixture(overrides: { base?: Partial<RecipeContractV1>; coverage?: { requiredTerms: string[]; forbiddenTerms?: RegExp } } = {}) {
  const base = contractBase(overrides.base);
  const result = await new RecipeQualityOrchestrator().verify({
    base,
    editor,
    critic: criticPass,
    semanticCoverage: overrides.coverage ?? { requiredTerms: [] },
  });
  if (result.status !== 'AUTO_VERIFIED' || !result.contract || !result.receipt) throw new Error(`fixture not verified: ${result.reasons.join(',')}`);
  return { base, contract: result.contract, receipt: result.receipt };
}

function inputFrom(fixture: { contract: RecipeContractV1; receipt: unknown }, extra: Record<string, unknown> = {}) {
  return {
    recipeKey: fixture.contract.recipeKey,
    title: fixture.contract.title,
    description: fixture.contract.description,
    servings: fixture.contract.servings,
    yieldGrams: fixture.contract.yieldGrams,
    ingredients: [{ id: 'i1', productId: 'p1', amount: 100, unit: 'g' }],
    steps: [{ index: 1, text: 'ok', ingredientIds: ['i1'] }],
    nutrition: { total: { kcal: 1, proteinG: 1, fatG: 1, carbohydratesG: 1 }, perServing: { kcal: 1, proteinG: 1, fatG: 1, carbohydratesG: 1 }, yieldGrams: 400, servings: 2, basis: 'CANONICAL_PRODUCT_NUTRITION' as const },
    cost: { status: 'UNAVAILABLE' },
    actorId: 'actor-1',
    qualityContract: fixture.contract,
    qualityReceipt: fixture.receipt as never,
    ...extra,
  } as Parameters<RecipePublicationService['stageDraft']>[0];
}

describe('07C2A-R2 stageDraft and publication boundary (rejections)', () => {
  it('16/17: stageDraft rejects missing quality receipt and forged receipt', async () => {
    const service = new RecipePublicationService({} as never);
    const fx = await verifiedFixture();
    const input = inputFrom(fx);
    await expect(service.stageDraft({ ...input, qualityReceipt: undefined as never })).rejects.toThrow('PUBLICATION_QUALITY_RECEIPT_REQUIRED');
    const forged = { producer: 'RecipeQualityOrchestrator', deterministicValid: true, contractChecksum: fx.receipt.contractChecksum, critic: { contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] } };
    await expect(service.stageDraft({ ...input, qualityReceipt: forged as never })).rejects.toThrow('PUBLICATION_QUALITY_RECEIPT_REQUIRED');
  });

  it('18: receipt checksum mismatch rejected before database access (receipt bound to a different contract)', async () => {
    const fx = await verifiedFixture();
    const other = await verifiedFixture({ base: { title: 'Other' } as Partial<RecipeContractV1> });
    const input = inputFrom(fx, { qualityContract: other.contract });
    // The runtime receipt authority binds each receipt to its issuing contract:
    // presenting contract B with A's receipt fails verification outright.
    await expect(new RecipePublicationService({} as never).stageDraft(input)).rejects.toThrow('PUBLICATION_QUALITY_RECEIPT_REQUIRED');
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_QUALITY_RECEIPT_REQUIRED');
  });

  it('19: critic FAIL rejected (no receipt can exist, publish and stage share the gate)', async () => {
    const result = await new RecipeQualityOrchestrator().verify({ base: contractBase(), editor, critic: async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'REJECT', issues: [{ code: 'UNCLEAR_INSTRUCTION' }] }), semanticCoverage: { requiredTerms: [] } });
    expect(result.status).toBe('REJECT');
    expect(result.receipt).toBeUndefined();
    const fx = await verifiedFixture();
    const input = inputFrom(fx);
    // Critic-fail path cannot produce a receipt at all; forged PASS-style payload is rejected by the runtime authority.
    const fakeFromFail = { producer: 'RecipeQualityOrchestrator', deterministicValid: true, contractChecksum: fx.receipt.contractChecksum, critic: { contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [{ code: 'UNCLEAR_INSTRUCTION' }] } };
    await expect(new RecipePublicationService({} as never).publish({ ...input, qualityReceipt: fakeFromFail as never })).rejects.toThrow('PUBLICATION_QUALITY_RECEIPT_REQUIRED');
  });

  it('20: recipeKey mismatch rejected by shared parity validator', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { recipeKey: 'other-key' });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
    await expect(new RecipePublicationService({} as never).stageDraft(input)).rejects.toThrow('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
  });

  it('21: title mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { title: 'Другой заголовок' });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
  });

  it('22: description mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { description: 'другое описание' });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
  });

  it('23: servings mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { servings: 3 });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
  });

  it('24: yield mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { yieldGrams: 500 });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
  });

  it('25: product mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { ingredients: [{ id: 'i1', productId: 'p2', amount: 100, unit: 'g' }] });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_INGREDIENT_CONTRACT_MISMATCH');
  });

  it('26: grams mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { ingredients: [{ id: 'i1', productId: 'p1', amount: 150, unit: 'g' }] });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_INGREDIENT_CONTRACT_MISMATCH');
  });

  it('27: unit mismatch rejected', async () => {
    const fx = await verifiedFixture();
    const input = inputFrom(fx, { ingredients: [{ id: 'i1', productId: 'p1', amount: 100, unit: 'ml' }] });
    expect(() => assertReceiptMatchesPublication(input)).toThrow('PUBLICATION_INGREDIENT_CONTRACT_MISMATCH');
  });

  it('28: stageDraft rejects publicationState other than DRAFT', async () => {
    const fx = await verifiedFixture({ base: { publicationState: 'PUBLISHED' } as Partial<RecipeContractV1> });
    const input = inputFrom(fx);
    await expect(new RecipePublicationService({} as never).stageDraft(input)).rejects.toThrow('DRAFT_PUBLICATION_STATE_REQUIRED');
  });

  it('39: publish still enforces human/publication gates (no gate weakening for draft promotion)', async () => {
    const fx = await verifiedFixture({ base: { similarity: { autoPublish: false, decision: 'VARIANT', score: 0.8 } } as Partial<RecipeContractV1> });
    const input = inputFrom(fx, { similarityAutoPublish: false });
    await expect(new RecipePublicationService({} as never).publish(input)).rejects.toThrow('PUBLICATION_BLOCKED:SIMILARITY_REVIEW_REQUIRED');
  });

  it('stageDraft and publish share one parity validator export (no drifting duplicates)', () => {
    expect(typeof assertReceiptMatchesPublication).toBe('function');
    const source = RecipePublicationService.prototype.stageDraft.toString() + RecipePublicationService.prototype.publish.toString();
    expect(source).not.toContain('function assertReceiptMatchesPublication');
  });
});
