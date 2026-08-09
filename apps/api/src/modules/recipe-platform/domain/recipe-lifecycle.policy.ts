/** STEP_205 RecipeVersion operational lifecycle (separate from immutable snapshot row). */

export type RecipeLifecycleStatus =
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'SUSPENDED'
  | 'ARCHIVED'
  | 'REJECTED';

export type RecipeValidationStatus = 'VALID' | 'NEEDS_REVALIDATION' | 'BLOCKED';

/** Suspend fallback: prefer last SUPERSEDED+VALID; else NULL current (exclude from generation). */
export const SUSPEND_FALLBACK_POLICY = 'A_PREVIOUS_SUPERSEDED_VALID_ELSE_NULL' as const;

const ALLOWED: Record<RecipeLifecycleStatus, readonly RecipeLifecycleStatus[]> = {
  IN_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PUBLISHED', 'REJECTED'],
  PUBLISHED: ['SUPERSEDED', 'SUSPENDED', 'ARCHIVED'],
  SUPERSEDED: ['PUBLISHED'], // OWNER restore only when VALID
  SUSPENDED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: [],
  REJECTED: [],
};

export function assertLifecycleTransition(
  from: RecipeLifecycleStatus,
  to: RecipeLifecycleStatus,
): void {
  if (!(ALLOWED[from] ?? []).includes(to)) {
    throw new Error('RECIPE_LIFECYCLE_TRANSITION_INVALID');
  }
}

export function canPublishLifecycle(input: {
  lifecycleStatus: RecipeLifecycleStatus;
  validationStatus: RecipeValidationStatus;
}): void {
  if (input.lifecycleStatus !== 'APPROVED' && input.lifecycleStatus !== 'PUBLISHED') {
    // restore path uses SUPERSEDED → PUBLISHED separately
    if (input.lifecycleStatus !== 'SUPERSEDED' && input.lifecycleStatus !== 'SUSPENDED') {
      throw new Error('RECIPE_LIFECYCLE_PUBLISH_NOT_APPROVED');
    }
  }
  if (input.lifecycleStatus === 'APPROVED' && input.validationStatus !== 'VALID') {
    throw new Error('RECIPE_LIFECYCLE_PUBLISH_NOT_VALID');
  }
  if (
    (input.lifecycleStatus === 'SUPERSEDED' || input.lifecycleStatus === 'SUSPENDED') &&
    input.validationStatus !== 'VALID'
  ) {
    throw new Error('RECIPE_LIFECYCLE_RESTORE_NOT_VALID');
  }
}

export function isUsableForNewPlans(input: {
  lifecycleStatus: string | null | undefined;
  validationStatus: string | null | undefined;
  currentVersionId: string | null | undefined;
  recipeVersionId: string | null | undefined;
}): boolean {
  if (!input.recipeVersionId || !input.currentVersionId) return false;
  if (input.recipeVersionId !== input.currentVersionId) return false;
  if (input.lifecycleStatus !== 'PUBLISHED') return false;
  if (input.validationStatus !== 'VALID') return false;
  return true;
}

export type RevalidationReasonCode =
  | 'PRODUCT_NUTRITION_VERSION_CHANGED'
  | 'PRODUCT_ALLERGEN_CHANGED'
  | 'PRODUCT_DIETARY_TAG_CHANGED'
  | 'PRODUCT_MERGED'
  | 'PRODUCT_SUSPENDED'
  | 'PRODUCT_FORM_CHANGED'
  | 'PRODUCT_DEFAULT_UNIT_CHANGED'
  | 'PRODUCT_COEFFICIENT_CHANGED';

export type RevalidationSeverity = 'WARNING' | 'HIGH' | 'CRITICAL';

export function mapImpactPolicy(reason: RevalidationReasonCode): {
  severity: RevalidationSeverity;
  validationStatus: RecipeValidationStatus;
  allowConfirmCurrent: boolean;
} {
  switch (reason) {
    case 'PRODUCT_NUTRITION_VERSION_CHANGED':
      return { severity: 'WARNING', validationStatus: 'NEEDS_REVALIDATION', allowConfirmCurrent: true };
    case 'PRODUCT_FORM_CHANGED':
    case 'PRODUCT_DEFAULT_UNIT_CHANGED':
    case 'PRODUCT_COEFFICIENT_CHANGED':
      return { severity: 'WARNING', validationStatus: 'NEEDS_REVALIDATION', allowConfirmCurrent: true };
    case 'PRODUCT_ALLERGEN_CHANGED':
    case 'PRODUCT_DIETARY_TAG_CHANGED':
      return { severity: 'HIGH', validationStatus: 'NEEDS_REVALIDATION', allowConfirmCurrent: false };
    case 'PRODUCT_MERGED':
    case 'PRODUCT_SUSPENDED':
      return { severity: 'CRITICAL', validationStatus: 'BLOCKED', allowConfirmCurrent: false };
    default:
      return { severity: 'WARNING', validationStatus: 'NEEDS_REVALIDATION', allowConfirmCurrent: false };
  }
}

export function buildRevalidationDedupeKey(input: {
  recipeVersionId: string;
  productId: string;
  reasonCode: RevalidationReasonCode;
}): string {
  return `${input.recipeVersionId}:${input.productId}:${input.reasonCode}`;
}

/** Price / alias / retailer events intentionally do not create revalidation tasks. */
export const NON_IMPACTING_PRODUCT_EVENTS = [
  'PRICE_OBSERVATION',
  'RETAIL_PRODUCT_PRICE',
  'PRODUCT_ALIAS_CORRECTION',
  'RETAILER_MAPPING',
  'PACKAGE_PRICE_CHANGE',
  'CATEGORY_DISPLAY_ONLY',
] as const;
