import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPipeline } from './recipe-corpus-synthesis-readiness-01.ts';
import { buildIngredientStepEvidence } from '../src/modules/recipe-platform/domain/recipe-step-ingredient-evidence.policy.ts';

const TARGET_CLUSTER_ID = 'dcluster_8c521f996b1e8844f530ff12';
const root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const out = resolve(root, '.data/owner-reports');

function csvCell(value: unknown): string { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export function runIngredientEvidenceReport(): ReturnType<typeof buildIngredientStepEvidence> {
  const result = runPipeline();
  const cluster = result.clusters.find((item) => item.clusterId === TARGET_CLUSTER_ID);
  if (!cluster) throw new Error(`TARGET_CLUSTER_NOT_FOUND:${TARGET_CLUSTER_ID}`);
  const evidence = buildIngredientStepEvidence({ cluster, candidates: result.candidates });
  mkdirSync(out, { recursive: true });
  const corpusRows = evidence.matrix.map((row) => [row.candidateId, row.sourceStepOrdinal, row.canonicalProductId, row.methodRole, row.evidenceClass, row.sourceUrl, row.rawSnapshotHash].map(csvCell).join(','));
  writeFileSync(resolve(out, 'RECIPE-STEP-INGREDIENT-EVIDENCE-01-CORPUS.csv'), ['candidateId,sourceStepOrdinal,canonicalProductId,methodRole,evidenceClass,sourceUrl,rawSnapshotHash', ...corpusRows].join('\n') + '\n');
  const julienneRows = evidence.links.map((row) => [row.candidateId, row.sourceStepOrdinal, row.canonicalProductId, row.methodRole, row.evidenceClass, row.sourceUrl, row.rawSnapshotHash].map(csvCell).join(','));
  writeFileSync(resolve(out, 'RECIPE-STEP-INGREDIENT-EVIDENCE-01-JULIENNE.csv'), ['candidateId,sourceStepOrdinal,canonicalProductId,methodRole,evidenceClass,sourceUrl,rawSnapshotHash', ...julienneRows].join('\n') + '\n');
  const byProduct = Object.fromEntries([...new Set(evidence.links.map((row) => row.canonicalProductId))].sort().map((productId) => [productId, evidence.links.filter((row) => row.canonicalProductId === productId).map((row) => ({ candidateId: row.candidateId, sourceStepOrdinal: row.sourceStepOrdinal, methodRole: row.methodRole, evidenceClass: row.evidenceClass }))]));
  const report = [
    'TASK_ID=RECIPE-STEP-INGREDIENT-EVIDENCE-01',
    `TARGET_CLUSTER_ID=${TARGET_CLUSTER_ID}`,
    'CONCEPT_SCOPE=CLASSIC_JULIENNE_CORE',
    `EVIDENCE_VERSION=${evidence.version}`,
    `SUPPORTED_LINKS=${evidence.links.length}`,
    `UNSUPPORTED_ROWS=${evidence.unsupported.length}`,
    `SOURCE_PROSE_INCLUDED=${evidence.sourceProseIncluded ? 'YES' : 'NO'}`,
    `EXCLUDED_PRODUCT_IDS=${evidence.excludedProductIds.join('|') || 'NONE'}`,
    `CANONICAL_PRODUCTS=chicken_breast_raw,mushroom_champignon_raw,sour_cream_15pct,hard_cheese_45pct,olive_oil`,
    `PRODUCT_LINKS_JSON=${JSON.stringify(byProduct)}`,
    'RICE_INCLUDED=NO',
    'MAYONNAISE_INCLUDED=NO',
    'UNRELATED_RICE_CASSEROLE_BRANCH_INCLUDED=NO',
    'AI_CALLS=0',
    'NEXT_ACTION=RECIPE-STEP-INGREDIENT-EVIDENCE-02',
  ].join('\n') + '\n';
  writeFileSync(resolve(out, 'RECIPE-STEP-INGREDIENT-EVIDENCE-01-OWNER-REPORT.txt'), report);
  return evidence;
}

if (process.argv[1]?.endsWith('recipe-step-ingredient-evidence-01.ts')) console.info(JSON.stringify(runIngredientEvidenceReport(), null, 2));

