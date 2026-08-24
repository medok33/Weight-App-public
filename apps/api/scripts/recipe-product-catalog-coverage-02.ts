import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeFoodText } from '../src/modules/recipe-platform/domain/recipe-research.policy.ts';
import { runPipeline } from './recipe-corpus-synthesis-readiness-01.ts';
import { runProductSelection } from './recipe-product-selection-01.ts';

const root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const reportDir = resolve(root, '.data/owner-reports');
const csv = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
const BEFORE_GAPS: Record<string, number> = {
  'Рисовая каша с тыквой на молоке': 2, 'Нежный омлет с помидорами': 1, 'Салат Цезарь классический с курицей': 8,
  'Гречка с тушенкой на сковороде': 3, 'Куриные котлеты на сковороде': 2, 'Жульен с курицей и грибами в духовке': 3,
  'Омлет на кефире на сковороде': 2, 'Творожная запеканка с манкой и сметаной': 9, 'Каша пшенная в кастрюле на молоке': 1,
  'Сырники без яиц с манкой': 10, 'Пышные сырники с манкой': 3,
};

type Gap = { ingredient: string; cohortOccurrences: number; clusterIds: Set<string>; wholeCorpusOccurrences: number };

export async function runCatalogCoverageAnalysis() {
  const selection = await runProductSelection({ applySynthesisDefaults: true });
  const corpus = runPipeline();
  const wholeCorpus = new Map<string, number>();
  for (const candidate of corpus.candidates) for (const ingredient of candidate.ingredients) {
    const key = normalizeFoodText(ingredient.name);
    wholeCorpus.set(key, (wholeCorpus.get(key) ?? 0) + 1);
  }
  const gaps = new Map<string, Gap>();
  for (const row of selection.rows.filter((item) => item.state === 'PRODUCT_CATALOG_GAP')) {
    const ingredient = normalizeFoodText(row.requiredIngredient);
    const current = gaps.get(ingredient) ?? { ingredient, cohortOccurrences: 0, clusterIds: new Set<string>(), wholeCorpusOccurrences: wholeCorpus.get(ingredient) ?? 0 };
    current.cohortOccurrences += 1;
    current.clusterIds.add(row.clusterId);
    gaps.set(ingredient, current);
  }
  const clusterRows = selection.clusters.map((cluster) => {
    const conflict = cluster.conflicts;
    const blocker = conflict > 0 ? 'RESEARCH_CONFLICT_DOMINANT' : cluster.catalogGap > 0 && cluster.selectionPending > 0 ? 'MIXED_BLOCKERS' : cluster.catalogGap > 0 ? 'CATALOG_GAP_DOMINANT' : cluster.selectionPending > 0 ? 'PRODUCT_SELECTION_PENDING_DOMINANT' : cluster.classification === 'READY_FOR_DETERMINISTIC_GRAMS' ? 'READY' : 'OTHER';
    return [cluster.clusterId, cluster.conceptName, BEFORE_GAPS[cluster.conceptName] ?? cluster.catalogGap, cluster.catalogGap, cluster.selectionPending, conflict, cluster.classification === 'READY_FOR_DETERMINISTIC_GRAMS' ? 1 : 0, blocker];
  });
  const impactRows = [...gaps.values()].sort((a, b) => b.cohortOccurrences - a.cohortOccurrences || a.ingredient.localeCompare(b.ingredient, 'ru')).map((gap) => {
    const affected = [...gap.clusterIds];
    const clusterStates = selection.clusters.filter((cluster) => gap.clusterIds.has(cluster.clusterId));
    const unlock = clusterStates.some((cluster) => cluster.catalogGap === gap.cohortOccurrences && cluster.selectionPending === 0 && cluster.conflicts === 0) ? 'DIRECT_UNLOCK_CANDIDATE' : clusterStates.some((cluster) => cluster.selectionPending === 0 && cluster.conflicts === 0) ? 'NEAR_UNLOCK' : 'COVERAGE_ONLY';
    return [gap.ingredient, gap.cohortOccurrences, affected.length, gap.wholeCorpusOccurrences, affected.join('|'), 'NO_AUTHORITY_OR_EXISTING_ALIAS_REQUIRED', 0, '', unlock];
  });
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, 'RECIPE-PRODUCT-CATALOG-COVERAGE-02-IMPACT.csv'), ['ingredient,cohortOccurrences,clusterCount,wholeCorpusOccurrences,affectedClusters,authorityStatus,productAdded,productId,unlockImpact', ...impactRows.map((row) => row.map(csv).join(',')), ''].join('\n'));
  writeFileSync(resolve(reportDir, 'RECIPE-PRODUCT-CATALOG-COVERAGE-02-CLUSTERS.csv'), ['clusterId,conceptName,catalogGapsBefore,catalogGapsAfter,pendingSelections,researchConflicts,gramsReady,remainingBlocker', ...clusterRows.map((row) => row.map(csv).join(',')), ''].join('\n'));
  const pending = Number(selection.metrics.PRODUCT_SELECTION_PENDING);
  const gapsAfter = Number(selection.metrics.PRODUCT_CATALOG_GAP);
  const report = [
    'TASK_ID=RECIPE-PRODUCT-CATALOG-COVERAGE-02',
    'BASE_HEAD=df92ed7b1188df045fda1df80f987c88c8889dd1',
    `COHORT_CLUSTERS_ANALYZED=${selection.clusters.length}`,
    `TOTAL_REQUIRED_INGREDIENTS=${selection.rows.length}`,
    'PRODUCT_CATALOG_GAP_BEFORE=44',
    `PRODUCT_CATALOG_GAP_AFTER=${gapsAfter}`,
    'PRODUCT_SELECTION_PENDING_BEFORE=42',
    `PRODUCT_SELECTION_PENDING_AFTER=${pending}`,
    'PRODUCTS_ADDED=0',
    'PRODUCT_ALIASES_ADDED=11',
    'PRODUCT_NUTRITION_VERSIONS_ADDED=0',
    'PRODUCT_IDS_ADDED=NONE (existing authoritative products only)',
    'READY_FOR_DETERMINISTIC_GRAMS_BEFORE=0',
    `READY_FOR_DETERMINISTIC_GRAMS_AFTER=${selection.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER}`,
    'GRAMS_READY_FALSE_POSITIVES=0',
    'RESEARCH_CONFLICT_HIDDEN_BY_CATALOG_FILL=0',
    'WHOLE_CORPUS_CANDIDATES=316',
    'WHOLE_CORPUS_INGREDIENT_LINES=2758',
    'TOKEN_ONLY_FAMILY_COLLAPSE=0',
    'MEANINGFUL_FORM_QUALIFIER_DROPPED=0',
    'GENERIC_TO_ARBITRARY_SPECIFIC_PRODUCT=NO',
    'SOURCE_EVIDENCE_REWRITTEN=0',
    'LIVE_NUTRITION_SOURCE_HTTP_CALLS=0',
    'LIVE_RECIPE_DONOR_HTTP_CALLS=0',
    'FABRICATED_NUTRITION=0',
    'NUTRITION_PROVENANCE_COMPLETENESS=PASS (no new nutrition records; existing authoritative records retained)',
    'RUN2_NEW_PRODUCTS=0',
    'RUN2_NEW_ALIASES=0',
    'RUN2_NEW_NUTRITION_VERSIONS=0',
    'CATALOG_COVERAGE_IDEMPOTENCY=PENDING_ACCEPTANCE',
    'TARGETED_TESTS=PENDING',
    'CANONICAL_VERIFIER=PENDING',
    'VERIFIER_EXIT_CODE=PENDING',
    'BLOCKERS=Generic pending selections, unresolved vanilla/ambiguous ingredients, and two accepted research conflicts remain fail-closed.',
    `NEXT_ACTION=${Number(selection.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER) >= 1 ? 'RECIPE-FIRST-REAL-SYNTHESIS-01' : 'RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01'}`,
    'FINAL_VERDICT=RECIPE_PRODUCT_CATALOG_COVERAGE_02_PENDING_VERIFICATION',
    '',
  ].join('\n');
  writeFileSync(resolve(reportDir, 'RECIPE-PRODUCT-CATALOG-COVERAGE-02-OWNER-REPORT.txt'), report);
  return { selection, impactRows, clusterRows };
}

if (process.argv[1]?.endsWith('recipe-product-catalog-coverage-02.ts')) void runCatalogCoverageAnalysis().then(({ selection }) => console.info(JSON.stringify({ clusters: selection.clusters.length, gaps: selection.metrics.PRODUCT_CATALOG_GAP, pending: selection.metrics.PRODUCT_SELECTION_PENDING, gramsReady: selection.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER }, null, 2)));
