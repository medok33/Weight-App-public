import {
  assertDefaultUnit,
  assertProductForm,
  normalizeProductAlias,
  validateAveragePieceWeightGrams,
  validateDensity,
  validateEdiblePartPercent,
  validateFatPercent,
  validateYieldCoefficient,
} from '../../product-catalog/domain/product-foundation.policy';
import { validateSubstitutionEdge } from '../../product-catalog/domain/product-roles-retail.policy';
import {
  PRODUCT_REVIEW_QUEUES,
  PRODUCT_REVIEW_STATUSES,
  PRODUCT_STATUSES,
  type CreateProductInput,
  type ProductReviewQueueCode,
  type ProductReviewStatus,
  type ProductStatus,
  type UpdateProductInput,
} from './product-admin.types';

const RATE_BUCKETS = new Map<string, { count: number; resetAt: number }>();

export function assertProductStatus(status: string): ProductStatus {
  if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) {
    throw new Error('PRODUCT_STATUS_INVALID');
  }
  return status as ProductStatus;
}

export function assertReviewStatus(status: string): ProductReviewStatus {
  if (!(PRODUCT_REVIEW_STATUSES as readonly string[]).includes(status)) {
    throw new Error('PRODUCT_REVIEW_STATUS_INVALID');
  }
  return status as ProductReviewStatus;
}

export function assertQueueCode(code: string): ProductReviewQueueCode {
  if (!(PRODUCT_REVIEW_QUEUES as readonly string[]).includes(code)) {
    throw new Error('PRODUCT_REVIEW_QUEUE_INVALID');
  }
  return code as ProductReviewQueueCode;
}

export function assertSafeStatusTransition(
  from: ProductStatus,
  to: ProductStatus,
): void {
  if (from === to) return;
  if (from === 'MERGED') throw new Error('PRODUCT_STATUS_TRANSITION_INVALID');
  if (to === 'MERGED') throw new Error('PRODUCT_STATUS_TRANSITION_INVALID'); // merge endpoint only
  const allowed: Record<ProductStatus, ProductStatus[]> = {
    ACTIVE: ['INACTIVE', 'SUSPENDED', 'ARCHIVED'],
    INACTIVE: ['ACTIVE', 'ARCHIVED', 'SUSPENDED'],
    SUSPENDED: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
    ARCHIVED: ['ACTIVE', 'INACTIVE'],
    MERGED: [],
  };
  if (!allowed[from]?.includes(to)) throw new Error('PRODUCT_STATUS_TRANSITION_INVALID');
}

export function sanitizeCreateProduct(input: CreateProductInput): CreateProductInput {
  const canonicalName = String(input.canonicalName ?? '').trim();
  const productKey = String(input.productKey ?? '').trim().toLowerCase();
  if (!canonicalName || canonicalName.length > 200) throw new Error('PRODUCT_NAME_INVALID');
  if (!productKey || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(productKey)) {
    throw new Error('PRODUCT_KEY_INVALID');
  }
  if (!input.categoryId) throw new Error('PRODUCT_CATEGORY_REQUIRED');
  const form = assertProductForm(String(input.form));
  const defaultUnit = assertDefaultUnit(String(input.defaultUnit));
  validateFatPercent(input.fatPercent);
  validateEdiblePartPercent(input.ediblePartPercent);
  validateDensity(input.density);
  validateYieldCoefficient(input.yieldCoefficient);
  validateAveragePieceWeightGrams(input.averagePieceWeightGrams);
  return {
    ...input,
    canonicalName,
    productKey,
    form,
    defaultUnit,
    unit: input.unit ? assertDefaultUnit(String(input.unit)) : defaultUnit,
  };
}

export function sanitizeUpdateProduct(input: UpdateProductInput): UpdateProductInput {
  if (!(input.rowVersion >= 1)) throw new Error('PRODUCT_ROW_VERSION_REQUIRED');
  if (input.canonicalName != null) {
    const name = String(input.canonicalName).trim();
    if (!name || name.length > 200) throw new Error('PRODUCT_NAME_INVALID');
    input = { ...input, canonicalName: name };
  }
  if (input.form != null && input.form !== '') assertProductForm(input.form);
  if (input.defaultUnit != null && input.defaultUnit !== '') assertDefaultUnit(input.defaultUnit);
  if (input.status != null) {
    const status = assertProductStatus(input.status);
    if (status === 'MERGED') throw new Error('PRODUCT_STATUS_TRANSITION_INVALID');
  }
  if (input.reviewStatus != null) assertReviewStatus(input.reviewStatus);
  validateFatPercent(input.fatPercent);
  validateEdiblePartPercent(input.ediblePartPercent);
  validateDensity(input.density);
  validateYieldCoefficient(input.yieldCoefficient);
  validateAveragePieceWeightGrams(input.averagePieceWeightGrams);
  // Strip mass-assignment fields if somehow present.
  const forbidden = input as UpdateProductInput & {
    reviewedAt?: unknown;
    reviewedBy?: unknown;
    confidence?: unknown;
    mergedAt?: unknown;
    mergedBy?: unknown;
    canonicalProductId?: unknown;
  };
  if (
    forbidden.reviewedAt != null ||
    forbidden.reviewedBy != null ||
    forbidden.mergedAt != null ||
    forbidden.mergedBy != null ||
    forbidden.canonicalProductId != null
  ) {
    throw new Error('PRODUCT_MASS_ASSIGNMENT_FORBIDDEN');
  }
  return input;
}

export function sanitizeAliasInput(alias: string): { alias: string; normalizedAlias: string } {
  const trimmed = String(alias ?? '').trim();
  if (!trimmed || trimmed.length > 200) throw new Error('PRODUCT_ALIAS_INVALID');
  return { alias: trimmed, normalizedAlias: normalizeProductAlias(trimmed) };
}

export function assertSubstitutionCreate(input: {
  sourceProductId: string;
  replacementProductId: string;
  replacementRatio: number;
  replacementRatioMin: number;
  replacementRatioMax: number;
}): void {
  validateSubstitutionEdge(input);
}

/** Simple per-actor rate limit for dangerous ops (merge / mass write). */
export function assertRateLimit(key: string, limit = 20, windowMs = 60_000): void {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new Error('PRODUCT_ADMIN_RATE_LIMITED');
}

export function stripInternalFields<T extends Record<string, unknown>>(row: T): T {
  const clone = { ...row };
  delete (clone as { sql?: unknown }).sql;
  delete (clone as { stack?: unknown }).stack;
  return clone;
}
