import { normalizeFoodText } from './recipe-research.policy';

export const SYNTHESIS_PRODUCT_POLICY_VERSION = 'recipe-synthesis-product-policy/v1';

export type SynthesisPolicyClass =
  | 'AUTO_SYNTHESIS_DEFAULT_ALLOWED'
  | 'EXPLICIT_RECIPE_DESIGN_CHOICE_ALLOWED'
  | 'OWNER_POLICY_REQUIRED'
  | 'NO_SAFE_DEFAULT'
  | 'PRODUCT_CATALOG_GAP'
  | 'RESEARCH_CONFLICT';

export type SynthesisPolicyEntry = {
  familyId: string;
  defaultProductId: string | null;
  policyClass: SynthesisPolicyClass;
  reason: string;
  authority: 'WEIGHT_APP_SYNTHESIS_POLICY';
  allowedContexts: string[];
  forbiddenContexts: string[];
  policyVersion: string;
};

/**
 * Defaults are intentionally sparse. Source evidence remains generic; these
 * entries are only consulted after a new Weight App recipe is being designed.
 */
export const SYNTHESIS_PRODUCT_POLICY: readonly SynthesisPolicyEntry[] = [
  {
    familyId: 'соль',
    defaultProductId: 'salt_table',
    policyClass: 'AUTO_SYNTHESIS_DEFAULT_ALLOWED',
    reason: 'Generic culinary salt has one accepted canonical table-salt identity in the recipe catalog; no food-class, form or meaningful qualifier is changed.',
    authority: 'WEIGHT_APP_SYNTHESIS_POLICY',
    allowedContexts: ['new-recipe-synthesis'],
    forbiddenContexts: ['source-resolution', 'explicit-product', 'explicit-form', 'research-evidence'],
    policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION,
  },
  { familyId: 'молоко', defaultProductId: null, policyClass: 'OWNER_POLICY_REQUIRED', reason: '1%, 2.5%, 3.2% and legacy milk variants require a product-owner fat preference.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: ['new-recipe-synthesis'], forbiddenContexts: ['source-resolution'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'сметана', defaultProductId: null, policyClass: 'OWNER_POLICY_REQUIRED', reason: '10%, 15% and 20% sour cream materially change nutrition and require owner preference.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: ['new-recipe-synthesis'], forbiddenContexts: ['source-resolution'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'кефир', defaultProductId: null, policyClass: 'OWNER_POLICY_REQUIRED', reason: 'Kefir fat percentage is a product-design choice.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: ['new-recipe-synthesis'], forbiddenContexts: ['source-resolution'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'растительное масло', defaultProductId: null, policyClass: 'OWNER_POLICY_REQUIRED', reason: 'Oil source (sunflower, olive, rapeseed, etc.) changes culinary identity and nutrition.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: ['new-recipe-synthesis'], forbiddenContexts: ['source-resolution'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'мука', defaultProductId: null, policyClass: 'OWNER_POLICY_REQUIRED', reason: 'Wheat, rye, rice, corn and buckwheat flour are not interchangeable.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: ['new-recipe-synthesis'], forbiddenContexts: ['source-resolution'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'яйцо', defaultProductId: null, policyClass: 'NO_SAFE_DEFAULT', reason: 'Raw, cooked, fried and quail eggs differ in form or identity.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: [], forbiddenContexts: ['source-resolution', 'new-recipe-synthesis'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'пшено', defaultProductId: null, policyClass: 'NO_SAFE_DEFAULT', reason: 'Dry and boiled millet are distinct forms; no source form may be invented.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: [], forbiddenContexts: ['source-resolution', 'new-recipe-synthesis'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'Лук', defaultProductId: null, policyClass: 'NO_SAFE_DEFAULT', reason: 'Leek, bulb, green, baked and powdered onion are distinct forms.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: [], forbiddenContexts: ['source-resolution', 'new-recipe-synthesis'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'крахмал', defaultProductId: null, policyClass: 'OWNER_POLICY_REQUIRED', reason: 'Corn and potato starch are distinct canonical products.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: ['new-recipe-synthesis'], forbiddenContexts: ['source-resolution'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'масло', defaultProductId: null, policyClass: 'NO_SAFE_DEFAULT', reason: 'Butter, ghee and plant oils are different food identities.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: [], forbiddenContexts: ['source-resolution', 'new-recipe-synthesis'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'фарш', defaultProductId: null, policyClass: 'NO_SAFE_DEFAULT', reason: 'Beef, pork and chicken mince materially change the recipe identity.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: [], forbiddenContexts: ['source-resolution', 'new-recipe-synthesis'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
  { familyId: 'Творог жирностью 5%', defaultProductId: null, policyClass: 'NO_SAFE_DEFAULT', reason: 'The family row is semantically malformed and must not be selected by a default.', authority: 'WEIGHT_APP_SYNTHESIS_POLICY', allowedContexts: [], forbiddenContexts: ['source-resolution', 'new-recipe-synthesis'], policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION },
];

export type SynthesisDefaultInput = {
  sourceIdentity: string | null;
  sourceName: string;
  explicitQualifiers: string[];
  candidateProductIds: string[];
  nutritionVersionProductIds: string[];
  researchConflict: boolean;
};

export type SynthesisDefaultDecision = {
  applied: boolean;
  policyClass: SynthesisPolicyClass;
  defaultProductId: string | null;
  selectionAuthority: 'WEIGHT_APP_SYNTHESIS_POLICY' | 'NONE';
  sourceInterpretationChanged: 'NO';
  policyVersion: string;
  reason: string;
};

export function resolveSynthesisDefault(input: SynthesisDefaultInput): SynthesisDefaultDecision {
  const family = normalizeFoodText(input.sourceIdentity ?? input.sourceName).trim();
  const entry = SYNTHESIS_PRODUCT_POLICY.find((candidate) => normalizeFoodText(candidate.familyId).trim() === family);
  const none = (policyClass: SynthesisPolicyClass, reason: string): SynthesisDefaultDecision => ({ applied: false, policyClass, defaultProductId: null, selectionAuthority: 'NONE', sourceInterpretationChanged: 'NO', policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION, reason });
  if (!entry) return none('NO_SAFE_DEFAULT', 'No versioned policy entry exists for this family.');
  if (input.researchConflict) return none('RESEARCH_CONFLICT', 'Research conflict blocks synthesis default.');
  if (input.explicitQualifiers.length > 0) return none(entry.policyClass, 'Explicit source/form evidence has priority over synthesis policy.');
  if (entry.policyClass !== 'AUTO_SYNTHESIS_DEFAULT_ALLOWED' || !entry.defaultProductId) return none(entry.policyClass, entry.reason);
  if (!input.candidateProductIds.includes(entry.defaultProductId)) return none('NO_SAFE_DEFAULT', 'Policy product is not among semantically compatible candidates.');
  if (!input.nutritionVersionProductIds.includes(entry.defaultProductId)) return none('NO_SAFE_DEFAULT', 'Policy product lacks ProductNutritionVersion.');
  return { applied: true, policyClass: entry.policyClass, defaultProductId: entry.defaultProductId, selectionAuthority: entry.authority, sourceInterpretationChanged: 'NO', policyVersion: entry.policyVersion, reason: entry.reason };
}
