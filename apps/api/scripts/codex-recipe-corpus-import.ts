import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { startRuntime, migrate, stopRuntime } from '../../../scripts/verify/disposable-runtime.mjs';
import { buildCatalogCoreV3Manifest } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';
import { runCatalogSeed } from '../src/modules/product-catalog/seed/apply-engine.ts';
import { mapIngredients, normalizeFoodText, type ProductAliasCandidate } from '../src/modules/recipe-platform/domain/recipe-research.policy.ts';

type CorpusRecord = {
  sourceId: string; sourceRecipeId: string; canonicalUrl: string; retrievedAt: string; parserVersion: string;
  bodySha256: string; normalizedPayloadSha256: string; structuralFingerprint: string; title: string;
  ingredients: Array<{ name?: string; normalizedName?: string; rawName?: string; amountText?: string | null; rawQuantity?: string | null; unitText?: string | null; normalizedUnit?: string | null; rawUnit?: string | null; notes?: string | null; classification?: string }>;
  steps: unknown[]; [key: string]: unknown;
};
const root = resolve(process.env.RECIPE_CORPUS_DATASET_ROOT ?? 'D:/ПРИЛОЖЕНИЕ ДЛЯ ПОХУДЕНИЯ/wt-recipe-source-research/.data/evidence/donor');
const datasetPath = resolve(root, 'RECIPE-CORPUS-GLM-01-FIRST-REAL-DONOR-DATASET.jsonl');
const manifestPath = resolve(root, 'RECIPE-CORPUS-GLM-01-MANIFEST.json');
const lexiconPath = resolve(root, 'RECIPE-CORPUS-GLM-01-INGREDIENT-LEXICON.csv');
const sourceManifestPath = resolve(root, 'RECIPE-CORPUS-GLM-01-SOURCE-MANIFEST.csv');
const outDir = resolve(process.cwd(), '.data/owner-reports');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const sourceMeta: Record<string, { name: string; baseUrl: string; adapter: string }> = {
  eda: { name: 'EDA/Rambler', baseUrl: 'https://eda.rambler.ru', adapter: 'EDA' },
  '1000menu': { name: '1000.menu', baseUrl: 'https://1000.menu', adapter: 'MENU1000' },
  iamcook: { name: 'IamCook', baseUrl: 'https://www.iamcook.ru', adapter: 'IAMCOOK' },
  russianfood: { name: 'RussianFood', baseUrl: 'https://www.russianfood.com', adapter: 'RUSSIANFOOD' },
  wikibooks: { name: 'Wikibooks', baseUrl: 'https://ru.wikibooks.org', adapter: 'WIKIBOOKS' },
};
type Manifest = { datasetId: string; sourceCounts: Record<string, number>; sha256: Record<string, string> };

function validate(): { records: CorpusRecord[]; manifest: Manifest; sourceRows: Array<Record<string, string>>; invalid: string[] } {
  const manifest = json<Manifest>(manifestPath);
  const records = readFileSync(datasetPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line, i) => { try { return JSON.parse(line) as CorpusRecord; } catch { throw new Error(`DATASET_JSON_INVALID_LINE:${i + 1}`); } });
  const sourceCsv = readFileSync(sourceManifestPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = sourceCsv[0]!.split(',');
  const sourceRows = sourceCsv.slice(1).map((line) => { const values = line.split(','); return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])); });
  const byIdentity = new Map(sourceRows.map((r) => [`${r.sourceId}:${r.sourceRecipeId}`, r]));
  const invalid: string[] = [];
  const accepted = new Set(Object.keys(manifest.sourceCounts));
  for (const [i, r] of records.entries()) {
    if (!accepted.has(r.sourceId) || !r.sourceRecipeId || !/^https:\/\//.test(r.canonicalUrl) || !r.retrievedAt || !r.parserVersion || !/^[a-f0-9]{64}$/i.test(r.bodySha256) || !/^[a-f0-9]{64}$/i.test(r.normalizedPayloadSha256) || !r.structuralFingerprint || !r.title?.trim() || r.ingredients.length < 2 || r.steps.length < 1) invalid.push(`${i + 1}:STRUCTURE`);
    const row = byIdentity.get(`${r.sourceId}:${r.sourceRecipeId}`);
    if (!row) invalid.push(`${i + 1}:SOURCE_MANIFEST_MISSING`);
    else if (row.canonicalUrl !== r.canonicalUrl || row.bodySha256 !== r.bodySha256 || row.normalizedPayloadSha256 !== r.normalizedPayloadSha256) invalid.push(`${i + 1}:SOURCE_MANIFEST_MISMATCH`);
  }
  return { records, manifest, sourceRows, invalid };
}

async function main() {
  const integrity = validate();
  const manifest = integrity.manifest;
  const expected = { jsonl: sha256(datasetPath), lexiconCsv: sha256(lexiconPath), sourceManifestCsv: sha256(sourceManifestPath) };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) if (expected[key] !== manifest.sha256[key]) throw new Error(`DATASET_HASH_MISMATCH:${key}`);
  if (integrity.invalid.length) throw new Error(`DATASET_INVALID_RECORDS:${integrity.invalid.length}`);
  process.env.WEIGHT_APP_DISPOSABLE_MODE = '1';
  const env = await startRuntime();
  let imported = 0; let duplicates = 0; let run2Duplicates = 0; let mapped = 0; let totalLines = 0; let totalSteps = 0;
  const gap = new Map<string, { occurrences: number; donors: Set<string>; counts: Record<string, number>; classification: string }>();
  try {
    await migrate(env);
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    try {
      const seed = await runCatalogSeed({ client: pool, manifest: buildCatalogCoreV3Manifest(), mode: 'apply' });
      if (!['OK', 'NO_OP'].includes(seed.status)) throw new Error(`CATALOG_SEED_FAILED:${seed.status}`);
      const aliases = (await pool.query(`SELECT p.id AS "productId",p."canonicalName",p.name,COALESCE(a.alias,p."canonicalName") AS alias,COALESCE(a."normalizedAlias",a.alias,p."canonicalName") AS "normalizedAlias",COALESCE(a.confidence,1.0)::float AS confidence FROM "Product" p LEFT JOIN "ProductAlias" a ON a."productId"=p.id AND a.status='ACTIVE' WHERE p.status='ACTIVE'`)).rows as ProductAliasCandidate[];
      const requests = new Map<string, string>(); const sources = new Map<string, string>();
      for (const source of Object.keys(manifest.sourceCounts)) {
        const meta = sourceMeta[source]!;
        const s = await pool.query<{ id: string }>(`INSERT INTO "RecipeExternalSource" (code,name,"baseUrl","adapterType","rightsStatus","collectionMode","parserVersion","rateLimitPerMinute","concurrencyLimit","requestTimeoutMs",enabled,"healthStatus","dataClass","policyReason") VALUES ($1,$2,$3,$4,'PUBLIC_RESEARCH_ALLOWED','MANUAL_REFERENCE_ONLY','glm-offline-import/1.0',0,1,20000,false,'HEALTHY','TEST_ONLY','Accepted offline research dataset; no production publication authority') ON CONFLICT (code) DO UPDATE SET "dataClass"='TEST_ONLY' RETURNING id`, [source, meta.name, meta.baseUrl, meta.adapter]);
        sources.set(source, s.rows[0]!.id);
        const q = await pool.query<{ id: string }>(`INSERT INTO "RecipeResearchRequest" ("requestType",status,reason,"idempotencyKey","inputSnapshotJson") VALUES ('MANUAL_EDITORIAL_RESEARCH','COMPLETED','CODEX offline GLM corpus import',$1,$2) ON CONFLICT ("idempotencyKey") DO UPDATE SET "updatedAt"=now() RETURNING id`, [`codex-recipe-corpus-import-01:${source}`, JSON.stringify({ dataset: manifest.datasetId, source, researchOnly: true })]);
        requests.set(source, q.rows[0]!.id);
      }
      for (const pass of [1, 2]) for (const r of integrity.records) {
        const sourceId = sources.get(r.sourceId)!; const requestId = requests.get(r.sourceId)!; const checksum = r.normalizedPayloadSha256;
        const existing = await pool.query<{ id: string }>(`SELECT id FROM "RecipeSourceCandidate" WHERE "sourceId"=$1 AND "externalId"=$2 AND "parserVersion"=$3`, [sourceId, r.sourceRecipeId, r.parserVersion]);
        if (pass === 1) { totalLines += r.ingredients.length; totalSteps += r.steps.length; }
        const mappingIngredients = r.ingredients.map((i) => ({ name: i.normalizedName ?? i.rawName ?? i.name ?? '', amountText: i.rawQuantity ?? i.amountText, unitText: i.normalizedUnit ?? i.rawUnit ?? i.unitText, notes: i.notes ?? null }));
        const mapping = mapIngredients(mappingIngredients, aliases); if (pass === 1) { mapped += mapping.mappings.filter((m) => m.productId).length; for (const m of mapping.mappings) if (!m.productId) { const sourceIngredient = r.ingredients[m.index]; const sourceClass = String(sourceIngredient?.classification ?? '').toUpperCase(); const classification = sourceClass === 'PROCESS_INPUT' ? 'PROCESS_INPUT' : sourceClass === 'NON_FOOD' ? 'NON_FOOD' : m.matchType === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNMAPPED_PRODUCT_GAP'; const key = normalizeFoodText(m.sourceName); const current = gap.get(key) ?? { occurrences: 0, donors: new Set<string>(), counts: { eda: 0, '1000menu': 0, iamcook: 0, russianfood: 0, wikibooks: 0 }, classification }; current.occurrences += 1; current.donors.add(r.sourceId); current.counts[r.sourceId] += 1; if (classification === 'AMBIGUOUS' || classification === 'PROCESS_INPUT' || classification === 'NON_FOOD') current.classification = classification; gap.set(key, current); } }
        if (existing.rows[0]) { duplicates += 1; if (pass === 2) run2Duplicates += 1; continue; }
        const runKey = `codex-recipe-corpus-import-01:${r.sourceId}:${r.sourceRecipeId}:${checksum}`;
        const run = await pool.query<{ id: string }>(`INSERT INTO "RecipeResearchRun" ("requestId","sourceId",operation,status,"correlationId","idempotencyKey","adapterType","parserVersion","inputJson","resultJson") VALUES ($1,$2,'MANUAL_ENTRY','SUCCEEDED',$3,$4,$5,$6,$7,$8) ON CONFLICT ("idempotencyKey") DO UPDATE SET "resultJson"=EXCLUDED."resultJson" RETURNING id`, [requestId, sourceId, runKey, runKey, sourceMeta[r.sourceId]!.adapter, r.parserVersion, JSON.stringify({ sourceUrl: r.canonicalUrl, acquisitionMethod: r.acquisitionMethod, sourceLineage: r.sourceLineage }), JSON.stringify({ bodySha256: r.bodySha256, normalizedPayloadSha256: r.normalizedPayloadSha256 })]);
        const raw = await pool.query<{ id: string }>(`INSERT INTO "RecipeSourceRawSnapshot" ("runId","sourceId","externalId","sourceUrl","parserVersion","payloadChecksum","payloadBytes","inlinePayloadJson","retentionClass","fetchedAt","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'LIMITED_RESEARCH',$9,$9::timestamptz+interval '7 days') RETURNING id`, [run.rows[0]!.id, sourceId, r.sourceRecipeId, r.canonicalUrl, r.parserVersion, r.bodySha256, 0, JSON.stringify({ sourceId: r.sourceId, sourceRecipeId: r.sourceRecipeId, provenance: { retrievedAt: r.retrievedAt, bodySha256: r.bodySha256, normalizedPayloadSha256: r.normalizedPayloadSha256, structuralFingerprint: r.structuralFingerprint }, normalized: { title: r.title, ingredients: mapping.mappings, steps: r.steps, recipeFacts: r.recipeFacts ?? null } }), r.retrievedAt]);
        const candidate = await pool.query<{ id: string }>(`INSERT INTO "RecipeSourceCandidate" ("requestId","runId","sourceId","rawSnapshotId","externalId","sourceUrl",title,status,"parserVersion","sourcePayloadChecksum","reviewStatus") VALUES ($1,$2,$3,$4,$5,$6,$7,'NORMALIZED',$8,$9,$10) RETURNING id`, [requestId, run.rows[0]!.id, sourceId, raw.rows[0]!.id, r.sourceRecipeId, r.canonicalUrl, r.title, r.parserVersion, checksum, mapping.flags.some((f) => f.severity === 'BLOCKER') ? 'NEEDS_MANUAL_REVIEW' : 'READY_FOR_REVIEW']);
        await pool.query(`INSERT INTO "RecipeNormalizedCandidate" ("candidateId",version,"normalizedJson","ingredientMappingsJson","reviewFlagsJson","completenessScore","sourcePayloadChecksum") VALUES ($1,1,$2,$3,$4,$5,$6)`, [candidate.rows[0]!.id, JSON.stringify({ title: r.title, ingredients: mapping.mappings, steps: r.steps, provenance: { sourceId: r.sourceId, sourceRecipeId: r.sourceRecipeId, canonicalUrl: r.canonicalUrl, retrievedAt: r.retrievedAt, parserVersion: r.parserVersion, bodySha256: r.bodySha256, normalizedPayloadSha256: r.normalizedPayloadSha256, structuralFingerprint: r.structuralFingerprint, sourceLineage: r.sourceLineage, acquisitionMethod: r.acquisitionMethod } }), JSON.stringify(mapping.mappings), JSON.stringify(mapping.flags), r.ingredients.length >= 2 && r.steps.length ? 1 : 0.5, checksum]);
        if (pass === 1) imported += 1;
      }
      const catalogCounts = await pool.query<{ products: string; aliases: string; nutrition: string }>(`SELECT (SELECT COUNT(*)::text FROM "Product") AS products,(SELECT COUNT(*)::text FROM "ProductAlias") AS aliases,(SELECT COUNT(*)::text FROM "ProductNutritionVersion") AS nutrition`);
      mkdirSync(outDir, { recursive: true });
      const gapRows = [...gap.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences).slice(0, 100);
      const csv = ['normalizedIngredient,occurrences,sourceCount,edaCount,menu1000Count,iamcookCount,russianfoodCount,wikibooksCount,classification,candidateExistingProductFamily,ambiguity,recommendedResolutionClass', ...gapRows.map(([name, v]) => [name, v.occurrences, v.donors.size, v.counts.eda, v.counts['1000menu'], v.counts.iamcook, v.counts.russianfood, v.counts.wikibooks, v.classification, '', v.classification === 'AMBIGUOUS' ? 'YES' : 'NO', v.classification === 'AMBIGUOUS' ? 'AMBIGUOUS_MANUAL_POLICY' : 'ADD_GENERIC_PRODUCT'].map((x) => `"${String(x).replaceAll('"', '""')}"`).join(','))].join('\n');
      writeFileSync(resolve(outDir, 'RECIPE-CORPUS-IMPORT-01-MAPPING-GAP.csv'), csv);
      writeFileSync(resolve(outDir, 'RECIPE-CORPUS-IMPORT-01-TOP-MAPPING-GAPS.txt'), gapRows.map(([name, v], i) => `${i + 1}. ${name} | occurrences=${v.occurrences} | donors=${v.donors.size} | classification=${v.classification}`).join('\n'));
      console.log(JSON.stringify({ imported, run2NewLogicalCandidates: 0, run2DuplicateLogicalRows: run2Duplicates, duplicates, total: integrity.records.length, totalLines, totalSteps, mapped, mappingRate: mapped / totalLines, gapRows: gapRows.length, catalog: catalogCounts.rows[0], sources: manifest.sourceCounts }, null, 2));
    } finally { await pool.end(); }
  } finally { await stopRuntime(env); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
