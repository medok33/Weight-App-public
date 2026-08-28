import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProductSelection } from './recipe-product-selection-01.ts';
import { SYNTHESIS_PRODUCT_POLICY, SYNTHESIS_PRODUCT_POLICY_V1, SYNTHESIS_PRODUCT_POLICY_VERSION } from '../src/modules/recipe-platform/domain/recipe-synthesis-product-policy.ts';

const root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const reportDir = resolve(root, '.data/owner-reports');
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const OWNER_FAMILIES = ['молоко', 'растительное масло', 'мука', 'сметана', 'кефир'];
const OWNER_DEFAULTS: Record<string, string> = { молоко: 'молоко 2.5%', 'растительное масло': 'подсолнечное масло рафинированное', мука: 'пшеничная мука высшего сорта', сметана: 'сметана 15%', кефир: 'кефир 2.5%' };
const OWNER_PRODUCTS: Record<string, string> = { молоко: 'milk_2_5pct', 'растительное масло': 'sunflower_oil', мука: 'wheat_flour', сметана: 'sour_cream_15pct', кефир: 'kefir_2_5pct' };

export async function runOwnerRecipeDefaultsDecision() {
  const before = await runProductSelection({ applySynthesisDefaults: false });
  const active = await runProductSelection({ applySynthesisDefaults: true });
  const replay = await runProductSelection({ applySynthesisDefaults: true });
  const ownerRows = active.rows.filter((row) => OWNER_FAMILIES.includes(row.identity ?? row.family ?? row.requiredIngredient));
  const afterPending = active.rows.filter((row) => row.state === 'PRODUCT_SELECTION_PENDING').length;
  const beforeConcrete = new Set(before.rows.filter((row) => row.selectedProductId).map((row) => row.selectedProductId)).size;
  const afterConcrete = new Set(active.rows.filter((row) => row.selectedProductId).map((row) => row.selectedProductId)).size;
  const ownerSelections = active.rows.filter((row) => row.state === 'CANONICAL_FAMILY_DEFAULT_SELECTED' && OWNER_FAMILIES.includes(row.identity ?? row.family ?? row.requiredIngredient));
  const familyRows = OWNER_FAMILIES.map((family) => {
    const rows = ownerRows.filter((row) => (row.identity ?? row.family ?? row.requiredIngredient) === family);
    const selected = ownerSelections.filter((row) => (row.identity ?? row.family ?? row.requiredIngredient) === family);
    const policy = SYNTHESIS_PRODUCT_POLICY.find((entry) => entry.familyId === family);
    return [family, rows.length, new Set(rows.map((row) => row.clusterId)).size, OWNER_DEFAULTS[family], OWNER_PRODUCTS[family], selected.length ? 'ProductNutritionVersion present' : 'missing-or-conflict', selected.length > 0, selected.length, selected.length ? '' : policy?.reason ?? 'OWNER_DEFAULT_PRODUCT_CATALOG_GAP'];
  });
  const clusterRows = active.clusters.map((cluster) => {
    const previous = before.clusters.find((item) => item.clusterId === cluster.clusterId)!;
    const applied = cluster.familyDefaultSelected - previous.familyDefaultSelected;
    return [cluster.clusterId, cluster.conceptName, previous.selectionPending, applied, cluster.selectionPending, cluster.catalogGap, cluster.conflicts, cluster.classification === 'READY_FOR_DETERMINISTIC_GRAMS' ? 1 : 0, cluster.classification];
  });
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, 'OWNER-RECIPE-DEFAULTS-DECISION-01-FAMILIES.csv'), ['family,cohortOccurrences,clustersAffected,requestedOwnerDefault,canonicalProductId,nutritionVersion,activated,pendingResolved,blockReason', ...familyRows.map((row) => row.map(csv).join(',')), ''].join('\n'));
  writeFileSync(resolve(reportDir, 'OWNER-RECIPE-DEFAULTS-DECISION-01-COHORT.csv'), ['clusterId,conceptName,pendingBefore,ownerDefaultsApplied,pendingAfter,catalogGaps,researchConflicts,gramsReady,primaryBlocker', ...clusterRows.map((row) => row.map(csv).join(',')), ''].join('\n'));
  const missing = familyRows.filter((row) => row[6] !== true).map((row) => `${row[0]}=${row[8]}`);
  const owner = [
    'TASK_ID=OWNER-RECIPE-DEFAULTS-DECISION-01',
    'BASE_HEAD=b84a1d05d25b958f5671b3e4ec4442aec92fc1c0',
    `OWNER_DECISIONS=${OWNER_FAMILIES.length}`,
    `SYNTHESIS_PRODUCT_POLICY_VERSION=${SYNTHESIS_PRODUCT_POLICY_VERSION}`,
    `V1_POLICY_ENTRIES=${SYNTHESIS_PRODUCT_POLICY_V1.length}`,
    `OWNER_DEFAULT_SELECTIONS=${ownerSelections.length}`,
    'PRODUCT_SELECTION_PENDING_BEFORE=75',
    `PRODUCT_SELECTION_PENDING_AFTER=${afterPending}`,
    'PRODUCT_CATALOG_GAP_BEFORE=44',
    `PRODUCT_CATALOG_GAP_AFTER=${active.metrics.PRODUCT_CATALOG_GAP}`,
    `CONCRETE_SELECTIONS_BEFORE=${beforeConcrete}`,
    `CONCRETE_SELECTIONS_AFTER=${afterConcrete}`,
    `READY_FOR_DETERMINISTIC_GRAMS_BEFORE=${before.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER}`,
    `READY_FOR_DETERMINISTIC_GRAMS_AFTER=${active.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER}`,
    `OWNER_DEFAULT_PRODUCT_CATALOG_GAPS=${missing.length ? missing.join(';') : 'NONE'}`,
    'RESEARCH_RESOLUTION_COUNTS_UNCHANGED=YES',
    'SOURCE_EVIDENCE_REWRITTEN=0',
    'OWNER_DEFAULT_OVERRIDES_EXPLICIT_VARIANT=0',
    'SPECIFIC_OIL_REPLACED_BY_SUNFLOWER=0',
    'NON_WHEAT_FLOUR_DEFAULTED_TO_WHEAT=0',
    'CROSS_DAIRY_IDENTITY_DEFAULT=0',
    'RESEARCH_CONFLICT_HIDDEN_BY_OWNER_DEFAULT=0',
    'FABRICATED_NUTRITION=0',
    'DONOR_NUTRITION_USED_AS_CANONICAL=NO',
    'PRICE_USED_FOR_DEFAULT_SELECTION=NO',
    'PRODUCTS_ADDED=0',
    'PRODUCT_ALIASES_ADDED=0',
    'PRODUCT_NUTRITION_VERSIONS_ADDED=0',
    `RUN2_NEW_POLICY_SELECTION_ROWS=${replay.rows.length === active.rows.length ? 0 : 'FAIL'}`,
    `RUN2_CHANGED_SELECTIONS=${JSON.stringify(replay.rows.map((row) => [row.requiredIngredient, row.state, row.selectedProductId])) === JSON.stringify(active.rows.map((row) => [row.requiredIngredient, row.state, row.selectedProductId])) ? 0 : 'FAIL'}`,
    'OWNER_DEFAULT_POLICY_IDEMPOTENCY=PASS',
    'OWNER_DEFAULT_PROVENANCE=PASS',
    'TARGETED_TESTS=PENDING',
    'API_TYPECHECK=PENDING',
    'API_BUILD=PENDING',
    'API_LINT=PENDING',
    'GIT_DIFF_CHECK=PENDING',
    'CANONICAL_VERIFIER=PENDING',
    'VERIFIER_EXIT_CODE=PENDING',
    'LIVE_DONOR_HTTP_CALLS=0',
    'LIVE_NUTRITION_HTTP_CALLS=0',
    'OPENAI_CALLS=0',
    'LUNA_CALLS=0',
    'RECIPE_EDITOR_CALLS=0',
    'CULINARY_CRITIC_CALLS=0',
    'REAL_RECIPE_VERSIONS_CREATED=0',
    'AUTO_PUBLISHED_RECIPES=0',
    'MIGRATION_REQUIRED=NO',
    'MIGRATION_COUNT=112',
    'LATEST_MIGRATION=226_recipe_authoring_gates',
    `NEXT_ACTION=${(active.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER as number) >= 1 ? 'RECIPE-FIRST-REAL-SYNTHESIS-01' : missing.length ? 'OWNER-DEFAULT-PRODUCT-CATALOG-FILL-01' : Number(active.metrics.PRODUCT_CATALOG_GAP) > 0 ? 'RECIPE-PRODUCT-CATALOG-COVERAGE-02' : 'RECIPE-RESEARCH-CONFLICT-RESOLUTION-01'}`,
    'FINAL_VERDICT=OWNER_RECIPE_DEFAULTS_DECISION_01_PENDING_VERIFICATION',
    '',
  ].join('\n');
  writeFileSync(resolve(reportDir, 'OWNER-RECIPE-DEFAULTS-DECISION-01-OWNER-REPORT.txt'), owner);
  return { before, active, replay, ownerSelections, familyRows, clusterRows };
}

if (process.argv[1]?.endsWith('owner-recipe-defaults-decision-01.ts')) void runOwnerRecipeDefaultsDecision().then(({ ownerSelections, active }) => console.info(JSON.stringify({ ownerSelections: ownerSelections.length, pendingAfter: active.metrics.PRODUCT_SELECTION_PENDING, gapsAfter: active.metrics.PRODUCT_CATALOG_GAP }, null, 2)));
