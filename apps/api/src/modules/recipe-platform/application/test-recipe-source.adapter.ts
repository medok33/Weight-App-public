import { createHash } from 'node:crypto';
import type {
  RecipeSourceAdapter,
  RecipeSourceAdapterDescriptor,
  RecipeSourceExecutionContext,
  RecipeSourceSearchInput,
  SourceAdapterHealthResult,
  SourceAvailabilityResult,
  SourceRecipeCandidatePayload,
  SourceRecipeCard,
} from '../domain/recipe-source-adapter.contract';
import {
  assertSearchInput,
  RecipeSourceAdapterError,
} from '../domain/recipe-source-adapter.contract';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../domain/recipe-external-source.policy';

/**
 * Deterministic in-memory adapter for contract tests.
 * Never performs network I/O. TEST_ONLY sources only.
 */
export class TestRecipeSourceAdapter implements RecipeSourceAdapter {
  readonly adapterType = 'TEST_DETERMINISTIC';
  readonly contractVersion = RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION;
  readonly parserVersion = 'test-parser/v1';

  readonly descriptor: RecipeSourceAdapterDescriptor = {
    adapterType: this.adapterType,
    contractVersion: this.contractVersion,
    parserVersion: this.parserVersion,
    supportedOperations: ['searchByProducts', 'fetchCandidate', 'checkAvailability', 'healthCheck'],
    collectionModes: ['API', 'PUBLIC_FEED'],
    supportedLocales: ['ru', 'en'],
    supportedSourceCodes: ['test_fixture_source'],
  };

  async searchByProducts(
    input: RecipeSourceSearchInput,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCard[]> {
    this.assertContext(context, 'searchByProducts');
    assertSearchInput(input);
    const limit = Math.min(input.resultLimit, 3);
    const cards: SourceRecipeCard[] = [];
    for (let i = 0; i < limit; i += 1) {
      const externalId = `test-card-${i + 1}`;
      cards.push({
        sourceCode: context.sourceCode,
        externalId,
        sourceUrl: `https://fixtures.local/recipes/${externalId}`,
        title: `Test dish ${i + 1}`,
        shortDescription: 'Deterministic test card',
        imageReference: null,
        estimatedTimeMinutes: 25 + i,
        servings: 2,
        visibleIngredientNames: ['курица', 'гречка'].slice(0, 1 + (i % 2)),
        sourceCategories: ['MAIN'],
        availability: 'AVAILABLE',
        fetchedAt: new Date(0).toISOString(),
        parserVersion: this.parserVersion,
        confidence: 0.9,
        rawReferenceHash: createHash('sha256').update(externalId).digest('hex').slice(0, 16),
      });
    }
    return cards;
  }

  async fetchCandidate(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceRecipeCandidatePayload> {
    this.assertContext(context, 'fetchCandidate');
    if (!externalId?.trim()) {
      throw new RecipeSourceAdapterError({
        code: 'NOT_FOUND',
        sourceCode: context.sourceCode,
        operation: 'fetchCandidate',
        retryable: false,
        safeMessage: 'Candidate not found',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
    return {
      sourceCode: context.sourceCode,
      externalId,
      sourceUrl: `https://fixtures.local/recipes/${externalId}`,
      title: `Test candidate ${externalId}`,
      description: 'Deterministic transport payload — not a Recipe',
      ingredients: [
        { name: 'курица', amountText: '200', unitText: 'g', notes: null },
        { name: 'гречка', amountText: '80', unitText: 'g', notes: null },
      ],
      steps: [
        { ordinal: 1, text: 'Подготовить продукты', timeMinutes: 5 },
        { ordinal: 2, text: 'Приготовить', timeMinutes: 20 },
      ],
      servings: 2,
      preparationTime: 5,
      cookingTime: 20,
      temperatures: [],
      cookingMethods: ['stove'],
      sourceNutrition: { calories: 420, note: 'non-authoritative source estimate' },
      categories: ['MAIN'],
      mediaReferences: [],
      fetchedAt: new Date(0).toISOString(),
      parserVersion: this.parserVersion,
      completeness: 'PARTIAL',
      warnings: ['SOURCE_NUTRITION_NOT_AUTHORITATIVE', 'TRANSPORT_ONLY_NOT_STAGED'],
    };
  }

  async checkAvailability(
    externalId: string,
    context: RecipeSourceExecutionContext,
  ): Promise<SourceAvailabilityResult> {
    this.assertContext(context, 'checkAvailability');
    return {
      sourceCode: context.sourceCode,
      externalId,
      available: Boolean(externalId?.trim()),
      availabilityStatus: externalId?.trim() ? 'AVAILABLE' : 'NOT_FOUND',
      reason: externalId?.trim() ? null : 'EMPTY_ID',
      checkedAt: new Date(0).toISOString(),
      parserVersion: this.parserVersion,
      correlationId: context.correlationId,
      networkCalls: 0,
    };
  }

  async healthCheck(context: RecipeSourceExecutionContext): Promise<SourceAdapterHealthResult> {
    this.assertContext(context, 'healthCheck');
    return {
      adapterType: this.adapterType,
      contractVersion: this.contractVersion,
      parserVersion: this.parserVersion,
      ok: true,
      status: 'HEALTHY',
      details: 'Deterministic test adapter — no network',
      checkedAt: new Date().toISOString(),
    };
  }

  private assertContext(context: RecipeSourceExecutionContext, operation: string): void {
    if (!context.testMode) {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: context.sourceCode,
        operation,
        retryable: false,
        safeMessage: 'Test adapter requires testMode',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
    if (context.adapterType !== this.adapterType) {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: context.sourceCode,
        operation,
        retryable: false,
        safeMessage: 'Adapter type mismatch',
        correlationId: context.correlationId,
        parserVersion: this.parserVersion,
      });
    }
  }
}
