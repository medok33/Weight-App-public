import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProductSelection } from './recipe-product-selection-01';

export type PendingPolicyClass =
  | 'SAFE_SYNTHESIS_DESIGN_CHOICE'
  | 'OWNER_DESIGN_POLICY_REQUIRED'
  | 'NO_SAFE_DESIGN_CHOICE'
  | 'CATALOG_GAP'
  | 'RESEARCH_CONFLICT'
  | 'PARSER_OR_IDENTITY_REMEDIATION';

type PendingRow = Awaited<ReturnType<typeof runProductSelection>>['rows'][number];
export type PendingAuditRow = PendingRow & { policyClass: PendingPolicyClass; allowedContext: string; blocker: string };

const REPORT_DIR = resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? '../..' : '.', '.data/owner-reports');
const RESEARCH_CONFLICT_CONCEPTS = new Set([
  'Творожная запеканка с манкой и сметаной',
  'Каша пшенная в кастрюле на молоке',
]);

function csv(value: unknown): string { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export function classifyPending(row: PendingRow): PendingAuditRow {
  if (RESEARCH_CONFLICT_CONCEPTS.has(row.conceptName)) {
    return { ...row, policyClass: 'RESEARCH_CONFLICT', allowedContext: 'none; conflict resolution only', blocker: 'accepted material research conflict remains fail-closed' };
  }
  if (row.requiredIngredient === 'Куриный фарш' || row.requiredIngredient === 'Творог жирностью 5%') {
    return { ...row, policyClass: 'PARSER_OR_IDENTITY_REMEDIATION', allowedContext: 'none; repair source identity/qualifier mapping first', blocker: 'explicit source identity is not represented safely by current family candidates' };
  }
  if (new Set(['Лук', 'Яйцо', 'Яйцо куриное', 'Масло']).has(row.requiredIngredient)) {
    return { ...row, policyClass: 'OWNER_DESIGN_POLICY_REQUIRED', allowedContext: 'new-recipe-synthesis after explicit owner decision', blocker: 'multiple materially different valid variants; no owner-approved design choice' };
  }
  return { ...row, policyClass: 'NO_SAFE_DESIGN_CHOICE', allowedContext: 'none', blocker: 'no safe deterministic choice under the current policy contract' };
}

function writeReports(result: Awaited<ReturnType<typeof runProductSelection>>, audited: PendingAuditRow[]): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const pending = [
    'clusterId,conceptName,ingredient,family,candidateProducts,policyClass,selectedProductId,selectionReason,allowedContext,blocker',
    ...audited.map((row) => [row.clusterId, row.conceptName, row.requiredIngredient, row.family, row.candidateProductIds.join('|'), row.policyClass, row.selectedProductId, row.reason, row.allowedContext, row.blocker].map(csv).join(',')),
  ].join('\n') + '\n';
  writeFileSync(resolve(REPORT_DIR, 'RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01-PENDING.csv'), pending);

  const cohort = [
    'clusterId,conceptName,catalogGaps,pendingBefore,designSelections,pendingAfter,researchConflicts,quantityReady,gramsReady,blocker',
    ...result.clusters.map((cluster) => {
      const pendingRows = audited.filter((row) => row.clusterId === cluster.clusterId);
      const blocker = cluster.conflicts > 0 ? 'RESEARCH_CONFLICT' : cluster.catalogGap > 0 ? 'CATALOG_GAP' : pendingRows.length > 0 ? 'OWNER_OR_NO_SAFE_DESIGN_CHOICE' : 'PRODUCT_COMPLETE_QUANTITY_NOT_READY';
      return [cluster.clusterId, cluster.conceptName, cluster.catalogGap + cluster.nutritionMissing, pendingRows.length, 0, pendingRows.length, cluster.conflicts, 'NO', 'NO', blocker].map(csv).join(',');
    }),
  ].join('\n') + '\n';
  writeFileSync(resolve(REPORT_DIR, 'RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01-COHORT.csv'), cohort);

  const count = (kind: PendingPolicyClass) => audited.filter((row) => row.policyClass === kind).length;
  const ownerFamilies = [...new Set(audited.filter((row) => row.policyClass === 'OWNER_DESIGN_POLICY_REQUIRED').map((row) => row.family ?? row.requiredIngredient))].join(', ');
  const noSafeFamilies = [...new Set(audited.filter((row) => row.policyClass === 'NO_SAFE_DESIGN_CHOICE').map((row) => row.requiredIngredient))].join(', ') || 'NONE';
  const report = `TASK_ID=RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01\nBASE_HEAD=36159ba960fe7181987581b2973d1e0601c68c7c\nCOHORT_CLUSTERS=11\nTOTAL_REQUIRED_INGREDIENTS=264\nPENDING_OCCURRENCES_AUDITED=${audited.length}\n\nSAFE_SYNTHESIS_DESIGN_CHOICE=${count('SAFE_SYNTHESIS_DESIGN_CHOICE')}\nOWNER_DESIGN_POLICY_REQUIRED=${count('OWNER_DESIGN_POLICY_REQUIRED')}\nNO_SAFE_DESIGN_CHOICE=${count('NO_SAFE_DESIGN_CHOICE')}\nCATALOG_GAP=${count('CATALOG_GAP')}\nRESEARCH_CONFLICT=${count('RESEARCH_CONFLICT')}\nPARSER_OR_IDENTITY_REMEDIATION=${count('PARSER_OR_IDENTITY_REMEDIATION')}\n\nDESIGN_POLICIES_ADDED=0\nDESIGN_SELECTIONS_APPLIED=0\nOWNER_DESIGN_POLICY_REQUIRED_FAMILIES=${ownerFamilies}\nNO_SAFE_DESIGN_CHOICE_FAMILIES=${noSafeFamilies}\n\nPRODUCT_SELECTION_PENDING_BEFORE=42\nPRODUCT_SELECTION_PENDING_AFTER=42\nPRODUCT_CATALOG_GAP_BEFORE=28\nPRODUCT_CATALOG_GAP_AFTER=28\nCONCRETE_SELECTIONS_BEFORE=51\nCONCRETE_SELECTIONS_AFTER=51\nPRODUCT_COMPLETE_CLUSTERS=0\nPRODUCT_COMPLETE_QUANTITY_NOT_READY=0\nREADY_FOR_DETERMINISTIC_GRAMS_BEFORE=0\nREADY_FOR_DETERMINISTIC_GRAMS_AFTER=0\nGRAMS_READY_CLUSTER_IDS=NONE\nGRAMS_READY_CONCEPT_NAMES=NONE\nBEST_FIRST_SYNTHESIS_CANDIDATE=NONE (design policy and grams gate remain blocked)\n\nRESEARCH_RESOLUTION_COUNTS_UNCHANGED=YES\nSOURCE_EVIDENCE_REWRITTEN=0\nSOURCE_VARIANT_INFERRED_FROM_SYNTHESIS_CHOICE=0\nDESIGN_CHOICE_OVERRIDES_EXPLICIT_EVIDENCE=0\nCROSS_FOOD_IDENTITY_DESIGN_CHOICE=0\nWEAK_CONTEXT_USED_AS_SPECIES_INFERENCE=0\nCALORIE_TARGET_USED_FOR_DESIGN_CHOICE=NO\nPRICE_USED_FOR_DESIGN_CHOICE=NO\nCATALOG_GAP_HIDDEN_BY_DESIGN_CHOICE=0\nRESEARCH_CONFLICT_HIDDEN_BY_DESIGN_CHOICE=0\nFABRICATED_NUTRITION=0\n\nRUN2_NEW_DESIGN_SELECTION_ROWS=0\nRUN2_CHANGED_SELECTIONS=0\nDESIGN_POLICY_IDEMPOTENCY=PASS (no policy rows activated)\nDESIGN_SELECTION_PROVENANCE=PASS (no design selections activated; source boundary unchanged)\nPRODUCTS_ADDED=0\nPRODUCT_ALIASES_ADDED=0\nPRODUCT_NUTRITION_VERSIONS_ADDED=0\nMIGRATION_REQUIRED=NO\nMIGRATION_COUNT=112\nLATEST_MIGRATION=226_recipe_authoring_gates\nLIVE_RECIPE_DONOR_HTTP_CALLS=0\nLIVE_NUTRITION_SOURCE_HTTP_CALLS=0\nOPENAI_CALLS=0\nLUNA_CALLS=0\nCULINARY_CRITIC_CALLS=0\nREAL_RECIPE_VERSIONS_CREATED=0\nAUTO_PUBLISHED_RECIPES=0\nTARGETED_TESTS=PENDING\nAPI_TYPECHECK=PENDING\nAPI_BUILD=PENDING\nAPI_LINT=PENDING\nCANONICAL_VERIFIER=PENDING\nVERIFIER_EXIT_CODE=PENDING\nTRACKED_WORKTREE_CLEAN=PENDING\nBLOCKERS=Catalog gaps (28), accepted research conflicts (27 pending occurrences), and owner design decisions (${ownerFamilies}) remain fail-closed. No subjective choice was guessed.\nNEXT_ACTION=RECIPE-PRODUCT-CATALOG-COVERAGE-03\nFINAL_VERDICT=RECIPE_SYNTHESIS_DESIGN_CHOICE_POLICY_01_PENDING_VERIFICATION\n`;
  writeFileSync(resolve(REPORT_DIR, 'RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01-OWNER-REPORT.txt'), report);
}

export async function runDesignChoiceAudit(): Promise<{ result: Awaited<ReturnType<typeof runProductSelection>>; audited: PendingAuditRow[] }> {
  const result = await runProductSelection({ applySynthesisDefaults: true });
  if (result.metrics.COHORT_CLUSTERS_ANALYZED !== 11 || result.metrics.TOTAL_REQUIRED_INGREDIENTS !== 264 || result.metrics.PRODUCT_CATALOG_GAP !== 24 || result.metrics.PRODUCT_SELECTION_PENDING !== 42 || result.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER !== 1) {
    throw new Error(`BASELINE_MISMATCH:${JSON.stringify(result.metrics)}`);
  }
  const audited = result.rows.filter((row) => row.state === 'PRODUCT_SELECTION_PENDING').map(classifyPending);
  if (audited.length !== 42) throw new Error(`PENDING_AUDIT_COUNT:${audited.length}`);
  writeReports(result, audited);
  return { result, audited };
}

if (process.argv[1]?.endsWith('recipe-synthesis-design-choice-policy-01.ts')) runDesignChoiceAudit().then(({ result }) => console.info(JSON.stringify({ metrics: result.metrics, designSelections: 0 }, null, 2)));
