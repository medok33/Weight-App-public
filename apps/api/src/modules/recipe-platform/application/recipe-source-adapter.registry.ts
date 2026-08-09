import { Injectable } from '@nestjs/common';
import {
  RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
  type RecipeSourceAdapterTypeAllowlist,
} from '../domain/recipe-external-source.policy';
import type { RecipeSourceAdapter } from '../domain/recipe-source-adapter.contract';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';
import { FoodRuSourceAdapter } from './food-ru/food-ru-source.adapter';
import { IamCookSourceAdapter } from './iamcook/iamcook-source.adapter';
import { RussianFoodSourceAdapter } from './russianfood/russianfood-source.adapter';
import { TestRecipeSourceAdapter } from './test-recipe-source.adapter';

/**
 * Static allowlisted registry — no dynamic eval / remote import URL.
 * Source rows may only reference adapterType values registered here.
 */
@Injectable()
export class RecipeSourceAdapterRegistry {
  private readonly byType = new Map<string, RecipeSourceAdapter>();

  constructor() {
    this.register(new TestRecipeSourceAdapter());
    this.register(new FoodRuSourceAdapter());
    this.register(new IamCookSourceAdapter());
    this.register(new RussianFoodSourceAdapter());
  }

  register(adapter: RecipeSourceAdapter): void {
    if (this.byType.has(adapter.adapterType)) {
      throw new Error('RECIPE_SOURCE_ADAPTER_TYPE_DUPLICATE');
    }
    if (adapter.contractVersion !== RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION) {
      throw new Error('RECIPE_SOURCE_ADAPTER_CONTRACT_MISMATCH');
    }
    this.byType.set(adapter.adapterType, adapter);
  }

  listTypes(): string[] {
    return [...this.byType.keys()];
  }

  has(adapterType: string): boolean {
    return this.byType.has(adapterType);
  }

  getOrThrow(adapterType: string): RecipeSourceAdapter {
    if (adapterType === 'NOT_CONFIGURED') {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: 'unknown',
        operation: 'resolve',
        retryable: false,
        safeMessage: 'Adapter is not configured for this source',
        correlationId: 'n/a',
        parserVersion: 'none',
      });
    }
    const adapter = this.byType.get(adapterType);
    if (!adapter) {
      throw new RecipeSourceAdapterError({
        code: 'CONFIGURATION_ERROR',
        sourceCode: 'unknown',
        operation: 'resolve',
        retryable: false,
        safeMessage: 'Unknown adapter type',
        correlationId: 'n/a',
        parserVersion: 'none',
      });
    }
    if (adapter.contractVersion !== RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION) {
      throw new RecipeSourceAdapterError({
        code: 'CONTRACT_MISMATCH',
        sourceCode: 'unknown',
        operation: 'resolve',
        retryable: false,
        safeMessage: 'Adapter contract version mismatch',
        correlationId: 'n/a',
        parserVersion: adapter.parserVersion,
      });
    }
    return adapter;
  }

  isAllowlistedType(adapterType: string): adapterType is RecipeSourceAdapterTypeAllowlist {
    return adapterType === 'NOT_CONFIGURED' || this.byType.has(adapterType);
  }
}
