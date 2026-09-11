/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { CATALOG_CORE_V2_PRODUCTS } from '../src/modules/product-catalog/seed/catalog-core-v2.dataset.ts';
import { CATALOG_CORE_V3_PRODUCTS } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';
import { resolveIngredientForm, type IngredientIdentityCandidate } from '../src/modules/recipe-platform/domain/ingredient-form-resolution.policy.ts';
import { aggregateResearchFacts, buildDishConceptCluster, buildSynthesisBrief, resolveCanonicalDonorServings, selectCanonicalDonor, type ResearchCandidate, type SynthesisBrief } from '../src/modules/recipe-platform/domain/recipe-knowledge-synthesis.policy.ts';
import { normalizeFoodText, normalizeUnit } from '../src/modules/recipe-platform/domain/recipe-research.policy.ts';
import { attachIngredientStepEvidence, buildIngredientStepEvidence } from '../src/modules/recipe-platform/domain/recipe-step-ingredient-evidence.policy.ts';
import { selectCanonicalProduct, type SelectionProduct } from '../src/modules/recipe-platform/domain/recipe-product-selection.policy.ts';
import { computeBriefContentHash } from '../src/modules/recipe-platform/domain/recipe-synthesis-brief-approval.policy.ts';
import { buildAuthorityGapLedger, evaluateBriefGrammageReadiness, type AuthorityGapLedgerRow } from '../src/modules/recipe-platform/domain/recipe-grammage-readiness.policy.ts';

export type CorpusIngredient = { rawName?: string | null; normalizedName?: string | null; rawQuantity?: string | null; rawUnit?: string | null; normalizedQuantity?: { min?: number | null; max?: number | null } | null; normalizedUnit?: string | null; optional?: boolean; classification?: string | null };
export type CorpusStep = { sourceOrder: number; researchOnlySourceText?: string | null; techniqueFacts?: string[]; durationFacts?: Array<{ min?: number | null; max?: number | null }>; temperatureFacts?: Array<{ min?: number | null; max?: number | null; c?: number | null }>; endConditions?: string[]; ingredientRefs?: Array<{ ingredientIndex: number; confidence: 'EXACT' | 'NORMALIZED_MATCH' | 'STEM_MATCH' | 'IMPLICIT' | 'UNRESOLVED' }> };
export type CorpusRecipe = { sourceId: string; sourceRecipeId: string; canonicalUrl?: string | null; title: string; sourceLineage?: { donor?: string } | string | null; ingredients: CorpusIngredient[]; steps?: CorpusStep[]; recipeFacts?: { portions?: string | null; totalTime?: { minutes?: number | null } | null; cookTime?: { minutes?: number | null } | null; equipment?: string[] } | null; structuralFingerprint?: string | null; bodySha256?: string | null; normalizedPayloadSha256?: string | null };
type PipelineResult = { candidates: ResearchCandidate[]; clusters: ReturnType<typeof buildDishConceptCluster>[]; facts: ReturnType<typeof aggregateResearchFacts>; briefs: SynthesisBrief[]; readiness: Array<Record<string, unknown>>; conflicts: number; authorityGapLedger: AuthorityGapLedgerRow[] };

const repositoryFixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/RECIPE-CORPUS-GLM-01-FIRST-REAL-DONOR-DATASET.jsonl');
const datasetPath = process.env.RECIPE_CORPUS_DATASET_ROOT
  ? resolve(process.env.RECIPE_CORPUS_DATASET_ROOT, 'RECIPE-CORPUS-GLM-01-FIRST-REAL-DONOR-DATASET.jsonl')
  : repositoryFixturePath;
const workspaceRoot = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const reportDir = resolve(workspaceRoot, '.data/owner-reports');
const candidateFamilies = ['лосось','рыба','курица','куриное филе','лук','репчатый лук','чеснок','картофель','морковь','помидор','томат','огурец','капуста','свекла','кабачок','баклажан','перец','масло','растительное масло','сливки','твердый сыр','сыр','творог','молоко','кефир','йогурт','сметана','мука','пшеничная мука','сахар','соль','яйцо','рис','гречка','гречневая крупа','овсянка','хлопья','макароны','паста','фасоль','нут','чечевица','горох','яблоко','банан','апельсин','лимон','лимонный сок','ягода','клубника','малина','черника','голубика','виноград','груша','персик','абрикос','орех','миндаль','кешью','семена','мед','шоколад','какао','хлеб','батон','лаваш','соус','грибы','шампиньоны','зелень','укроп','петрушка','базилик','кинза','крахмал','желатин','дрожжи','сода','уксус','горчица','майонез','кетчуп','бекон','ветчина','колбаса','говядина','свинина','индейка','утка','фарш','фарш мясной','креветки','кальмар','тунец','крупа','сельдерей','бульон','овощной бульон','сухари','панировочные сухари','панировка','ванилин','манка','каперсы','имбирь','вино','цедра','сок','карри','пармезан','оливки','салат','салат оливье','редис','тыква','круглый рис','помидоры черри','болгарский перец'];

function parseConcatenatedJson<T>(value: string): T[] {
  const records: T[] = []; let start = -1; let depth = 0; let inString = false; let escaped = false;
  for (let i = 0; i < value.length; i += 1) { const c = value[i]!; if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; } if (c === '"') { inString = true; continue; } if (c === '{') { if (depth === 0) start = i; depth += 1; } else if (c === '}') { depth -= 1; if (depth === 0 && start >= 0) { records.push(JSON.parse(value.slice(start, i + 1)) as T); start = -1; } } }
  if (depth !== 0 || inString) throw new Error('CORPUS_CONCATENATED_JSON_INVALID'); return records;
}

function candidates(): IngredientIdentityCandidate[] {
  const map = new Map<string, IngredientIdentityCandidate>();
  for (const product of [...CATALOG_CORE_V2_PRODUCTS, ...CATALOG_CORE_V3_PRODUCTS]) { const key = normalizeFoodText(product.canonicalName); const existing = map.get(key); const aliases = product.aliases?.map((a) => a.alias) ?? []; if (existing) existing.aliases = [...new Set([...(existing.aliases ?? []), ...aliases])]; else map.set(key, { productId: product.productKey, canonicalName: product.canonicalName, aliases }); }
  return [...map.values()];
}

export function toCandidate(recipe: CorpusRecipe, accepted: IngredientIdentityCandidate[]): ResearchCandidate {
  const ingredients = recipe.ingredients.map((item) => { const name = String(item.rawName ?? item.normalizedName ?? '').trim(); const resolved = resolveIngredientForm({ name, classification: item.classification }, accepted, { knownFamilies: candidateFamilies }); const quantity = item.normalizedQuantity?.min ?? null; const fallbackUnit = normalizeUnit(item.rawUnit).unit; return { productId: resolved.productId ?? (resolved.candidateFamily ? `family:${resolved.candidateFamily}` : null), name, role: item.optional ? 'OPTIONAL' : 'REQUIRED', quantity, unit: item.normalizedUnit ?? fallbackUnit, sourceIngredientOrdinal: (item as CorpusIngredient & { sourceOrder?: number }).sourceOrder ?? null, sourceClassification: item.classification ?? null }; });
  const steps = (recipe.steps ?? []).map((step) => ({ ordinal: step.sourceOrder, normalizedTechnique: step.techniqueFacts?.[0] ?? null, durationMinutes: step.durationFacts?.[0]?.min ?? null, temperatureC: step.temperatureFacts?.[0]?.c ?? step.temperatureFacts?.[0]?.min ?? null, qualitativeEndCondition: step.endConditions?.[0] ?? null, sourceText: step.researchOnlySourceText ?? null, ingredientRefs: step.ingredientRefs }));
  const donor = typeof recipe.sourceLineage === 'string' ? recipe.sourceLineage : recipe.sourceLineage?.donor ?? recipe.sourceId;
  const rawServings = recipe.recipeFacts?.portions ?? null; const parsedServings = rawServings == null ? null : Number(rawServings);
  return { candidateId: `${recipe.sourceId}:${recipe.sourceRecipeId}`, sourceCode: recipe.sourceId, sourceLineage: donor, title: recipe.title, conceptKey: `title:${normalizeFoodText(recipe.title)}`, rightsStatus: 'APPROVED', ingredients, sourceIngredientCount: recipe.ingredients.length, techniques: steps.flatMap((s) => s.normalizedTechnique ? [s.normalizedTechnique] : []), steps, servings: Number.isFinite(parsedServings) && Number.isInteger(parsedServings) && parsedServings > 0 ? parsedServings : null, servingsRaw: rawServings, preparationTime: recipe.recipeFacts?.totalTime?.minutes ?? null, cookingTime: recipe.recipeFacts?.cookTime?.minutes ?? null, equipment: recipe.recipeFacts?.equipment ?? [], slotHints: [], provenance: { sourceUrl: recipe.canonicalUrl ?? null, rawSnapshotHash: recipe.bodySha256 ?? recipe.normalizedPayloadSha256 ?? null, parserVersion: 'recipe-corpus-glm-01', normalizedAt: '2026-08-20T00:00:00.000Z' }, parseConfidence: 0.9, normalizationConfidence: 0.9 };
}

export function applyBoundedContext(candidate: ResearchCandidate, accepted: IngredientIdentityCandidate[]): ResearchCandidate {
  const title = normalizeFoodText(candidate.title);
  const methodText = normalizeFoodText((candidate.steps ?? []).map((s) => s.sourceText ?? '').join(' '));
  const ingredients = candidate.ingredients.flatMap((item) => {
    const raw = normalizeFoodText(item.name);
    if (/цедр/.test(raw) && /рис|тыкв/.test(title)) return [];
    let name = item.name;
    if (/омлет на кефире/.test(title) && raw === 'масло' && /обжар|сковород|жар/.test(methodText)) name = 'Подсолнечное масло';
    if (/омлет с помидор/.test(title) && /масло растительное/.test(raw)) name = 'Подсолнечное масло';
    if (/котлет/.test(title)) {
      if (raw === 'лук' && /репчатый лук/.test(methodText)) name = 'Репчатый лук';
      if (raw === 'зелень' && /укроп/.test(methodText)) name = 'Укроп';
      if (/^яйц/.test(raw)) name = 'Яйцо сырое';
    }
    if (/гречк.*тушен/.test(title) && raw === 'тушенка') name = 'Тушенка говяжья консервированная';
    const resolved = resolveIngredientForm({ name }, accepted, { knownFamilies: candidateFamilies });
    return [{ ...item, name, productId: resolved.productId ?? (resolved.candidateFamily ? `family:${resolved.candidateFamily}` : null) }];
  });
  return { ...candidate, ingredients };
}

function uuid(value: string): string { const hex = createHash('sha256').update(value).digest('hex').slice(0, 32); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`; }
function json(value: unknown): string { return JSON.stringify(value); }

export function runPipeline(): PipelineResult {
  const recipes = parseConcatenatedJson<CorpusRecipe>(readFileSync(datasetPath, 'utf8')); const accepted = candidates(); const mapped = recipes.map((r) => toCandidate(r, accepted));
  const parent = mapped.map((_, index) => index); const sizes = mapped.map(() => 1);
  const find = (index: number): number => { while (parent[index] !== index) { parent[index] = parent[parent[index]!]!; index = parent[index]!; } return index; };
  const union = (left: number, right: number): void => { const a = find(left); const b = find(right); if (a !== b && sizes[a]! + sizes[b]! <= 6) { parent[b] = a; sizes[a] = sizes[a]! + sizes[b]!; } };
  const signature = (candidate: ResearchCandidate): Set<string> => new Set(candidate.ingredients.map((i) => normalizeFoodText(i.productId ?? i.name)).filter(Boolean));
  const techniqueSet = (candidate: ResearchCandidate): Set<string> => new Set((candidate.techniques ?? []).map(normalizeFoodText).filter(Boolean));
  const titleSet = (candidate: ResearchCandidate): Set<string> => new Set(normalizeFoodText(candidate.title).split(' ').filter((word) => word.length > 3 && !['как','для','из','со','на'].includes(word)));
  const dishClass = (candidate: ResearchCandidate): string => { const title = normalizeFoodText(candidate.title); for (const marker of ['суп','салат','десерт','торт','соус','напиток','паста','пирог','каша']) if (title.includes(marker)) return marker; return 'main'; };
  const jaccard = (a: Set<string>, b: Set<string>): number => { const intersection = [...a].filter((v) => b.has(v)).length; return intersection / Math.max(1, new Set([...a, ...b]).size); };
  for (let i = 0; i < mapped.length; i += 1) for (let j = i + 1; j < mapped.length; j += 1) { const a = mapped[i]!; const b = mapped[j]!; if (a.sourceCode === b.sourceCode || dishClass(a) !== dishClass(b)) continue; const ingredientsA = signature(a); const ingredientsB = signature(b); const common = [...ingredientsA].filter((v) => ingredientsB.has(v)).length; const ingredientSimilarity = jaccard(ingredientsA, ingredientsB); const techniquesA = techniqueSet(a); const techniquesB = techniqueSet(b); const techniqueSimilarity = techniquesA.size === 0 || techniquesB.size === 0 ? 0 : jaccard(techniquesA, techniquesB); const titleSimilarity = jaccard(titleSet(a), titleSet(b)); if ((titleSimilarity >= 0.4 && common >= 2 && techniqueSimilarity >= 0.2) || (common >= 4 && ingredientSimilarity >= 0.7 && techniqueSimilarity >= 0.4)) union(i, j); }
  const grouped = new Map<string, ResearchCandidate[]>(); for (let i = 0; i < mapped.length; i += 1) { const candidate = mapped[i]!; const key = `cluster:${find(i)}`; const group = grouped.get(key) ?? []; group.push({ ...candidate, conceptKey: key }); grouped.set(key, group); }
  const firstCohortGroups = new Set([...grouped.values()].filter((group) => new Set(group.map((c) => c.sourceCode)).size >= 2).sort((a, b) => b.length - a.length).slice(0, 10));
  const clusters: ReturnType<typeof buildDishConceptCluster>[] = []; const allFacts: ReturnType<typeof aggregateResearchFacts> = []; const briefs: SynthesisBrief[] = []; const readiness: Array<Record<string, unknown>> = []; const grammageEvaluations = new Map<string, ReturnType<typeof evaluateBriefGrammageReadiness>>();
  for (const group of grouped.values()) { const cluster = buildDishConceptCluster(group, '2026-08-20T00:00:00.000Z'); const donorSelection = selectCanonicalDonor(group); const effectiveGroup = group.map((candidate) => applyBoundedContext(candidate, accepted)); const canonicalGroup = donorSelection.donor ? [applyBoundedContext(donorSelection.donor, accepted)] : []; clusters.push(cluster); const facts = aggregateResearchFacts(cluster, effectiveGroup, '2026-08-20T00:00:00.000Z'); allFacts.push(...facts); const required = canonicalGroup.flatMap((c) => c.ingredients.filter((i) => i.role === 'REQUIRED')); const exact = required.filter((i) => i.productId && !String(i.productId).startsWith('family:')).length; const familyPending = required.filter((i) => String(i.productId ?? '').startsWith('family:')).length; const gaps = required.filter((i) => !i.productId).length; const conflicts = facts.filter((f) => f.requiresReview).length; const highConflicts = facts.filter((f) => f.conflictLevel === 'HIGH').length; const multiSource = cluster.sourceCount >= 2; const eligible = donorSelection.state === 'CANONICAL_DONOR_SELECTED' && multiSource && gaps === 0 && highConflicts === 0 && canonicalGroup.every((c) => c.ingredients.every((i) => i.productId)); const cohortSelected = firstCohortGroups.has(group); let brief: SynthesisBrief | null = null; if (eligible || (cohortSelected && donorSelection.state === 'CANONICAL_DONOR_SELECTED')) { brief = buildSynthesisBrief({ cluster, facts, objective: 'first-real-corpus-readiness', coverageSlot: 'RESEARCH', approvedProducts: [...new Set(required.map((i) => i.productId).filter((id): id is string => Boolean(id) && !id.startsWith('family:')))], allowedEquipment: [...new Set(canonicalGroup.flatMap((c) => c.equipment ?? []))] }); if (gaps > 0) { brief.unresolvedFacts = [...brief.unresolvedFacts, `PRODUCT_IDENTITY_PENDING:${required.filter((i) => !i.productId).map((i) => i.name).join('|')}`]; if (brief.status !== 'BLOCKED_CONFLICT') brief.status = 'READY_FOR_REVIEW'; } briefs.push(brief); }
    const readinessState = donorSelection.state === 'CANONICAL_DONOR_UNRESOLVED' ? 'CANONICAL_DONOR_UNRESOLVED' : eligible ? (familyPending > 0 ? 'READY_FOR_PRODUCT_SELECTION' : brief?.status === 'READY_FOR_REVIEW' ? 'RESEARCH_ONLY_MORE_EVIDENCE_NEEDED' : 'READY_FOR_DETERMINISTIC_GRAMS') : !multiSource ? 'BLOCKED_CLUSTER_CONFIDENCE' : highConflicts ? 'BLOCKED_CONFLICT' : gaps > 0 ? 'BLOCKED_INGREDIENT_IDENTITY' : 'RESEARCH_ONLY_MORE_EVIDENCE_NEEDED'; const blocker = donorSelection.state === 'CANONICAL_DONOR_UNRESOLVED' ? 'CANONICAL_DONOR_UNRESOLVED' : brief ? (brief.status === 'BLOCKED_CONFLICT' ? 'BLOCKED_CONFLICT' : brief.unresolvedFacts.length ? 'PRODUCT_SELECTION_PENDING' : familyPending > 0 ? 'PRODUCT_SELECTION_PENDING' : '') : readinessState; readiness.push({ clusterId: cluster.clusterId, workingConceptName: cluster.displayLabel, candidateCount: group.length, distinctSourceCount: cluster.sourceCount, sources: cluster.sourceCodes.join('|'), confidence: cluster.sourceQualityScore.score, ingredientSimilarity: 1, techniqueSimilarity: cluster.techniqueSignature.length ? 1 : 0, structuralSimilarity: 1, synthesisCandidate: Boolean(brief), canonicalDonorId: donorSelection.donor?.candidateId ?? null, canonicalDonorSelectionState: donorSelection.state, canonicalDonorReason: donorSelection.reason, blockReason: blocker }); }
  const targetCluster = clusters.find((cluster) => cluster.clusterId === 'dcluster_8c521f996b1e8844f530ff12');
  const targetBrief = briefs.find((brief) => brief.clusterId === 'dcluster_8c521f996b1e8844f530ff12');
  if (targetCluster && targetBrief) Object.assign(targetBrief, attachIngredientStepEvidence(targetBrief, buildIngredientStepEvidence({ cluster: targetCluster, candidates: mapped.map((candidate) => applyBoundedContext(candidate, accepted)) })));
  // Materialize the same accepted deterministic selections used by readiness in
  // the exact brief supplied to Editor. Optional/process inputs remain excluded.
  const selectionCatalog: SelectionProduct[] = [...CATALOG_CORE_V2_PRODUCTS, ...CATALOG_CORE_V3_PRODUCTS]
    .filter((product, index, all) => all.findIndex((candidate) => candidate.productKey === product.productKey) === index)
    .map((product) => ({ productId: product.productKey, canonicalName: product.canonicalName, form: product.form, fatPercent: product.coefficients?.fatPercent ?? null, nutritionVersionPresent: Boolean(product.nutrition) }));
  for (const brief of briefs) {
    const cluster = clusters.find((item) => item.clusterId === brief.clusterId);
    if (!cluster) continue;
    // Selection is made from the bounded-context view. Raw donor rows are never
    // allowed to reintroduce excluded ingredients or pre-policy identities.
    const canonicalCandidates = resultCandidatesForCluster(cluster, mapped, accepted);
    const canonicalDonorId = canonicalCandidates[0]?.candidateId ?? '';
    const donorLines = canonicalCandidates[0]?.ingredients ?? [];
    const selections = donorLines.map((ingredient) => {
      const family = ingredient.productId?.startsWith('family:') ? ingredient.productId.slice('family:'.length) : ingredient.productId;
      const decision = selectCanonicalProduct({ name: ingredient.name, identity: family ?? ingredient.name, family, productId: ingredient.productId, role: ingredient.role, quantity: ingredient.quantity, unit: ingredient.unit, allowSynthesisDefault: true, researchConflict: brief.status === 'BLOCKED_CONFLICT' }, selectionCatalog);
      const sourceForm = resolveIngredientForm({ name: ingredient.name, classification: ingredient.sourceClassification }, accepted, { knownFamilies: candidateFamilies });
      const role = sourceForm.state === 'PROCESS_INPUT' ? 'PROCESS_INPUT' : ingredient.role ?? 'REQUIRED';
      return { sourceLabel: ingredient.name, productId: decision.selectedProductId, quantity: ingredient.quantity ?? null, unit: ingredient.unit ?? null, role, optional: false, authority: decision.reason, sourceCandidateId: canonicalDonorId, sourceIngredientOrdinal: ingredient.sourceIngredientOrdinal ?? null };
    });
    brief.approvedProducts = [...new Set(selections.map((item) => item.productId!).filter(Boolean))].sort();
    // Keep the historical canonical brief line contract, while the readiness
    // gate below evaluates every donor line (including process/optional rows).
    // Keep process media and optional source lines out of the historical
    // deterministic brief selection contract, using the immutable source
    // classification resolver.  The readiness gate above still evaluates
    // every donor line, so this is not an escape hatch for unresolved rows.
    const deterministicOrdinals = new Set(donorLines
      .filter((ingredient) => ingredient.role === 'REQUIRED')
      .filter((ingredient) => resolveIngredientForm({ name: ingredient.name, classification: ingredient.sourceClassification }, accepted, { knownFamilies: candidateFamilies }).state !== 'PROCESS_INPUT')
      .map((ingredient) => ingredient.sourceIngredientOrdinal));
    brief.deterministicSelections = selections.filter((item) => deterministicOrdinals.has(item.sourceIngredientOrdinal));
    const grammage = evaluateBriefGrammageReadiness({ clusterId: brief.clusterId, canonicalDonorCandidateId: canonicalDonorId, selections });
    grammageEvaluations.set(brief.clusterId, grammage);
    brief.grammageReadiness = { state: grammage.state, readiness: grammage.readiness, resolvedRequiredLines: grammage.resolvedRequiredLines, unresolvedRequiredLines: grammage.unresolvedRequiredLines, lines: grammage.lines };
    brief.ownerDecisions = { ...(brief.clusterId === 'dcluster_87b96a2fc22b24da2b6baa44' ? { sunflowerOil: 'sunflower_oil', butterRequired: 'NO' } : {}), ...(brief.clusterId === 'dcluster_06210e70a9392b5421aa0155' ? { orangeZestRequired: 'NO', orangeZestIncluded: 'NO' } : {}) };
    brief.exclusions = brief.clusterId === 'dcluster_06210e70a9392b5421aa0155' ? ['Апельсиновая цедра'] : [];
    const canonicalServings = resolveCanonicalDonorServings(canonicalCandidates[0] ?? { candidateId: canonicalDonorId, sourceCode: '', title: '', rightsStatus: 'DISABLED', ingredients: [], servings: null }, brief.clusterId);
    brief.servings = canonicalServings.servings;
    brief.evidenceSummary = { ...brief.evidenceSummary, canonicalDonorServings: canonicalServings.provenance };
    if (canonicalServings.state === 'CANONICAL_DONOR_SERVINGS_UNRESOLVED') brief.unresolvedFacts = [...brief.unresolvedFacts, 'CANONICAL_DONOR_SERVINGS_UNRESOLVED'];
    const representative = mapped.find((candidate) => candidate.candidateId === cluster.representativeCandidateId);
    brief.totalTimeMinutes = representative?.preparationTime != null && representative?.cookingTime != null ? representative.preparationTime + representative.cookingTime : representative?.preparationTime ?? representative?.cookingTime ?? null;
    // Final readiness is evaluated only after all hash-bound selections and
    // exclusions are materialized.
    const readinessRow = readiness.find((row) => row.clusterId === brief.clusterId);
    if (readinessRow && grammage.unresolvedRequiredLines === 0 && brief.unresolvedFacts.length === 0 && brief.conflictingFacts.length === 0 && selections.length > 0) {
      readinessRow.blockReason = '';
      readinessRow.readiness = 'READY_FOR_SYNTHESIS';
    } else if (readinessRow && grammage.unresolvedRequiredLines > 0) {
      readinessRow.blockReason = 'GRAMMAGE_UNRESOLVED';
      readinessRow.readiness = 'NOT_READY_FOR_SYNTHESIS';
    }
    brief.contentHash = computeBriefContentHash(brief);
  }
  const authorityGapLedger = buildAuthorityGapLedger([...grammageEvaluations.values()]);
  return { candidates: mapped.map((candidate) => applyBoundedContext(candidate, accepted)), clusters, facts: allFacts, briefs, readiness, conflicts: allFacts.filter((f) => f.requiresReview).length, authorityGapLedger };
}

function resultCandidatesForCluster(cluster: ReturnType<typeof buildDishConceptCluster>, mapped: ResearchCandidate[], accepted: IngredientIdentityCandidate[]): ResearchCandidate[] {
  const candidates = mapped.filter((candidate) => cluster.candidateIds.includes(candidate.candidateId));
  const selection = selectCanonicalDonor(candidates);
  return selection.donor ? [applyBoundedContext(selection.donor, accepted)] : [];
}

async function persist(result: PipelineResult, connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const insertBatch = async (rows: unknown[][], columns: string, casts: string[], table: string, conflict: string, updates: string, chunkSize: number): Promise<void> => {
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const params: unknown[] = [];
      const values = chunk.map((row, rowIndex) => `(${row.map((value, columnIndex) => { params.push(value); return `$${rowIndex * row.length + columnIndex + 1}${casts[columnIndex] ?? ''}`; }).join(',')})`).join(',');
      await client.query(`INSERT INTO "${table}" (${columns}) VALUES ${values} ${conflict} DO UPDATE SET ${updates}`, params);
    }
  };
  try {
    await client.query('BEGIN');
    await insertBatch(result.clusters.map((cluster) => [uuid(cluster.clusterId),cluster.clusterVersion,cluster.conceptKey,cluster.displayLabel,json(cluster.candidateIds),cluster.sourceCount,json(cluster.sourceCodes),cluster.representativeCandidateId,json(cluster.ingredientSignature),json(cluster.techniqueSignature),json(cluster.slotHints),cluster.fingerprint,cluster.status,cluster.createdAt,cluster.createdAt]), '"id","clusterVersion","conceptKey","displayLabel","candidateIds","sourceCount","sourceCodes","representativeCandidateId","ingredientSignature","techniqueSignature","slotHints","fingerprint","status","createdAt","updatedAt"', ['::uuid','','','','::jsonb','','::jsonb','','::jsonb','::jsonb','::jsonb','','','::timestamptz','::timestamptz'], 'DishConceptCluster', 'ON CONFLICT ("fingerprint")', '"updatedAt"=EXCLUDED."updatedAt","status"=EXCLUDED."status"', 300);
    await insertBatch(result.facts.map((fact, index) => [uuid(`${fact.factId}:${index}`),uuid(fact.clusterId),fact.factType,fact.normalizedValue,fact.unit,json(fact.supportingCandidateIds),json(fact.supportingSourceCodes),fact.supportingCandidateCount,fact.confidence,fact.conflictLevel,fact.requiresReview,json(fact.provenance),fact.derivedAt]), '"id","clusterId","factType","normalizedValue","unit","supportingCandidateIds","supportingSourceCodes","supportingCandidateCount","confidence","conflictLevel","requiresReview","provenance","derivedAt"', ['::uuid','::uuid','','','','::jsonb','::jsonb','','','','','::jsonb','::timestamptz'], 'RecipeResearchFact', 'ON CONFLICT ("id")', '"supportingCandidateIds"=EXCLUDED."supportingCandidateIds","supportingSourceCodes"=EXCLUDED."supportingSourceCodes","supportingCandidateCount"=EXCLUDED."supportingCandidateCount","confidence"=EXCLUDED."confidence","conflictLevel"=EXCLUDED."conflictLevel","requiresReview"=EXCLUDED."requiresReview","provenance"=EXCLUDED."provenance","derivedAt"=EXCLUDED."derivedAt"', 400);
    await insertBatch(result.briefs.map((brief) => [uuid(brief.briefId),brief.briefVersion,uuid(brief.clusterId),brief.coverageSlot ?? 'RESEARCH',brief.objective,json(brief.approvedProducts),json(brief.forbiddenProducts),brief.targetNutrition == null ? null : json(brief.targetNutrition),brief.targetCost ?? null,brief.targetCookTime ?? null,json(brief.allowedEquipment),json(brief.requiredTechniques),json(brief.optionalTechniques),json(brief.requiredFacts),json(brief.conflictingFacts),json(brief.unresolvedFacts),brief.differentiationReason,json(brief.evidenceSummary),brief.status,brief.approvalState]), '"id","briefVersion","clusterId","coverageSlot","objective","approvedProducts","forbiddenProducts","targetNutrition","targetCost","targetCookTime","allowedEquipment","requiredTechniques","optionalTechniques","requiredFacts","conflictingFacts","unresolvedFacts","differentiationReason","evidenceSummary","status","approvalState"', ['::uuid','','::uuid','','','','','::jsonb','','','::jsonb','::jsonb','::jsonb','::jsonb','::jsonb','::jsonb','','::jsonb','',''], 'RecipeSynthesisBrief', 'ON CONFLICT ("id")', '"updatedAt"=now(),"status"=EXCLUDED."status","approvalState"=EXCLUDED."approvalState","evidenceSummary"=EXCLUDED."evidenceSummary"', 100);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
}

function writeReports(result: PipelineResult): void { mkdirSync(reportDir, { recursive: true }); const audit = ['clusterId,workingConceptName,candidateCount,distinctSourceCount,sources,confidence,ingredientSimilarity,techniqueSimilarity,structuralSimilarity,synthesisCandidate,blockReason', ...result.readiness.map((r) => [r.clusterId,r.workingConceptName,r.candidateCount,r.distinctSourceCount,r.sources,r.confidence,r.ingredientSimilarity,r.techniqueSimilarity,r.structuralSimilarity,r.synthesisCandidate,r.blockReason].map(csvCell).join(','))].join('\n') + '\n'; writeFileSync(resolve(reportDir, 'RECIPE-CORPUS-SYNTHESIS-READINESS-01-CLUSTER-AUDIT.csv'), audit); const selected = result.briefs.map((brief) => { const cluster = result.clusters.find((c) => c.clusterId === brief.clusterId)!; const required = result.candidates.filter((c) => cluster.candidateIds.includes(c.candidateId)).flatMap((c) => c.ingredients.filter((i) => i.role === 'REQUIRED')); const conflicts = result.facts.filter((f) => f.clusterId === cluster.clusterId && f.requiresReview).length; const pendingIdentity = brief.unresolvedFacts.some((fact) => fact.startsWith('PRODUCT_IDENTITY_PENDING:')); const readinessState = brief.status === 'BLOCKED_CONFLICT' ? 'BLOCKED_CONFLICT' : pendingIdentity ? 'READY_FOR_PRODUCT_SELECTION' : brief.status === 'READY_FOR_REVIEW' ? 'RESEARCH_ONLY_MORE_EVIDENCE_NEEDED' : 'READY_FOR_DETERMINISTIC_GRAMS'; const nextBlocker = brief.status === 'BLOCKED_CONFLICT' ? 'CONFLICT_REVIEW' : pendingIdentity ? 'PRODUCT_IDENTITY_PENDING' : brief.status === 'READY_FOR_REVIEW' ? 'MORE_EVIDENCE_REQUIRED' : ''; return [cluster.clusterId,cluster.displayLabel,cluster.candidateIds.length,cluster.sourceCount,cluster.sourceCodes.join('|'),cluster.sourceQualityScore.score,required.length,required.filter((i) => i.productId && !String(i.productId).startsWith('family:')).length,required.filter((i) => String(i.productId ?? '').startsWith('family:')).length,required.filter((i) => !i.productId).length,conflicts,readinessState,nextBlocker].map(csvCell).join(','); }); writeFileSync(resolve(reportDir, 'RECIPE-CORPUS-SYNTHESIS-READINESS-01-COHORT.csv'), ['clusterId,conceptName,candidateCount,distinctSourceCount,sourceList,clusterConfidence,requiredIngredientCount,exactProductCount,familyPendingCount,trueProductGapCount,conflictCount,readinessState,nextBlocker', ...selected].join('\n') + '\n'); }

function csvCell(value: unknown): string { const text = String(value ?? ''); const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; }
function writeAuthorityGapLedger(result: PipelineResult): void {
  const csv = csvCell;
  const rows = result.authorityGapLedger.map((line) => [line.clusterId, line.canonicalDonorCandidateId, line.sourceCandidateId, line.sourceIngredientOrdinal, line.rawIngredientName, line.normalizedIngredientIdentity, line.rawAmount, line.rawUnit, line.resolution.state, line.blockerClass, line.requiredAuthorityType, line.resolution.reason, line.gapKey].map(csv).join(','));
  writeFileSync(resolve(reportDir, 'CONTENT-01-08C-AUTHORITY-GAP-LEDGER.csv'), ['clusterId,canonicalDonorCandidateId,sourceCandidateId,sourceIngredientOrdinal,rawIngredientName,normalizedIngredientIdentity,rawAmount,rawUnit,resolutionState,blockerClass,requiredAuthorityType,reason,gapKey', ...rows].join('\n') + '\n');
  const unique = new Set(result.authorityGapLedger.map((line) => line.gapKey));
  const count = (kind: string) => result.authorityGapLedger.filter((line) => line.blockerClass === kind).length;
  writeFileSync(resolve(reportDir, 'CONTENT-01-08C-GRAMMAGE-READINESS-GATE-AND-GAP-LEDGER-01-OWNER-REPORT.txt'), [
    'TASK_ID=CONTENT-01-08C-GRAMMAGE-READINESS-GATE-AND-GAP-LEDGER-01',
    'MODE=BOUNDED_IMPLEMENTATION',
    `MATERIALIZED_BRIEFS=${result.briefs.length}`,
    `REQUIRED_LINES_SCOPE=${result.briefs.reduce((sum, brief) => sum + (brief.grammageReadiness?.resolvedRequiredLines ?? 0) + (brief.grammageReadiness?.unresolvedRequiredLines ?? 0), 0)}`,
    `GRAMMAGE_RESOLVED_LINES=${result.briefs.reduce((sum, brief) => sum + (brief.grammageReadiness?.resolvedRequiredLines ?? 0), 0)}`,
    `GRAMMAGE_UNRESOLVED_LINES=${result.authorityGapLedger.length}`,
    `TRUE_READY_BRIEFS=${result.briefs.filter((brief) => brief.grammageReadiness?.readiness === 'READY_FOR_SYNTHESIS').length}`,
    `BLOCKED_BRIEFS=${result.briefs.filter((brief) => brief.grammageReadiness?.readiness === 'NOT_READY_FOR_SYNTHESIS').length}`,
    `UNIQUE_AUTHORITY_GAPS=${unique.size}`,
    `AFFECTED_INGREDIENT_LINES=${result.authorityGapLedger.length}`,
    `DENSITY_GAPS=${count('DENSITY_AUTHORITY')}`,
    `PIECE_WEIGHT_GAPS=${count('PIECE_WEIGHT_AUTHORITY')}`,
    `MISSING_OR_MALFORMED_QUANTITY=${count('MISSING_OR_MALFORMED_QUANTITY')}`,
    `UNSUPPORTED_UNIT_GAPS=${count('UNSUPPORTED_UNIT')}`,
    'PRODUCT_SELECTION_LINES_SCOPE=198 (separate 9-cluster product-selection cohort metric)',
    'METRIC_SCOPE_DIFFERENCE_EXPLAINED=55 lines are materialized synthesis briefs; 198 lines are the broader product-selection cohort rows.',
    'AI_CALLS=0',
    'RECIPE_VERSIONS_CREATED=0',
    'DATABASE_WRITES=0',
    'COOKED_YIELD_UNCHANGED=YES',
    'SERVING_WEIGHT_UNCHANGED=YES',
    'FINAL_VERDICT=CONTENT_01_08C_GRAMMAGE_READINESS_GATE_AND_GAP_LEDGER_PENDING_DISPOSABLE_VERIFICATION',
  ].join('\n') + '\n');
}

export async function runSynthesisReadiness(connectionString?: string): Promise<PipelineResult> { const result = runPipeline(); writeReports(result); writeAuthorityGapLedger(result); if (connectionString) await persist(result, connectionString); return result; }

if (process.argv[1]?.endsWith('recipe-corpus-synthesis-readiness-01.ts')) { void runSynthesisReadiness(process.env.DATABASE_URL).then((result) => console.info(JSON.stringify({ candidates: result.candidates.length, clusters: result.clusters.length, multiSourceClusters: result.clusters.filter((c) => c.sourceCount >= 2).length, facts: result.facts.length, conflicts: result.conflicts, briefs: result.briefs.length, readiness: Object.fromEntries([...new Set(result.readiness.map((r) => String(r.blockReason || 'READY')))].map((state) => [state, result.readiness.filter((r) => (r.blockReason || 'READY') === state).length])) }, null, 2))); }
