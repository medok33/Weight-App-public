import pg from 'pg';
import { startRuntime, migrate, stopRuntime } from '../../../scripts/verify/disposable-runtime.mjs';
import { buildCatalogCoreV3Manifest } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';
import { runCatalogSeed } from '../src/modules/product-catalog/seed/apply-engine.ts';
import { mapIngredients, type ProductAliasCandidate } from '../src/modules/recipe-platform/domain/recipe-research.policy.ts';
import { createControlledPilotTransport } from '../src/modules/recipe-platform/application/recipe-source-http.transport.ts';
import { buildIamCookListingUrl, IAMCOOK_HOSTNAME_ALLOWLIST, RUSSIANFOOD_HOSTNAME_ALLOWLIST } from '../src/modules/recipe-platform/domain/recipe-source-network.policy.ts';
import { extractIamCookListingUrls, parseIamCookHtml } from '../src/modules/recipe-platform/application/iamcook/iamcook.parser.ts';
import { extractRussianFoodDetailLinks, parseRussianFoodHtml } from '../src/modules/recipe-platform/application/russianfood/russianfood.parser.ts';

const policy = { sourceId: 'step339c2-iamcook', allowControlledPilot: true, maxTotalRequests: 6, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: 20_000, maxRedirects: 3 } as const;

async function main() {
  process.env.WEIGHT_APP_DISPOSABLE_MODE = '1';
  const env = await startRuntime();
  let client: pg.Pool | undefined;
  try {
    await migrate(env);
    client = new pg.Pool({ connectionString: env.DATABASE_URL });
    const seed = await runCatalogSeed({ client, manifest: buildCatalogCoreV3Manifest(), mode: 'apply' });
    const counts = async (table: string) => (await client!.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n as number;
    const aliases = (await client.query(`SELECT p.id AS "productId", p."canonicalName", p.name, COALESCE(pa.alias, p."canonicalName") AS alias, COALESCE(pa."normalizedAlias", pa.alias, p."canonicalName") AS "normalizedAlias", COALESCE(pa.confidence, 1.0)::float AS confidence FROM "Product" p LEFT JOIN "ProductAlias" pa ON pa."productId"=p.id AND pa.status='ACTIVE' WHERE p.status='ACTIVE' ORDER BY alias LIMIT 5000`)).rows as ProductAliasCandidate[];

    const transport = createControlledPilotTransport(policy);
    const listing = { sourceCode: 'iamcook', operation: 'SEARCH' as const, url: buildIamCookListingUrl(), parserVersion: 'iamcook/v1', allowlist: IAMCOOK_HOSTNAME_ALLOWLIST, pilotPolicy: policy };
    const response = await transport.request(listing);
    const detailUrls = extractIamCookListingUrls(response.bodyText, 2);
    const candidates = [] as ReturnType<typeof parseIamCookHtml>[];
    for (const url of detailUrls) {
      const detail = await transport.request({ ...listing, operation: 'FETCH_CANDIDATE', url });
      candidates.push(parseIamCookHtml({ bodyText: detail.bodyText, sourceUrl: detail.finalUrl, statusCode: detail.statusCode }));
    }
    const mapping = candidates.map((candidate) => {
      const result = mapIngredients(candidate.ingredients, aliases);
      return { sourceUrl: candidate.sourceUrl, title: candidate.title, ingredientCount: candidate.ingredients.length, mappedCount: result.mappings.filter((m) => m.productId).length, unknownCount: result.mappings.filter((m) => !m.productId).length, blockerFlags: result.flags.filter((f) => f.severity === 'BLOCKER').length };
    });
    const rfListing = { sourceCode: 'russianfood', operation: 'FETCH_CANDIDATE' as const, url: 'https://www.russianfood.com/recipes/recipe.php?rid=63199', parserVersion: 'russianfood/v1', allowlist: RUSSIANFOOD_HOSTNAME_ALLOWLIST, pilotPolicy: policy };
    const rfSeed = await transport.request(rfListing);
    const rfLinks = extractRussianFoodDetailLinks(rfSeed.bodyText, rfListing.url, 10).slice(0, 2);
    const rfCandidates = [] as ReturnType<typeof parseRussianFoodHtml>[];
    for (const url of rfLinks) {
      const detail = await transport.request({ ...rfListing, url });
      rfCandidates.push(parseRussianFoodHtml({ bodyText: detail.bodyText, sourceUrl: detail.finalUrl, statusCode: detail.statusCode }));
    }
    const rfMapping = rfCandidates.map((candidate) => {
      const result = mapIngredients(candidate.ingredients, aliases);
      return { sourceUrl: candidate.sourceUrl, title: candidate.title, ingredientCount: candidate.ingredients.length, mappedCount: result.mappings.filter((m) => m.productId).length, unknownCount: result.mappings.filter((m) => !m.productId).length, blockerFlags: result.flags.filter((f) => f.severity === 'BLOCKER').length };
    });
    const out = { migration: { applied: env.migrationResult?.applied ?? null }, seed: { status: seed.status, productCount: seed.productCount, inserted: seed.inserted, updated: seed.updated }, counts: { products: await counts('Product'), aliases: await counts('ProductAlias'), nutrition: await counts('ProductNutritionVersion') }, iamCook: { listingStatus: response.statusCode, detailCandidates: candidates.length, mapping }, russianFood: { seedStatus: rfSeed.statusCode, detailLinksFound: extractRussianFoodDetailLinks(rfSeed.bodyText, rfListing.url, 10).length, detailCandidates: rfCandidates.length, mapping: rfMapping }, mappingGate: mapping.every((m) => m.mappedCount > 0) ? 'PASS' : 'FAIL_ZERO_MAPPED_PRODUCTS' };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client?.end().catch(() => undefined);
    await stopRuntime(env);
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
