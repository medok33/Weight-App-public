export type SubstitutionKind = 'REPLACE_DISH' | 'REPLACE_INGREDIENT';
export type SubstitutionClassification = 'EQUIVALENT' | 'ADJUSTABLE' | 'CONFLICTING' | 'BLOCKED';

export type SubstitutionCandidate = {
  candidateId: string;
  candidateType: SubstitutionKind;
  recipeId: string | null;
  productId: string | null;
  name: string;
  suggestedPortionGrams: number;
  originalPortionGrams: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  nutrientDelta: {
    calories: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    caloriesPct: number;
    proteinPct: number;
    fatPct: number;
    carbsPct: number;
  };
  costDeltaRub: number | null;
  consumedCostRub: number | null;
  packageCostRub: number | null;
  preparationMinutes: number;
  dietaryTags: string[];
  classification: SubstitutionClassification;
  reasons: string[];
  warnings: string[];
  compensationOptions: string[];
  provenance?: 'CURATED_PRODUCT_SUBSTITUTION' | 'HEURISTIC_CATALOG_MATCH';
  culinaryRoleCode?: string | null;
  nutritionImpact?: string | null;
  textureImpact?: string | null;
  supportedMethods?: string[];
  suggestedAmountGrams?: number | null;
  baseRatio?: number | null;
  adjustedRatio?: number | null;
  ratioReason?: string | null;
};

export type SubstitutionListResponse = {
  mealItemId: string;
  kind: SubstitutionKind;
  candidates: SubstitutionCandidate[];
  blockedCount: number;
  noCandidatesMessage: string | null;
};

export type SubstitutionPreview = {
  mealPlanId: string;
  mealPlanVersion: number;
  mealItemId: string;
  operation: SubstitutionKind;
  candidateId: string;
  classification: SubstitutionClassification;
  before: {
    dishName: string;
    portionGrams: number;
    macros: { calories: number; proteinG: number; fatG: number; carbsG: number };
    consumedCostRub: number | null;
  };
  after: {
    dishName: string;
    portionGrams: number;
    macros: { calories: number; proteinG: number; fatG: number; carbsG: number };
    consumedCostRub: number | null;
  };
  dayBalance: {
    before: { calories: number };
    after: { calories: number };
    target: { calories: number };
  };
  weekBalance: {
    avgDailyCalories: { before: number; after: number };
  };
  cost: {
    dishConsumedDeltaRub: number | null;
    incomplete: boolean;
  };
  shoppingListDelta: {
    removed: Array<{ displayName: string; amount: number; unit: string }>;
    added: Array<{ displayName: string; amount: number; unit: string }>;
  };
  goalImpact: {
    status: string;
    message: string;
    etaChanged: boolean;
  };
  warnings: string[];
  compensationOptions: string[];
  keepPlanHints: string[];
  confirmationToken: string;
  proposedVersion: number;
  revisionPlanId: string;
};
