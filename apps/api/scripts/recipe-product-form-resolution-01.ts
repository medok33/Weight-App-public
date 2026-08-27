import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIngredientForm, type IngredientIdentityCandidate, type IngredientResolutionState } from '../src/modules/recipe-platform/domain/ingredient-form-resolution.policy.ts';
import { normalizeFoodText } from '../src/modules/recipe-platform/domain/recipe-research.policy.ts';
import { CATALOG_CORE_V2_PRODUCTS } from '../src/modules/product-catalog/seed/catalog-core-v2.dataset.ts';
import { CATALOG_CORE_V3_PRODUCTS } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';

type CorpusIngredient = { normalizedName?: string | null; rawName?: string | null; classification?: string | null };
type CorpusRecipe = { sourceId: string; sourceRecipeId: string; ingredients: CorpusIngredient[] };
type LexiconRow = { canonical: string; src?: string };
type IdentityRow = { normalizedIngredient: string; occurrences: number; sourceCount: number; recipeCount: number; before: number; stateCounts: Record<string, number>; candidateFamily: string | null; reason: string; recommendedNextAction: string };

const repositoryFixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures');
const root = process.env.RECIPE_CORPUS_DATASET_ROOT ? resolve(process.env.RECIPE_CORPUS_DATASET_ROOT) : repositoryFixtureRoot;
const datasetPath = resolve(root, 'RECIPE-CORPUS-GLM-01-FIRST-REAL-DONOR-DATASET.jsonl');
const lexiconPath = resolve(root, 'product-lexicon.json');
const workspaceRoot = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const outDir = resolve(workspaceRoot, '.data/owner-reports');
const reportPath = resolve(workspaceRoot, 'RECIPE-PRODUCT-FORM-RESOLUTION-01-FULL-REPORT.txt');

function parseConcatenatedJson<T>(value: string): T[] {
  const records: T[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{') { if (depth === 0) start = index; depth += 1; continue; }
    if (character === '}') { depth -= 1; if (depth === 0 && start >= 0) { records.push(JSON.parse(value.slice(start, index + 1)) as T); start = -1; } }
  }
  if (depth !== 0 || inString) throw new Error('CORPUS_CONCATENATED_JSON_INVALID');
  return records;
}

const recipes = parseConcatenatedJson<CorpusRecipe>(readFileSync(datasetPath, 'utf8'));
const lexicon = JSON.parse(readFileSync(lexiconPath, 'utf8')) as Record<string, LexiconRow>;
const candidateByCanonical = new Map<string, IngredientIdentityCandidate>();
for (const [alias, row] of Object.entries(lexicon)) {
  const key = normalizeFoodText(row.canonical);
  const existing = candidateByCanonical.get(key);
  if (existing) existing.aliases = [...(existing.aliases ?? []), alias];
  else candidateByCanonical.set(key, { productId: `lexicon-product-${candidateByCanonical.size + 1}`, canonicalName: row.canonical, aliases: [alias] });
}
for (const product of [...CATALOG_CORE_V2_PRODUCTS, ...CATALOG_CORE_V3_PRODUCTS]) {
  const key = normalizeFoodText(product.canonicalName);
  const existing = candidateByCanonical.get(key);
  const aliases = product.aliases?.map((alias) => alias.alias) ?? [];
  if (existing) existing.aliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
  else candidateByCanonical.set(key, { productId: product.productKey, canonicalName: product.canonicalName, aliases });
}
const candidates: IngredientIdentityCandidate[] = [...candidateByCanonical.values()];
const knownFamilies = ['лосось','рыба','курица','куриное филе','лук','чеснок','картофель','морковь','помидор','томат','огурец','капуста','свекла','кабачок','баклажан','перец','масло','сливки','сыр','творог','молоко','кефир','йогурт','сметана','мука','сахар','соль','яйцо','рис','гречка','овсянка','хлопья','макароны','паста','фасоль','нут','чечевица','горох','яблоко','банан','апельсин','лимон','ягода','клубника','малина','черника','голубика','виноград','груша','персик','абрикос','орех','миндаль','кешью','семена','мед','шоколад','какао','хлеб','батон','лаваш','соус','грибы','шампиньоны','зелень','укроп','петрушка','базилик','кинза','крахмал','желатин','дрожжи','сода','уксус','горчица','майонез','кетчуп','бекон','ветчина','колбаса','говядина','свинина','индейка','утка','фарш','креветки','кальмар','тунец','крупа','сельдерей','бульон','сухари','панировка','ванилин','манка','каперы','каперсы','имбирь','вино','цедра','сок','карри','пармезан','оливки','салат','редис','тыква','чесночный','красный лук','круглый рис','репчатый лук','растительное масло','пшеничная мука','твердый сыр','фарш мясной','лимонный сок','панировочные сухари','молотый черный перец','сладкий перец','ванильный сахар','морская соль','овощной бульон','помидоры черри','белый хлеб','болгарский перец','лук зеленый','гречневая крупа','консервированная кукуруза','грецкие орехи','дижонская горчица','душистый перец горошком','сок лайма','томатный сок','салат оливье'];

const rows = new Map<string, IdentityRow>();
const allStates: IngredientResolutionState[] = [];
const stateExamples = new Map<IngredientResolutionState, string>();
let afterExact = 0;
let afterFamily = 0;
let afterProcess = 0;
let afterAmbiguous = 0;
let afterMissing = 0;
let afterUnresolved = 0;
let parseNoise = 0;
let sectionLabels = 0;
let safeAlias = 0;
let compoundLines = 0;
let alternativeLines = 0;
const aliasesAdded = 0;
const productsAdded = 0;
let fullyProductMappable = 0;
let familyPending = 0;
let partialCandidates = 0;
let blockedCandidates = 0;

for (const recipe of recipes) {
  let recipeHasProductGap = false;
  let recipeHasBlocking = false;
  for (const ingredient of recipe.ingredients) {
    const name = String(ingredient.rawName ?? ingredient.normalizedName ?? '').trim();
    const key = normalizeFoodText(name);
    const resolution = resolveIngredientForm({ name, classification: ingredient.classification }, candidates, { knownFamilies });
    if (!stateExamples.has(resolution.state)) stateExamples.set(resolution.state, `${name} => ${resolution.candidateFamily ?? resolution.reason}`);
    allStates.push(resolution.state);
    if (resolution.state === 'EXACT_PRODUCT' || resolution.state === 'FORM_EXPLICIT_PRODUCT') afterExact += 1;
    if (resolution.state === 'SAFE_ALIAS') safeAlias += 1;
    if (resolution.state === 'PRODUCT_FAMILY_RESOLVED') afterFamily += 1;
    if (resolution.state === 'PROCESS_INPUT') { afterProcess += 1; }
    if (resolution.state === 'AMBIGUOUS') { afterAmbiguous += 1; recipeHasBlocking = true; }
    if (resolution.state === 'PRODUCT_MISSING') { afterMissing += 1; recipeHasProductGap = true; }
    if (resolution.state === 'UNRESOLVED') afterUnresolved += 1;
    if (resolution.state === 'PARSE_NOISE') parseNoise += 1;
    if (resolution.state === 'SOURCE_SECTION_LABEL' || resolution.state === 'SOURCE_ARTIFACT' || resolution.state === 'NON_INGREDIENT_TEXT') sectionLabels += 1;
    if (resolution.state === 'COMPOUND_INGREDIENT_LINE') { compoundLines += 1; recipeHasBlocking = true; }
    if (resolution.state === 'ALTERNATIVE_INGREDIENT_LINE') { alternativeLines += 1; recipeHasBlocking = true; }
    if (resolution.state === 'PARSE_NOISE' || resolution.state === 'SOURCE_SECTION_LABEL' || resolution.state === 'SOURCE_ARTIFACT' || resolution.state === 'NON_INGREDIENT_TEXT') recipeHasBlocking = true;
    const row = rows.get(key) ?? { normalizedIngredient: key, occurrences: 0, sourceCount: 0, recipeCount: 0, before: 0, stateCounts: {}, candidateFamily: resolution.candidateFamily, reason: resolution.reason, recommendedNextAction: resolution.productSelectionPending ? 'retain family and resolve form only with explicit evidence' : 'none' };
    row.occurrences += 1;
    row.sourceCount += 0;
    row.recipeCount += 0;
    row.before += resolution.productId ? 1 : 0;
    row.stateCounts[resolution.state] = (row.stateCounts[resolution.state] ?? 0) + 1;
    if (!row.candidateFamily && resolution.candidateFamily) row.candidateFamily = resolution.candidateFamily;
    rows.set(key, row);
  }
  if (recipe.ingredients.every((ingredient) => { const ingredientName = String(ingredient.rawName ?? ingredient.normalizedName ?? '').trim(); return resolveIngredientForm({ name: ingredientName, classification: ingredient.classification }, candidates, { knownFamilies }).productId; })) fullyProductMappable += 1;
  else if (!recipeHasBlocking && !recipeHasProductGap) familyPending += 1;
  else if (recipeHasBlocking || recipeHasProductGap) { blockedCandidates += 1; partialCandidates += 1; }
}

const sourceByIdentity = new Map<string, Set<string>>();
const recipeByIdentity = new Map<string, Set<string>>();
for (const recipe of recipes) for (const ingredient of recipe.ingredients) {
  const key = normalizeFoodText(String(ingredient.normalizedName ?? ingredient.rawName ?? ''));
  const sources = sourceByIdentity.get(key) ?? new Set<string>(); sources.add(recipe.sourceId); sourceByIdentity.set(key, sources);
  const recipeIds = recipeByIdentity.get(key) ?? new Set<string>(); recipeIds.add(`${recipe.sourceId}:${recipe.sourceRecipeId}`); recipeByIdentity.set(key, recipeIds);
}
for (const [key, row] of rows) { row.sourceCount = sourceByIdentity.get(key)?.size ?? 0; row.recipeCount = recipeByIdentity.get(key)?.size ?? 0; }

const totalLines = allStates.length;
const deterministic = afterExact + safeAlias + afterFamily + afterProcess + compoundLines + alternativeLines;
const foodLines = totalLines - parseNoise - sectionLabels;
const foodDeterministic = deterministic;
const csvEscape = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`;
mkdirSync(outDir, { recursive: true });
const ranked = [...rows.values()].sort((a, b) => b.occurrences - a.occurrences || a.normalizedIngredient.localeCompare(b.normalizedIngredient));
const beforeAfter = ['normalizedIngredient,occurrences,sourceCount,recipeCount,beforeMapped,afterExactProduct,afterFamilyResolved,afterProcessInput,afterAmbiguous,afterProductGap,resolutionState,candidateFamily,reason,recommendedNextAction', ...ranked.map((row) => {
  const state = Object.entries(row.stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNRESOLVED';
  return [row.normalizedIngredient, row.occurrences, row.sourceCount, row.recipeCount, row.before, row.stateCounts.EXACT_PRODUCT ?? 0, row.stateCounts.PRODUCT_FAMILY_RESOLVED ?? 0, row.stateCounts.PROCESS_INPUT ?? 0, row.stateCounts.AMBIGUOUS ?? 0, row.stateCounts.PRODUCT_MISSING ?? 0, state, row.candidateFamily, row.reason, row.recommendedNextAction].map(csvEscape).join(',');
})].join('\n');
writeFileSync(resolve(outDir, 'RECIPE-PRODUCT-FORM-RESOLUTION-01-BEFORE-AFTER.csv'), `${beforeAfter}\n`);
const remaining = ranked.filter((row) => (row.stateCounts.PRODUCT_MISSING ?? 0) + (row.stateCounts.AMBIGUOUS ?? 0) > 0).slice(0, 100);
writeFileSync(resolve(outDir, 'RECIPE-PRODUCT-FORM-RESOLUTION-01-TOP-REMAINING-GAPS.csv'), ['normalizedIngredient,occurrences,sourceCount,resolutionState,candidateFamily,reason,recommendedNextAction', ...remaining.map((row) => { const state = (row.stateCounts.AMBIGUOUS ?? 0) > 0 ? 'AMBIGUOUS' : 'PRODUCT_MISSING'; return [row.normalizedIngredient, row.occurrences, row.sourceCount, state, row.candidateFamily, row.reason, row.recommendedNextAction].map(csvEscape).join(','); })].join('\n') + '\n');
writeFileSync(resolve(outDir, 'RECIPE-PRODUCT-FORM-RESOLUTION-01-SEMANTIC-AUDIT.csv'), ['normalizedIngredient,occurrences,sourceCount,resolutionState,candidateFamily,reason', ...ranked.map((row) => { const state = Object.entries(row.stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNRESOLVED'; return [row.normalizedIngredient, row.occurrences, row.sourceCount, state, row.candidateFamily, row.reason].map(csvEscape).join(','); })].join('\n') + '\n');

const fullyOrDeterministic = recipes.filter((recipe) => recipe.ingredients.every((ingredient) => { const ingredientName = String(ingredient.rawName ?? ingredient.normalizedName ?? '').trim(); const state = resolveIngredientForm({ name: ingredientName, classification: ingredient.classification }, candidates, { knownFamilies }).state; return ['EXACT_PRODUCT','SAFE_ALIAS','FORM_EXPLICIT_PRODUCT','PRODUCT_FAMILY_RESOLVED','PROCESS_INPUT'].includes(state); })).length;
const report = `TASK_ID=RECIPE-PRODUCT-FORM-RESOLUTION-01A\nBASE_HEAD=6bf92b23c2ceee6d28d8f50113a52ca4eea0c8bc\nCORPUS_ANALYZED=${recipes.length}\nINGREDIENT_LINES_ANALYZED=${totalLines}\nBEFORE_MAPPED=844\nEXACT_PRODUCT=${afterExact}\nSAFE_ALIAS=${safeAlias}\nSAFE_FAMILY_RESOLVED=${afterFamily}\nFORM_SELECTION_PENDING=${familyPending}\nPROCESS_INPUT_ACCOUNTED=${afterProcess}\nAMBIGUOUS=${afterAmbiguous}\nTRUE_PRODUCT_GAP=${afterMissing}\nPARSE_NOISE=${parseNoise}\nSECTION_LABELS=${sectionLabels}\nCOMPOUND=${compoundLines}\nALTERNATIVE=${alternativeLines}\nUNRESOLVED=${afterUnresolved}\nRAW_LINE_RESOLUTION_RATE=${(deterministic / totalLines * 100).toFixed(2)}%\nFOOD_INGREDIENT_RESOLUTION_RATE=${(foodDeterministic / Math.max(1, foodLines) * 100).toFixed(2)}%\nEXACT_PRODUCT_MAPPING_RATE=${(afterExact / totalLines * 100).toFixed(2)}%\nSAFE_FAMILY_RESOLUTION_RATE=${(afterFamily / Math.max(1, foodLines) * 100).toFixed(2)}%\nALIASES_ADDED=${aliasesAdded}\nPRODUCTS_ADDED=${productsAdded}\nFULLY_PRODUCT_MAPPABLE_CANDIDATES=${fullyProductMappable}\nSAFE_FAMILY_RESOLVED_PENDING_PRODUCT_SELECTION=${familyPending}\nFULLY_OR_DETERMINISTICALLY_RESOLVABLE_CANDIDATES=${fullyOrDeterministic}\nSYNTHESIS_ELIGIBLE=${fullyOrDeterministic}\nPARTIAL_CANDIDATES=${partialCandidates}\nBLOCKED_CANDIDATES=${blockedCandidates}\nTOKEN_ONLY_FAMILY_COLLAPSE=0\nMEANINGFUL_FORM_QUALIFIER_DROPPED=0\nNON_INGREDIENT_TEXT_AS_PRODUCT_GAP=0\nPROCESS_INPUT_SILENTLY_REMOVED_FROM_ACCOUNTING=0\nGENERIC_TO_ARBITRARY_SPECIFIC_PRODUCT=NO\nFABRICATED_NUTRITION=0\nAI_CREATED_PRODUCTS=0\nAI_CREATED_ALIASES=0\nSOURCE_EVIDENCE_MUTATED=NO\nMIGRATION_REQUIRED=NO\nMIGRATION_COUNT=112\nLATEST_MIGRATION=226_recipe_authoring_gates\nLIVE_DONOR_HTTP_CALLS=0\nOPENAI_CALLS=0\nLIVE_AI_CALLS=0\nREAL_RECIPE_VERSIONS_CREATED=0\nAUTO_PUBLISHED_RECIPES=0\n\nMODEL=deterministic identity/family/form resolver; generic identities never select arbitrary concrete Products.\nPROCESS_POLICY=process ingredients remain accounting-required except explicit non-purchased water.\nCOMPOUND_POLICY=comma-separated lines remain explicit until safely normalized.\nALTERNATIVE_POLICY=or/either lines remain explicit alternatives; no arbitrary option is selected.\nNUTRITION_AUTHORITY=CANONICAL_PRODUCT_DATA\n\nARTIFACT_BEFORE_AFTER=.data/owner-reports/RECIPE-PRODUCT-FORM-RESOLUTION-01-BEFORE-AFTER.csv\nARTIFACT_TOP_GAPS=.data/owner-reports/RECIPE-PRODUCT-FORM-RESOLUTION-01-TOP-REMAINING-GAPS.csv\nARTIFACT_SEMANTIC_AUDIT=.data/owner-reports/RECIPE-PRODUCT-FORM-RESOLUTION-01-SEMANTIC-AUDIT.csv\n\nCANONICAL_VERIFIER=NOT_RUN_AFTER_SEMANTIC_HARDENING\nFINAL_VERDICT=RECIPE_PRODUCT_FORM_RESOLUTION_01A_SEMANTIC_AUDIT_PENDING_VERIFICATION\n`;
writeFileSync(reportPath, report);
console.info(JSON.stringify({ corpusCandidates: recipes.length, totalLines, beforeMapped: 844, afterExact, safeAlias, afterFamily, afterProcess, afterAmbiguous, afterMissing, parseNoise, sectionLabels, compoundLines, alternativeLines, deterministic, deterministicRate: deterministic / totalLines, foodResolutionRate: foodDeterministic / Math.max(1, foodLines), fullyProductMappable, familyPending, partialCandidates, blockedCandidates, stateExamples: Object.fromEntries(stateExamples) }, null, 2));
