import { normalizeFoodText } from './recipe-research.policy';
import type { DishConceptCluster, ResearchCandidate, SynthesisBrief } from './recipe-knowledge-synthesis.policy';

export const RECIPE_STEP_INGREDIENT_EVIDENCE_VERSION = 'recipe-step-ingredient-evidence/v1';

export type IngredientEvidenceClass = 'EXPLICIT_STRUCTURED_REFERENCE' | 'EXPLICIT_STEP_TEXT_MATCH' | 'NORMALIZED_IDENTITY_MATCH' | 'NO_SUPPORTED_LINK' | 'AMBIGUOUS';
export type IngredientStepEvidence = {
  candidateId: string;
  sourceStepOrdinal: number;
  canonicalProductId: string;
  methodRole: string;
  evidenceClass: Exclude<IngredientEvidenceClass, 'NO_SUPPORTED_LINK' | 'AMBIGUOUS'>;
  sourceUrl: string | null;
  rawSnapshotHash: string | null;
  parserVersion: string;
};
export type IngredientEvidenceMatrixRow = {
  candidateId: string;
  sourceStepOrdinal: number;
  canonicalProductId: string;
  methodRole: string;
  evidenceClass: IngredientEvidenceClass;
  sourceUrl: string | null;
  rawSnapshotHash: string | null;
};
export type IngredientStepEvidenceResult = {
  version: string;
  clusterId: string;
  conceptScope: 'CLASSIC_JULIENNE_CORE';
  links: IngredientStepEvidence[];
  matrix: IngredientEvidenceMatrixRow[];
  unsupported: IngredientEvidenceMatrixRow[];
  excludedProductIds: string[];
  sourceProseIncluded: false;
};

const CLASSIC_CORE = new Set(['chicken_breast_raw', 'mushroom_champignon_raw', 'sour_cream_15pct', 'hard_cheese_45pct', 'olive_oil']);
const PRODUCT_ALIASES: Record<string, string[]> = {
  chicken_breast_raw: ['куриное филе', 'курицу', 'курица'],
  mushroom_champignon_raw: ['шампиньон', 'шампиньоны', 'грибы', 'гриб'],
  sour_cream_15pct: ['сметана', 'сметаной', 'сметану'],
  hard_cheese_45pct: ['твердый сыр', 'сыр', 'сыром', 'сыре'],
  olive_oil: ['оливковое масло', 'оливковым маслом'],
};

function canonicalProduct(ingredient: ResearchCandidate['ingredients'][number]): string | null {
  if (ingredient.productId === 'family:сметана' || normalizeFoodText(ingredient.name).includes('сметан')) return 'sour_cream_15pct';
  if (ingredient.productId === 'family:сыр твердый' || normalizeFoodText(ingredient.name).includes('твердый сыр')) return 'hard_cheese_45pct';
  if (ingredient.productId && CLASSIC_CORE.has(ingredient.productId)) return ingredient.productId;
  return null;
}

function hasPhrase(text: string, phrase: string): boolean {
  const normalized = normalizeFoodText(text);
  const needle = normalizeFoodText(phrase);
  return needle.length > 2 && (` ${normalized} `).includes(` ${needle} `) || normalized.includes(needle);
}

function methodRole(step: NonNullable<ResearchCandidate['steps']>[number]): string {
  if (step.normalizedTechnique === 'FRY') return 'FRY';
  if (step.normalizedTechnique === 'BAKE') return 'BAKE';
  if (step.normalizedTechnique === 'GRATE') return 'PREPARE';
  return 'PREPARE';
}

export function buildIngredientStepEvidence(input: { cluster: DishConceptCluster; candidates: ResearchCandidate[]; }): IngredientStepEvidenceResult {
  const links: IngredientStepEvidence[] = [];
  const matrix: IngredientEvidenceMatrixRow[] = [];
  const unsupported: IngredientEvidenceMatrixRow[] = [];
  const excluded = new Set<string>();
  for (const candidate of input.candidates.filter((item) => input.cluster.candidateIds.includes(item.candidateId))) {
    const branchText = normalizeFoodText(candidate.title);
    if (branchText.includes('рис') || branchText.includes('майонез')) {
      for (const ingredient of candidate.ingredients) if (ingredient.productId && !CLASSIC_CORE.has(ingredient.productId)) excluded.add(ingredient.productId);
      continue;
    }
    for (const ingredient of candidate.ingredients) {
      const productId = canonicalProduct(ingredient);
      if (!productId) { if (ingredient.productId) excluded.add(ingredient.productId); continue; }
      if (!CLASSIC_CORE.has(productId)) { excluded.add(productId); continue; }
      const ingredientIndex = candidate.ingredients.indexOf(ingredient);
      for (const step of candidate.steps ?? []) {
        let evidenceClass: IngredientEvidenceClass = 'NO_SUPPORTED_LINK';
        if (step.ingredientRefs?.some((ref) => ref.ingredientIndex === ingredientIndex && ['EXACT', 'NORMALIZED_MATCH', 'STEM_MATCH'].includes(ref.confidence))) evidenceClass = 'EXPLICIT_STRUCTURED_REFERENCE';
        else if (step.sourceText && (PRODUCT_ALIASES[productId] ?? []).some((alias) => hasPhrase(step.sourceText!, alias))) evidenceClass = 'EXPLICIT_STEP_TEXT_MATCH';
        if (evidenceClass === 'NO_SUPPORTED_LINK') continue;
        const row: IngredientStepEvidence = { candidateId: candidate.candidateId, sourceStepOrdinal: step.ordinal, canonicalProductId: productId, methodRole: methodRole(step), evidenceClass, sourceUrl: candidate.provenance?.sourceUrl ?? null, rawSnapshotHash: candidate.provenance?.rawSnapshotHash ?? null, parserVersion: RECIPE_STEP_INGREDIENT_EVIDENCE_VERSION };
        links.push(row); matrix.push(row);
      }
      if (!links.some((row) => row.candidateId === candidate.candidateId && row.canonicalProductId === productId)) {
        const row: IngredientEvidenceMatrixRow = { candidateId: candidate.candidateId, sourceStepOrdinal: 0, canonicalProductId: productId, methodRole: 'UNRESOLVED', evidenceClass: 'NO_SUPPORTED_LINK', sourceUrl: candidate.provenance?.sourceUrl ?? null, rawSnapshotHash: candidate.provenance?.rawSnapshotHash ?? null };
        matrix.push(row); unsupported.push(row);
      }
    }
  }
  return { version: RECIPE_STEP_INGREDIENT_EVIDENCE_VERSION, clusterId: input.cluster.clusterId, conceptScope: 'CLASSIC_JULIENNE_CORE', links, matrix, unsupported, excludedProductIds: [...excluded].sort(), sourceProseIncluded: false };
}

export function attachIngredientStepEvidence(brief: SynthesisBrief, evidence: IngredientStepEvidenceResult): SynthesisBrief {
  return { ...brief, evidenceSummary: { ...brief.evidenceSummary, ingredientStepEvidence: evidence } };
}
