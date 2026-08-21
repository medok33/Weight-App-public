import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type NutritionDecision =
  | 'AUTHORITATIVE_PRODUCT_READY'
  | 'EXISTING_PRODUCT_FOUND'
  | 'SAFE_ALIAS_ONLY'
  | 'PRODUCT_NUTRITION_AUTHORITY_MISSING'
  | 'AMBIGUOUS_IDENTITY'
  | 'AMBIGUOUS_FORM'
  | 'GENERIC_UNBOUNDED_IDENTITY'
  | 'SOURCE_ARTIFACT'
  | 'OUT_OF_SCOPE_PACKAGED_PRODUCT';

export type NutritionEvidenceRow = {
  normalizedIngredient: string;
  canonicalIdentity: string;
  canonicalForm: string;
  authority: string;
  authorityRecordId: string;
  authorityDescription: string;
  datasetVersion: string;
  retrievedAt: string;
  energyKcalPer100g: string;
  proteinGPer100g: string;
  fatGPer100g: string;
  carbGPer100g: string;
  matchStatus: 'MATCHED' | 'NO_MATCH' | 'REJECTED';
  decision: NutritionDecision;
  reason: string;
};

const DATASET_VERSION = 'catalog-core-v3/local-authority-index-2026-07-25';
const RETRIEVED_AT = '2026-08-21';

export const NUTRITION_EVIDENCE: NutritionEvidenceRow[] = [
  ['апельсиновая цедра','orange peel/zest','RAW_PEEL','', '', '', 'NO_MATCH','PRODUCT_NUTRITION_AUTHORITY_MISSING','Accepted local authorities contain no semantically matching orange-peel record; whole orange/juice substitution is rejected.'],
  ['ванилин','vanillin','DRY_TRACE_INGREDIENT','', '', '', 'NO_MATCH','PRODUCT_NUTRITION_AUTHORITY_MISSING','No accepted food-composition record for an accounting Product; zero-calorie assumption is forbidden.'],
  ['ванильный сахар','vanilla sugar','DRY_SWEETENED_MIX','', '', '', 'REJECTED','PRODUCT_NUTRITION_AUTHORITY_MISSING','No authoritative composition for the mixture; sugar plus arbitrary vanillin ratio is not derived.'],
  ['сахар ванильный','vanilla sugar','DRY_SWEETENED_MIX','', '', '', 'REJECTED','PRODUCT_NUTRITION_AUTHORITY_MISSING','Strict lexical equivalent of vanilla sugar, but no authoritative composition is available.'],
  ['вустерширский соус','Worcestershire sauce','READY_TO_EAT_SAUCE','', '', '', 'NO_MATCH','PRODUCT_NUTRITION_AUTHORITY_MISSING','No accepted generic non-branded authority record; branded label data cannot become generic authority.'],
  ['помидоры черри','cherry tomato','RAW_CHERRY_TOMATO','', '', '', 'REJECTED','AMBIGUOUS_FORM','Generic raw tomato nutrition cannot be silently reused for a cherry-specific Product.'],
  ['тушенка','canned preserved meat','CANNED_READY_TO_EAT','', '', '', 'REJECTED','OUT_OF_SCOPE_PACKAGED_PRODUCT','Identity and composition vary by meat, fat and recipe; raw/stewed meat records are not equivalent.'],
  ['зелень','mixed greens','UNBOUNDED_MIXTURE','', '', '', 'REJECTED','GENERIC_UNBOUNDED_IDENTITY','Unbounded mixture has no deterministic canonical identity.'],
  ['масло растительное рафинированное','refined vegetable oil','REFINED_OIL_UNSPECIFIED_SOURCE','', '', '', 'REJECTED','AMBIGUOUS_IDENTITY','Oil source is unspecified; no arbitrary seed/oil family is selected.'],
  ['масло растительное сливочное','contradictory oil/butter wording','UNRESOLVED','', '', '', 'REJECTED','AMBIGUOUS_IDENTITY','Contradictory wording is fail-closed.'],
  ['масло сливочное для смазывания формы','butter','RAW_BUTTER_72PCT','USDA_FDC','USDA_FDC_MAP:butter_72pct:2026-07-25','Existing accepted butter_72pct product','catalog-core-v3/local-authority-index-2026-07-25','EXISTING_PRODUCT_FOUND','Existing canonical butter product is sufficient; preparation-purpose qualifier does not create a new Product.'],
  ['творог жирный','fat cottage cheese','COTTAGE_CHEESE_UNSPECIFIED_FAT','', '', '', 'REJECTED','AMBIGUOUS_FORM','Fat percentage is not identified; 0%, 5% and 9% variants cannot be collapsed.'],
  ['творог однородный жирный','homogeneous fat cottage cheese','COTTAGE_CHEESE_UNSPECIFIED_FAT','', '', '', 'REJECTED','AMBIGUOUS_FORM','Texture and “fatty” wording do not identify a unique nutrition authority.'],
].map((r) => {
  const hasExplicitDataset = r.length === 10;
  const datasetVersion = hasExplicitDataset ? r[6] : DATASET_VERSION;
  const matchStatus = (hasExplicitDataset ? r[7] : r[6]) as NutritionEvidenceRow['matchStatus'];
  const decision = (hasExplicitDataset ? r[8] : r[7]) as NutritionDecision;
  const reason = hasExplicitDataset ? r[9] : r[8];
  return {
    normalizedIngredient: r[0], canonicalIdentity: r[1], canonicalForm: r[2], authority: r[3], authorityRecordId: r[4], authorityDescription: r[5],
    datasetVersion, retrievedAt: RETRIEVED_AT, energyKcalPer100g: '', proteinGPer100g: '', fatGPer100g: '', carbGPer100g: '',
    matchStatus, decision, reason,
  };
});

export function normalizeNutritionIdentity(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/[(),]/g, ' ').replace(/\s+/g, ' ').replace(/^или\s+/, '').trim();
}

export function isPer100gValid(row: Pick<NutritionEvidenceRow, 'energyKcalPer100g' | 'proteinGPer100g' | 'fatGPer100g' | 'carbGPer100g'>): boolean {
  return [row.energyKcalPer100g, row.proteinGPer100g, row.fatGPer100g, row.carbGPer100g].every((value) => value === '' || Number.isFinite(Number(value)) && Number(value) >= 0);
}

export function energySanityPass(energy: number, protein: number, fat: number, carbs: number): boolean {
  const derived = protein * 4 + carbs * 4 + fat * 9;
  return energy >= 0 && derived === 0 ? energy === 0 : Math.abs(energy - derived) / Math.max(energy, 1) <= 0.35;
}

function csvCell(value: unknown): string { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
export function buildEvidenceCsv(rows = NUTRITION_EVIDENCE): string {
  const header = ['normalizedIngredient','canonicalIdentity','canonicalForm','authority','authorityRecordId','authorityDescription','datasetVersion','retrievedAt','energyKcalPer100g','proteinGPer100g','fatGPer100g','carbGPer100g','matchStatus','decision','reason'];
  return [header.join(','), ...rows.map((row) => header.map((key) => csvCell(row[key as keyof NutritionEvidenceRow])).join(',')), ''].join('\n');
}

export function writeNutritionEvidence(root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').replace(/\/$/, '').endsWith('/apps/api') ? '../..' : '.')): { csvSha256: string; manifestPath: string } {
  const dir = resolve(root, '.data/research/recipe-product-nutrition-source-01');
  mkdirSync(dir, { recursive: true });
  const csvPath = resolve(dir, 'NUTRITION-SOURCE-EVIDENCE.csv');
  const csv = buildEvidenceCsv();
  writeFileSync(csvPath, csv, 'utf8');
  const csvSha256 = createHash('sha256').update(csv).digest('hex');
  const manifest = { taskId: 'RECIPE-PRODUCT-NUTRITION-SOURCE-01', datasetVersion: DATASET_VERSION, retrievedAt: RETRIEVED_AT, evidenceType: 'authoritative-local-index', liveNutritionSourceHttpCalls: 0, liveRecipeDonorHttpCalls: 0, artifacts: [{ path: 'NUTRITION-SOURCE-EVIDENCE.csv', sha256: csvSha256, rowCount: NUTRITION_EVIDENCE.length }] };
  const manifestPath = resolve(dir, 'MANIFEST.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { csvSha256, manifestPath };
}

if (process.argv[1]?.endsWith('recipe-product-nutrition-source-01.ts')) {
  const result = writeNutritionEvidence();
  console.log(JSON.stringify({ rows: NUTRITION_EVIDENCE.length, productsReady: NUTRITION_EVIDENCE.filter((row) => row.decision === 'AUTHORITATIVE_PRODUCT_READY').length, ...result }, null, 2));
}
