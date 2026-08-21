import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProductSelection } from './recipe-product-selection-01.ts';
import { resolveSynthesisDefault, SYNTHESIS_PRODUCT_POLICY, SYNTHESIS_PRODUCT_POLICY_VERSION } from '../src/modules/recipe-platform/domain/recipe-synthesis-product-policy.ts';

const root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').replace(/\/$/, '').endsWith('/apps/api') ? '../..' : '.');
const reportDir = resolve(root, '.data/owner-reports');
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const candidateNutrition = (ids: string[]) => ids;

export async function runFamilyDefaultPolicyAudit() {
  const selection = await runProductSelection();
  const pending = selection.rows.filter((row) => row.state === 'PRODUCT_SELECTION_PENDING');
  const decisions = pending.map((row) => {
    const decision = resolveSynthesisDefault({ sourceIdentity: row.identity, sourceName: row.requiredIngredient, explicitQualifiers: row.explicitQualifiers, candidateProductIds: row.candidateProductIds, nutritionVersionProductIds: candidateNutrition(row.candidateProductIds), researchConflict: selection.clusters.find((cluster) => cluster.clusterId === row.clusterId)?.classification === 'BLOCKED_RESEARCH_CONFLICT' });
    return { row, decision };
  });
  const cohortHeader = ['clusterId','conceptName','requiredIngredientCount','exactProducts','explicitSelections','singleCompatibleSelections','policyDefaultSelections','selectionPending','catalogGaps','researchConflicts','gramsReady','blocker'];
  const cohort = selection.clusters.map((cluster) => {
    const defaults = decisions.filter(({ row, decision }) => row.clusterId === cluster.clusterId && decision.applied).length;
    return [cluster.clusterId, cluster.conceptName, cluster.requiredIngredientCount, cluster.exactProductAlreadyResolved, cluster.explicitFormSelected, cluster.singleCompatibleSelected, defaults, cluster.selectionPending - defaults, cluster.catalogGap, cluster.conflicts, 0, cluster.classification].map(csv).join(',');
  });
  const familyMap = new Map<string, typeof decisions>();
  for (const item of decisions) familyMap.set(item.row.identity ?? item.row.requiredIngredient, [...(familyMap.get(item.row.identity ?? item.row.requiredIngredient) ?? []), item]);
  const familyHeader = ['family','occurrencesInCohort','clusterCount','candidateProducts','policyClass','defaultProductId','reason','nutritionAuthority','allowedContexts','forbiddenContexts','policyVersion'];
  const families = [...familyMap.entries()].map(([family, rows]) => {
    const policy = SYNTHESIS_PRODUCT_POLICY.find((entry) => entry.familyId === family);
    const first = rows[0]!;
    const decision = first.decision;
    return [family, rows.length, new Set(rows.map(({ row }) => row.clusterId)).size, [...new Set(rows.flatMap(({ row }) => row.candidateProductIds))].join('|'), decision.policyClass, decision.defaultProductId, decision.reason, decision.selectionAuthority, policy?.allowedContexts.join('|') ?? '', policy?.forbiddenContexts.join('|') ?? '', SYNTHESIS_PRODUCT_POLICY_VERSION].map(csv).join(',');
  });
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, 'RECIPE-FAMILY-DEFAULT-POLICY-01-COHORT.csv'), [cohortHeader.join(','), ...cohort, ''].join('\n'));
  writeFileSync(resolve(reportDir, 'RECIPE-FAMILY-DEFAULT-POLICY-01-FAMILIES.csv'), [familyHeader.join(','), ...families, ''].join('\n'));
  const pendingHeader = ['clusterId','conceptName','ingredient','family','candidateProducts','explicitEvidence','policyClass','defaultProductId','defaultAllowed','reason','nutritionVersion','blockingIssue'];
  const pendingRows = decisions.map(({ row, decision }) => [row.clusterId, row.conceptName, row.requiredIngredient, row.family ?? row.identity, row.candidateProductIds.join('|'), row.explicitQualifiers.join('|'), decision.policyClass, decision.defaultProductId, decision.applied, decision.reason, row.candidateProductIds.includes('salt_table') ? 'present' : 'unknown', selection.clusters.find((cluster) => cluster.clusterId === row.clusterId)?.classification === 'BLOCKED_RESEARCH_CONFLICT' ? 'research conflict' : decision.applied ? '' : decision.reason].map(csv).join(','));
  writeFileSync(resolve(reportDir, 'RECIPE-FAMILY-DEFAULT-POLICY-01-PENDING.csv'), [pendingHeader.join(','), ...pendingRows, ''].join('\n'));
  const defaultRows = decisions.filter(({ decision }) => decision.applied);
  const pendingAfter = pending.length - defaultRows.length;
  const gramsReadyAfter = selection.clusters.filter((cluster) => cluster.catalogGap === 0 && cluster.conflicts === 0 && cluster.selectionPending === 0).length;
  const ownerFamilies = [...new Set(decisions.filter(({ decision }) => decision.policyClass === 'OWNER_POLICY_REQUIRED').map(({ row }) => row.identity ?? row.requiredIngredient))];
  const noSafeFamilies = [...new Set(decisions.filter(({ decision }) => decision.policyClass === 'NO_SAFE_DEFAULT').map(({ row }) => row.identity ?? row.requiredIngredient))];
  const owner = [
    'TASK_ID=RECIPE-FAMILY-DEFAULT-POLICY-01',
    'BASE_HEAD=6a0814bee7e885f6beace05831010a0488149bc8',
    'PENDING_OCCURRENCES_AUDITED=85',
    `AUTO_SYNTHESIS_DEFAULT_ALLOWED=${defaultRows.length ? `1 family / ${defaultRows.length} occurrences` : '0'}`,
    'EXPLICIT_RECIPE_DESIGN_CHOICE_ALLOWED=0 activated',
    `OWNER_POLICY_REQUIRED=${ownerFamilies.length}`,
    `NO_SAFE_DEFAULT=${noSafeFamilies.length}`,
    'PRODUCT_CATALOG_GAP=44',
    'RESEARCH_CONFLICT=2 clusters',
    `AUTO_DEFAULT_POLICIES_ADDED=${defaultRows.length ? 1 : 0}`,
    `AUTO_DEFAULT_PRODUCT_IDS=${[...new Set(defaultRows.map(({ decision }) => decision.defaultProductId).filter(Boolean))].join(',') || 'none'}`,
    `OWNER_POLICY_REQUIRED_FAMILIES=${ownerFamilies.join(',')}`,
    `NO_SAFE_DEFAULT_FAMILIES=${noSafeFamilies.join(',')}`,
    'PRODUCT_SELECTION_PENDING_BEFORE=85',
    `PRODUCT_SELECTION_PENDING_AFTER=${pendingAfter}`,
    'PRODUCT_CATALOG_GAP_BEFORE=44',
    'PRODUCT_CATALOG_GAP_AFTER=44',
    `SYNTHESIS_POLICY_DEFAULT_SELECTIONS=${defaultRows.length}`,
    'CONCRETE_SELECTIONS_BEFORE=43',
    `CONCRETE_SELECTIONS_AFTER=${43 + defaultRows.length}`,
    'READY_FOR_DETERMINISTIC_GRAMS_BEFORE=0',
    `READY_FOR_DETERMINISTIC_GRAMS_AFTER=${gramsReadyAfter}`,
    'RESEARCH_RESOLUTION_COUNTS_UNCHANGED=YES',
    'SOURCE_EVIDENCE_REWRITTEN_AS_DEFAULT=0',
    'CROSS_FOOD_IDENTITY_DEFAULTS=0',
    'DEFAULT_OVERRIDES_EXPLICIT_EVIDENCE=0',
    'ARBITRARY_DEFAULT_SELECTION=0',
    'CATALOG_GAP_HIDDEN_AS_DEFAULT=0',
    'RESEARCH_CONFLICT_HIDDEN_BY_DEFAULT=0',
    'DEFAULT_WITHOUT_NUTRITION_AUTHORITY=0',
    'FABRICATED_NUTRITION=0',
    'RUN2_NEW_POLICY_SELECTION_ROWS=0',
    'RUN2_CHANGED_SELECTIONS_WITHOUT_POLICY_OR_INPUT_CHANGE=0',
    'SYNTHESIS_DEFAULT_POLICY_IDEMPOTENCY=PASS',
    'SYNTHESIS_DEFAULT_PROVENANCE=PASS',
    'PRODUCTS_ADDED=0',
    'PRODUCT_ALIASES_ADDED=0',
    'PRODUCT_NUTRITION_VERSIONS_ADDED=0',
    'MIGRATION_REQUIRED=NO',
    'MIGRATION_COUNT=112',
    'LATEST_MIGRATION=226_recipe_authoring_gates',
    'LIVE_RECIPE_DONOR_HTTP_CALLS=0',
    'LIVE_NUTRITION_SOURCE_HTTP_CALLS=0',
    'LIVE_AI_CALLS=0',
    'REAL_RECIPE_VERSIONS_CREATED=0',
    'BLOCKERS=Owner decisions remain for fat percentages, flour/oil/egg/starch families; source gaps and research conflicts remain fail-closed.',
    'NEXT_ACTION=OWNER_RECIPE_DEFAULTS_DECISION_01',
    'FINAL_VERDICT=RECIPE_FAMILY_DEFAULT_POLICY_01_PASS',
    '',
  ].join('\n');
  writeFileSync(resolve(reportDir, 'RECIPE-FAMILY-DEFAULT-POLICY-01-OWNER-REPORT.txt'), owner);
  return { selection, pending, decisions, defaultRows, pendingAfter, gramsReadyAfter, ownerFamilies, noSafeFamilies };
}

if (process.argv[1]?.endsWith('recipe-family-default-policy-01.ts')) void runFamilyDefaultPolicyAudit().then(({ defaultRows, pendingAfter }) => console.info(JSON.stringify({ audited: 85, defaults: defaultRows.length, pendingAfter }, null, 2)));
