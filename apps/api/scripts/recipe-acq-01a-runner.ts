import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { startRuntime, migrate, stopRuntime } from '../../../scripts/verify/disposable-runtime.mjs';
import { createControlledPilotTransport } from '../src/modules/recipe-platform/application/recipe-source-http.transport.ts';
import { extractEdaSitemapChildUrls, extractEdaSitemapUrls, parseEdaHtml } from '../src/modules/recipe-platform/application/eda/eda.parser.ts';
import { extract1000MenuListingUrls, parse1000MenuHtml } from '../src/modules/recipe-platform/application/menu1000/menu1000.parser.ts';
import { extractIamCookListingUrls, parseIamCookHtml } from '../src/modules/recipe-platform/application/iamcook/iamcook.parser.ts';
import { extractRussianFoodListingUrls, parseRussianFoodHtml } from '../src/modules/recipe-platform/application/russianfood/russianfood.parser.ts';
import { EDA_HOSTNAME_ALLOWLIST, IAMCOOK_HOSTNAME_ALLOWLIST, MENU1000_HOSTNAME_ALLOWLIST, RUSSIANFOOD_HOSTNAME_ALLOWLIST } from '../src/modules/recipe-platform/domain/recipe-source-network.policy.ts';
import { mapIngredients, stableJsonChecksum, type ProductAliasCandidate } from '../src/modules/recipe-platform/domain/recipe-research.policy.ts';
import type { SourceRecipeCandidatePayload } from '../src/modules/recipe-platform/domain/recipe-source-adapter.contract.ts';
import { buildCatalogCoreV3Manifest } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';
import { runCatalogSeed } from '../src/modules/product-catalog/seed/apply-engine.ts';

type SourceCode = 'eda' | '1000menu' | 'iamcook' | 'russianfood';
type CheckpointItem = { source: SourceCode; url: string; externalId: string; status: string; attempts: number; checksum?: string; candidateId?: string; error?: string };
type Checkpoint = { version: 1; items: CheckpointItem[] };

const mode = process.argv.includes('--dry-run') ? 'dry-run' : process.argv.includes('--source-smoke') ? 'source-smoke' : 'corpus-pilot';
const target = Number(process.argv.find((x) => x.startsWith('--limit='))?.split('=')[1] ?? 120);
const checkpointPath = resolve(process.env.RECIPE_ACQ_CHECKPOINT_PATH ?? resolve(process.cwd(), '.data/research/recipe-acq-01a/checkpoint.json'));
const policy = { sourceId: 'recipe-acq-01a', allowControlledPilot: true, maxTotalRequests: 80, maxConcurrentRequests: 1, perHostMinIntervalMs: 2500, requestTimeoutMs: 20000, maxRedirects: 3 } as const;

function loadCheckpoint(): Checkpoint { try { return JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint; } catch { return { version: 1, items: [] }; } }
function saveCheckpoint(value: Checkpoint) { mkdirSync(resolve(checkpointPath, '..'), { recursive: true }); writeFileSync(checkpointPath, JSON.stringify(value, null, 2)); }
function externalId(source: SourceCode, url: string, index: number) { if (source === 'eda') return url.match(/-(\d+)(?:\/?$)/)?.[1] ?? `url-${index}`; if (source === '1000menu') return url.match(/\/cooking\/(\d+)/i)?.[1] ?? `url-${index}`; if (source === 'iamcook') return url.match(/\/recipe\/([^/?#]+)/i)?.[1] ?? `url-${index}`; return new URL(url).searchParams.get('rid') ?? `url-${index}`; }
function parserVersion(source: SourceCode) { return source === 'eda' ? 'eda/jsonld-v1' : source === '1000menu' ? '1000menu/microdata-v1' : source === 'iamcook' ? 'iamcook/jsonld-v2' : 'russianfood/jsonld-v2'; }
function allowlist(source: SourceCode) { return source === 'eda' ? EDA_HOSTNAME_ALLOWLIST : source === '1000menu' ? MENU1000_HOSTNAME_ALLOWLIST : source === 'iamcook' ? IAMCOOK_HOSTNAME_ALLOWLIST : RUSSIANFOOD_HOSTNAME_ALLOWLIST; }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
async function discover(source: SourceCode, limit: number, transport: ReturnType<typeof createControlledPilotTransport>): Promise<string[]> {
  if (source === '1000menu') {
    const out: string[] = [];
    const categories = ['klassicheskie-recepty-blud', 'salaty', 'supy', 'vypechka', 'myaso', 'zavtraki', 'deserty', 'napitki'];
    for (const category of categories) for (let page = 1; page <= 5 && out.length < limit; page += 1) {
      const pageUrl = page === 1 ? `https://1000.menu/catalog/${category}` : `https://1000.menu/catalog/${category}?page=${page}`;
      let r: Awaited<ReturnType<typeof transport.request>>;
      try { r = await transport.request({ sourceCode: source, operation: 'SEARCH', url: pageUrl, parserVersion: parserVersion(source), allowlist: allowlist(source), pilotPolicy: policy }); } catch { break; }
      for (const url of extract1000MenuListingUrls(r.bodyText, limit)) if (!out.includes(url)) out.push(url);
      if (!r.bodyText.includes('page=') && page > 1) break;
    }
    return out.slice(0, limit);
  }
  if (source === 'iamcook') {
    const r = await transport.request({ sourceCode: source, operation: 'SEARCH', url: 'https://www.iamcook.ru/section/17544', parserVersion: parserVersion(source), allowlist: allowlist(source), pilotPolicy: policy });
    return extractIamCookListingUrls(r.bodyText, limit);
  }
  if (source === 'russianfood') {
    const seed = 'https://www.russianfood.com/recipes/bytype/?fid=3';
    const r = await transport.request({ sourceCode: source, operation: 'SEARCH', url: seed, parserVersion: parserVersion(source), allowlist: allowlist(source), pilotPolicy: policy });
    return extractRussianFoodListingUrls(r.bodyText, limit);
  }
  let index: Awaited<ReturnType<typeof transport.request>> | null = null;
  for (let attempt = 1; attempt <= 3 && !index; attempt += 1) { try { index = await transport.request({ sourceCode: source, operation: 'SEARCH', url: 'https://eda.rambler.ru/sitemap_index.xml', parserVersion: parserVersion(source), allowlist: allowlist(source), pilotPolicy: policy }); } catch (error) { if (attempt === 3) throw error; await sleep(500 * attempt); } }
  if (!index) return [];
  const direct = extractEdaSitemapUrls(index.bodyText, limit);
  if (direct.length) return direct;
  const children = extractEdaSitemapChildUrls(index.bodyText, 10).filter((url) => /RecipePagesGroup/i.test(url)).slice(0, 2);
  const out: string[] = [];
  for (const child of children) {
    try {
      const sitemap = await transport.request({ sourceCode: source, operation: 'SEARCH', url: child, parserVersion: parserVersion(source), allowlist: allowlist(source), pilotPolicy: policy });
      for (const url of extractEdaSitemapUrls(sitemap.bodyText, limit)) if (!out.includes(url)) out.push(url);
      if (out.length >= limit) break;
    } catch { /* donor-local failure; retain candidates from other child maps */ }
  }
  return out.slice(0, limit);
}

async function fetchCandidate(source: SourceCode, url: string, transport: ReturnType<typeof createControlledPilotTransport>): Promise<SourceRecipeCandidatePayload> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await transport.request({ sourceCode: source, operation: 'FETCH_CANDIDATE', url, parserVersion: parserVersion(source), allowlist: allowlist(source), pilotPolicy: policy });
      if (source === 'eda') return parseEdaHtml({ bodyText: r.bodyText, sourceUrl: r.finalUrl, statusCode: r.statusCode });
      if (source === '1000menu') return parse1000MenuHtml({ bodyText: r.bodyText, sourceUrl: r.finalUrl, statusCode: r.statusCode });
      if (source === 'iamcook') return parseIamCookHtml({ bodyText: r.bodyText, sourceUrl: r.finalUrl, statusCode: r.statusCode, retrievedAt: new Date().toISOString() });
      return parseRussianFoodHtml({ bodyText: r.bodyText, sourceUrl: r.finalUrl, statusCode: r.statusCode, retrievedAt: new Date().toISOString() });
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(500 * attempt);
    }
  }
  throw new Error('UNREACHABLE');
}

async function ensureSource(client: pg.Pool, source: SourceCode): Promise<string> {
  const name = source === 'eda' ? 'EDA/Rambler' : source === '1000menu' ? '1000.menu' : source === 'iamcook' ? 'IamCook' : 'RussianFood';
  const baseUrl = source === 'eda' ? 'https://eda.rambler.ru' : source === '1000menu' ? 'https://1000.menu' : source === 'iamcook' ? 'https://www.iamcook.ru' : 'https://www.russianfood.com';
  const adapter = source === 'eda' ? 'EDA' : source === '1000menu' ? 'MENU1000' : source === 'iamcook' ? 'IAMCOOK' : 'RUSSIANFOOD';
  const row = await client.query<{ id: string }>(`INSERT INTO "RecipeExternalSource" (code,name,"baseUrl","adapterType","rightsStatus","collectionMode","parserVersion","rateLimitPerMinute","concurrencyLimit","requestTimeoutMs",enabled,"healthStatus","dataClass","policyReason") VALUES ($1,$2,$3,$4,'PUBLIC_RESEARCH_ALLOWED','CONTROLLED_HTML_RESEARCH',$5,24,1,20000,true,'HEALTHY','TEST_ONLY','Controlled public research only; production scale pending separate approval') ON CONFLICT (code) DO UPDATE SET "adapterType"=EXCLUDED."adapterType", "rightsStatus"=EXCLUDED."rightsStatus", "collectionMode"=EXCLUDED."collectionMode", "parserVersion"=EXCLUDED."parserVersion", enabled=true RETURNING id`, [source, name, baseUrl, adapter, parserVersion(source)]);
  await client.query(`INSERT INTO "RecipeSourcePolicyEvidence" ("sourceId","evidenceType","referenceUrl",decision,notes,"reviewedAt") SELECT $1,'TERMS_REVIEW',$2,'ALLOW',$3,now() WHERE NOT EXISTS (SELECT 1 FROM "RecipeSourcePolicyEvidence" WHERE "sourceId"=$1 AND "evidenceType"='TERMS_REVIEW' AND decision='ALLOW')`, [row.rows[0]!.id, baseUrl, 'Controlled public research fact extraction allowed; direct source-text republication not approved; production scale pending.']);
  return row.rows[0]!.id;
}

async function persist(client: pg.Pool, source: SourceCode, sourceId: string, payload: SourceRecipeCandidatePayload, aliases: ProductAliasCandidate[]): Promise<{ candidateId: string; duplicate: boolean; mapping: ReturnType<typeof mapIngredients> }> {
  const request = await client.query<{ id: string }>(`INSERT INTO "RecipeResearchRequest" ("requestType",status,reason,"idempotencyKey","inputSnapshotJson") VALUES ('MANUAL_EDITORIAL_RESEARCH','READY','RECIPE_ACQ_01A bounded corpus acquisition',$1,$2) ON CONFLICT ("idempotencyKey") DO UPDATE SET "updatedAt"=now() RETURNING id`, [`recipe-acq-01a:${source}`, JSON.stringify({ source, mode: 'CONTROLLED_PUBLIC_RESEARCH' })]);
  const runKey = `recipe-acq-01a:${source}:${payload.externalId}:${payload.payloadChecksum ?? stableJsonChecksum(payload)}`;
  const adapter = source === 'eda' ? 'EDA' : source === '1000menu' ? 'MENU1000' : source === 'iamcook' ? 'IAMCOOK' : 'RUSSIANFOOD';
  const rawChecksum = payload.payloadChecksum ?? stableJsonChecksum(payload);
  const existing = await client.query<{ id: string; sourcePayloadChecksum: string | null }>(`SELECT id,"sourcePayloadChecksum" FROM "RecipeSourceCandidate" WHERE "sourceId"=$1 AND "externalId"=$2 AND "parserVersion"=$3 LIMIT 1`, [sourceId, payload.externalId, payload.parserVersion]);
  const mapping = mapIngredients(payload.ingredients, aliases);
  if (existing.rows[0] && existing.rows[0].sourcePayloadChecksum === rawChecksum) return { candidateId: existing.rows[0].id, duplicate: true, mapping };
  const run = await client.query<{ id: string }>(`INSERT INTO "RecipeResearchRun" ("requestId","sourceId",operation,status,"correlationId","idempotencyKey","adapterType","parserVersion","inputJson") VALUES ($1,$2,'FETCH_CANDIDATE','SUCCEEDED',$3,$4,$5,$6,$7) ON CONFLICT ("idempotencyKey") DO UPDATE SET "resultJson"="RecipeResearchRun"."resultJson" RETURNING id`, [request.rows[0]!.id, sourceId, runKey, runKey, adapter, payload.parserVersion, JSON.stringify({ sourceUrl: payload.sourceUrl })]);
  const snapshot = await client.query<{ id: string }>(`INSERT INTO "RecipeSourceRawSnapshot" ("runId","sourceId","externalId","sourceUrl","parserVersion","payloadChecksum","payloadBytes","inlinePayloadJson","retentionClass","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'LIMITED_RESEARCH',now()+interval '7 days') RETURNING id`, [run.rows[0]!.id, sourceId, payload.externalId, payload.sourceUrl, payload.parserVersion, rawChecksum, Buffer.byteLength(JSON.stringify(payload)), JSON.stringify(payload)]);
  const candidate = await client.query<{ id: string; rawSnapshotId: string }>(`INSERT INTO "RecipeSourceCandidate" ("requestId","runId","sourceId","rawSnapshotId","externalId","sourceUrl",title,status,"parserVersion","sourcePayloadChecksum") VALUES ($1,$2,$3,$4,$5,$6,$7,'RAW_CAPTURED',$8,$9) ON CONFLICT ((COALESCE("sourceId", '00000000-0000-0000-0000-000000000000'::uuid)),"externalId","parserVersion") DO UPDATE SET "lastSeenAt"=now(),"updatedAt"=now() RETURNING id,"rawSnapshotId"`, [request.rows[0]!.id, run.rows[0]!.id, sourceId, snapshot.rows[0]!.id, payload.externalId, payload.sourceUrl, payload.title, payload.parserVersion, rawChecksum]);
  const normalized = { title: payload.title, ingredients: mapping.mappings, steps: payload.steps, servings: payload.servings, provenance: { sourceCode: source, sourceRecipeId: payload.externalId, sourceUrl: payload.sourceUrl, fetchedAt: payload.fetchedAt, payloadChecksum: rawChecksum, parserVersion: payload.parserVersion } };
  await client.query(`INSERT INTO "RecipeNormalizedCandidate" ("candidateId",version,"normalizedJson","ingredientMappingsJson","reviewFlagsJson","completenessScore","sourcePayloadChecksum") VALUES ($1,1,$2,$3,$4,$5,$6) ON CONFLICT ("candidateId",version) DO NOTHING`, [candidate.rows[0]!.id, JSON.stringify(normalized), JSON.stringify(mapping.mappings), JSON.stringify(mapping.flags), payload.completeness === 'FULL' ? 1 : 0.5, rawChecksum]);
  await client.query(`UPDATE "RecipeSourceCandidate" SET status='NORMALIZED',"reviewStatus"=$2 WHERE id=$1`, [candidate.rows[0]!.id, mapping.flags.some((f) => f.severity === 'BLOCKER') ? 'NEEDS_MANUAL_REVIEW' : 'READY_FOR_REVIEW']);
  return { candidateId: candidate.rows[0]!.id, duplicate: false, mapping };
}

async function main() {
  if (mode === 'dry-run') { console.log(JSON.stringify({ taskId: 'RECIPE-ACQ-01A', mode, target, retry: 3, checkpoint: checkpointPath, persistence: 'disposable-only' }, null, 2)); return; }
  process.env.WEIGHT_APP_DISPOSABLE_MODE = '1';
  const env = await startRuntime();
  try {
    await migrate(env);
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    try {
    const catalogSeed = await runCatalogSeed({ client: pool, manifest: buildCatalogCoreV3Manifest(), mode: 'apply' });
    if (!['OK', 'NO_OP'].includes(catalogSeed.status)) throw new Error(`CATALOG_SEED_FAILED:${catalogSeed.status}`);
    const aliases = (await pool.query(`SELECT p.id AS "productId",p."canonicalName",p.name,COALESCE(a.alias,p."canonicalName") AS alias,COALESCE(a."normalizedAlias",a.alias,p."canonicalName") AS "normalizedAlias",COALESCE(a.confidence,1.0)::float AS confidence FROM "Product" p LEFT JOIN "ProductAlias" a ON a."productId"=p.id AND a.status='ACTIVE' WHERE p.status='ACTIVE' LIMIT 5000`)).rows as ProductAliasCandidate[];
    const checkpoint = loadCheckpoint(); const transport = createControlledPilotTransport(policy, undefined, { mode: (process.env.RECIPE_DONOR_EGRESS_MODE as 'NORMAL' | 'DIRECT_PHYSICAL' | 'AUTO' | undefined) ?? 'NORMAL', directLocalAddress: process.env.RECIPE_DONOR_DIRECT_LOCAL_ADDRESS, sourceModes: { eda: 'DIRECT_PHYSICAL', '1000menu': 'AUTO', iamcook: 'AUTO', russianfood: 'AUTO' } }); const summary: Record<string, unknown> = { taskId: 'RECIPE_ACQ_01C', mode, target, existingCheckpoint: checkpoint.items.length, egressMode: process.env.RECIPE_DONOR_EGRESS_MODE ?? 'NORMAL', directLocalAddressConfigured: Boolean(process.env.RECIPE_DONOR_DIRECT_LOCAL_ADDRESS), sources: {} };
    const sourcePlan: Array<[SourceCode, number]> = [['1000menu', Math.min(60, Math.max(8, Math.ceil(target * 0.5)))], ['eda', Math.min(30, Math.ceil(target * 0.15))], ['iamcook', Math.min(30, Math.max(4, Math.ceil(target * 0.25)))], ['russianfood', Math.min(30, Math.max(4, Math.ceil(target * 0.25)))]];
    for (const [source, sourceTarget] of sourcePlan) {
      const sourceId = await ensureSource(pool, source);
      let urls: string[] = [];
      let discoveryError: string | undefined;
      try { urls = await discover(source, sourceTarget, transport); } catch (error) { discoveryError = error instanceof Error ? error.message : String(error); }
      const items = urls.map((url, i) => checkpoint.items.find((x) => x.source === source && x.url === url) ?? { source, url, externalId: externalId(source, url, i), status: 'QUEUED', attempts: 0 });
      let persisted = 0; let duplicates = 0; let failed = 0; let mapped = 0; let ingredientLines = 0;
      if (mode === 'corpus-pilot') for (const item of items) { if (persisted >= sourceTarget) break; if (item.status === 'PERSISTED') { duplicates += 1; continue; } try { item.attempts += 1; const payload = await fetchCandidate(source, item.url, transport); const result = await persist(pool, source, sourceId, payload, aliases); item.status = 'PERSISTED'; item.checksum = payload.payloadChecksum; item.candidateId = result.candidateId; if (result.duplicate) duplicates += 1; else persisted += 1; mapped += result.mapping.mappings.filter((m) => m.productId).length; ingredientLines += payload.ingredients.length; } catch (error) { item.status = 'NETWORK_RETRYABLE'; item.error = error instanceof Error ? error.message : String(error); failed += 1; } checkpoint.items.push(item); saveCheckpoint(checkpoint); await sleep(2500); }
      summary.sources[source] = { discovered: urls.length, persisted, duplicates, failed, mapped, ingredientLines, discoveryError: discoveryError ?? null };
    }
    console.log(JSON.stringify(summary, null, 2));
    } finally { await pool.end(); }
  } finally { await stopRuntime(env); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
