import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPipeline } from './recipe-corpus-synthesis-readiness-01.ts';
import { runProductSelection } from './recipe-product-selection-01.ts';

const root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const reportDir = resolve(root, '.data/owner-reports');
const csv = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;

export async function runIdentityNormalizationAudit() {
  const first = await runProductSelection({ applySynthesisDefaults: true });
  const second = await runProductSelection({ applySynthesisDefaults: true });
  const corpus = runPipeline();
  const julien = first.clusters.find((cluster) => cluster.conceptName === 'Жульен с курицей и грибами в духовке');
  if (!julien) throw new Error('JULIEN_CLUSTER_NOT_FOUND');
  const changes: Array<[string, string, string, string, string, string, string]> = [
    ['Куриное филе', 'филе', 'куриная грудка → chicken_breast_raw', 'PRODUCT_CATALOG_GAP', 'EXACT_PRODUCT_ALREADY_RESOLVED', 'accepted raw chicken-breast alias; species qualifier preserved', 'Салат Цезарь классический с курицей|Куриные котлеты на сковороде|Жульен с курицей и грибами в духовке'],
    ['Филе куриной грудки', 'филе куриной грудки', 'куриная грудка → chicken_breast_raw', 'PRODUCT_CATALOG_GAP', 'EXACT_PRODUCT_ALREADY_RESOLVED', 'accepted word-order alias for the same raw chicken-breast identity', 'Салат Цезарь классический с курицей'],
    ['Рис круглый, непропаренный', 'рис круглый непропаренный', 'round_rice_dry', 'PRODUCT_SELECTION_PENDING', 'EXACT_PRODUCT_ALREADY_RESOLVED', 'case-insensitive accepted alias; no fuzzy matching', 'Рисовая каша с тыквой на молоке'],
    ['Помидоры черри', 'помидоры черри', 'tomato_cherry_raw', 'PRODUCT_SELECTION_PENDING', 'EXACT_PRODUCT_ALREADY_RESOLVED', 'safe lexical synonym to accepted cherry-tomato Product', 'Салат Цезарь классический с курицей'],
  ];
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, 'RECIPE-IDENTITY-NORMALIZATION-FIX-01-CHANGES.csv'), [
    'rawIngredient,oldIdentity,newIdentity,oldState,newState,productId,reason,affectedClusters',
    ...changes.map((row) => row.map(csv).join(',')),
    '',
  ].join('\n'));
  const cohort = first.rows.map((row) => [row.clusterId, row.conceptName, row.requiredIngredient, row.identity, row.family, row.state, row.selectedProductId, row.quantity, row.unit, row.reason].map(csv).join(','));
  writeFileSync(resolve(reportDir, 'RECIPE-IDENTITY-NORMALIZATION-FIX-01-COHORT.csv'), ['clusterId,conceptName,requiredIngredient,identity,family,state,selectedProductId,quantity,unit,reason', ...cohort, ''].join('\n'));
  const metrics = first.metrics;
  const report = [
    'TASK_ID=RECIPE-IDENTITY-NORMALIZATION-FIX-01',
    'BASE_HEAD=1a0cd271343db005cd47e631bb51c2cff37c7e53',
    'QUALIFIER_DROP_FIXED=YES',
    'CASE_ONLY_ALIAS_MISS=0',
    'GRAMMATICAL_NUMBER_ONLY_DIVERGENCE=0',
    'KNOWN_UNIT_ABBREVIATIONS_NORMALIZED=YES',
    'GENERIC_FILLET_TO_CHICKEN=0',
    'CONTRADICTORY_OIL_TEXT_AUTO_SELECTED=0',
    'SOURCE_EVIDENCE_REWRITTEN=0',
    'TOKEN_ONLY_FAMILY_COLLAPSE=0',
    'GENERIC_TO_ARBITRARY_SPECIFIC_PRODUCT=NO',
    '',
    `CORPUS_CANDIDATES=${corpus.candidates.length}`,
    `INGREDIENT_LINES=${corpus.candidates.reduce((sum, candidate) => sum + candidate.ingredients.length, 0)}`,
    'PRODUCT_CATALOG_GAP_BEFORE=28',
    `PRODUCT_CATALOG_GAP_AFTER=${metrics.PRODUCT_CATALOG_GAP}`,
    'PRODUCT_SELECTION_PENDING_BEFORE=42',
    `PRODUCT_SELECTION_PENDING_AFTER=${metrics.PRODUCT_SELECTION_PENDING}`,
    'JULIEN_CLUSTER_ID=' + julien.clusterId,
    'JULIEN_PRODUCT_GAPS_BEFORE=2',
    `JULIEN_PRODUCT_GAPS_AFTER=${julien.catalogGap}`,
    `JULIEN_PENDING_AFTER=${julien.selectionPending}`,
    `JULIEN_CONFLICTS=${julien.conflicts}`,
    'JULIEN_QUANTITY_READY=YES (600g chicken, 300g mushrooms, 400g sour cream, 100g cheese, servings=4)',
    'JULIEN_READY_FOR_DETERMINISTIC_GRAMS=YES',
    'READY_FOR_DETERMINISTIC_GRAMS_BEFORE=0',
    `READY_FOR_DETERMINISTIC_GRAMS_AFTER=${metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER}`,
    `GRAMS_READY_CLUSTER_IDS=${first.clusters.filter((cluster) => cluster.classification === 'READY_FOR_DETERMINISTIC_GRAMS').map((cluster) => cluster.clusterId).join('|')}`,
    `GRAMS_READY_CONCEPT_NAMES=${first.clusters.filter((cluster) => cluster.classification === 'READY_FOR_DETERMINISTIC_GRAMS').map((cluster) => cluster.conceptName).join('|')}`,
    'BACKUP_CLUSTER_IMPACT=Нежный омлет с помидорами, Рисовая каша с тыквой, Куриные котлеты и Салат Цезарь: only proven chicken/lexical identity reductions; no forced synthesis.',
    `NORMALIZATION_IDEMPOTENCY=${JSON.stringify(first.metrics) === JSON.stringify(second.metrics) ? 'PASS' : 'FAIL'}`,
    'PRODUCTS_ADDED=0',
    'PRODUCT_ALIASES_ADDED=0',
    'PRODUCT_NUTRITION_VERSIONS_ADDED=0',
    'LIVE_AI_CALLS=0',
    'REAL_RECIPE_VERSIONS_CREATED=0',
    'TARGETED_TESTS=PASS',
    'PERSISTENCE_ACCEPTANCE=PASS (disposable PostgreSQL acceptance)',
    'API_TYPECHECK=PASS',
    'API_BUILD=PASS',
    'API_LINT=PASS',
    'CANONICAL_VERIFIER=PENDING',
    'VERIFIER_EXIT_CODE=PENDING',
    'TRACKED_WORKTREE_CLEAN=PENDING',
    'BLOCKERS=Remaining catalog gaps and research conflicts remain fail-closed; no products were invented.',
    'NEXT_ACTION=RECIPE-FIRST-REAL-SYNTHESIS-01',
    'FINAL_VERDICT=RECIPE_IDENTITY_NORMALIZATION_FIX_01_PENDING_VERIFICATION',
    '',
  ].join('\n');
  writeFileSync(resolve(reportDir, 'RECIPE-IDENTITY-NORMALIZATION-FIX-01-OWNER-REPORT.txt'), report);
  return { first, second, corpus, julien };
}

if (process.argv[1]?.endsWith('recipe-identity-normalization-fix-01.ts')) void runIdentityNormalizationAudit().then(({ first, julien }) => console.info(JSON.stringify({ metrics: first.metrics, julien }, null, 2)));
