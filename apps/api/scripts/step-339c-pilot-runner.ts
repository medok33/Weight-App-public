import { buildIamCookListingUrl, buildRussianFoodListingUrl, IAMCOOK_HOSTNAME_ALLOWLIST, RUSSIANFOOD_HOSTNAME_ALLOWLIST } from '../src/modules/recipe-platform/domain/recipe-source-network.policy.ts';
import { createControlledPilotTransport } from '../src/modules/recipe-platform/application/recipe-source-http.transport.ts';
import { parseIamCookHtml, extractIamCookListingUrls } from '../src/modules/recipe-platform/application/iamcook/iamcook.parser.ts';
import { parseRussianFoodHtml, extractRussianFoodListingUrls } from '../src/modules/recipe-platform/application/russianfood/russianfood.parser.ts';
import { startRuntime, migrate, stopRuntime } from '../../../scripts/verify/disposable-runtime.mjs';

const mode = process.argv.includes('--dry-run') ? 'dry-run' : process.argv.includes('--live-pilot') ? 'live-pilot' : 'source-smoke';
const sourcePolicy = (sourceId: string) => ({ sourceId, allowControlledPilot: true, maxTotalRequests: 6, maxConcurrentRequests: 2, perHostMinIntervalMs: 2500, requestTimeoutMs: 20_000, maxRedirects: 3 });
const report: Record<string, unknown> = {
  taskId: 'STEP-339C-LIVE-SOURCE-ADAPTERS-AND-PILOT-RUNNER',
  mode,
  controlledPilot: true,
  liveAiCalls: 0,
  recipeEditorCalls: 0,
  culinaryCriticCalls: 0,
  stagingWrites: 0,
  productionWrites: 0,
  sources: {},
};

async function smokeSource(sourceCode: 'iamcook' | 'russianfood') {
  const policy = sourcePolicy(`step339c-${sourceCode}`);
  const transport = createControlledPilotTransport(policy);
  const isIam = sourceCode === 'iamcook';
  const listingUrl = isIam ? buildIamCookListingUrl() : buildRussianFoodListingUrl();
  const allowlist = isIam ? IAMCOOK_HOSTNAME_ALLOWLIST : RUSSIANFOOD_HOSTNAME_ALLOWLIST;
  const listing = { sourceCode, operation: 'SEARCH' as const, url: listingUrl, parserVersion: `${sourceCode}/v1`, allowlist, pilotPolicy: policy };
  const result: Record<string, unknown> = { listingUrl, liveHttpCalls: 0, detailCandidates: 0, status: null, contentType: null, bytes: 0, ingredients: 0, steps: 0, unmappedIngredients: 0, error: null };
  try {
    const response = await transport.request(listing);
    result.liveHttpCalls = response.networkCalls;
    result.status = response.statusCode;
    result.contentType = response.contentType;
    result.bytes = Buffer.byteLength(response.bodyText, 'utf8');
    result.hrefCount = (response.bodyText.match(/href\s*=\s*["'][^"']+["']/gi) ?? []).length;
    result.recipeHrefMatches = (response.bodyText.match(/\/recipe(?:\.php|\/)/gi) ?? []).length;
    result.recipeLikeHrefCounts = { dish: (response.bodyText.match(/href\s*=\s*["'][^"']*\/dish\//gi) ?? []).length, food: (response.bodyText.match(/href\s*=\s*["'][^"']*\/food\//gi) ?? []).length, userRecipes: (response.bodyText.match(/href\s*=\s*["'][^"']*\/user\/[^"']+\/recipes/gi) ?? []).length };
    result.recipeWordMatches = (response.bodyText.match(/recipe|рецепт/gi) ?? []).length;
    result.recipeMatchSamples = [...response.bodyText.matchAll(/.{0,80}\/recipe(?:\.php|\/).{0,120}/gi)].slice(0, 3).map((m) => m[0]);
    result.hrefPathSamples = [...response.bodyText.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].slice(0, 20).map((m) => m[1]);
    const urls = isIam ? extractIamCookListingUrls(response.bodyText, 2) : extractRussianFoodListingUrls(response.bodyText, 2);
    for (const url of urls.slice(0, 2)) {
      const detail = await transport.request({ ...listing, operation: 'FETCH_CANDIDATE', url });
      result.liveHttpCalls = Number(result.liveHttpCalls) + detail.networkCalls;
      const candidate = isIam
        ? parseIamCookHtml({ bodyText: detail.bodyText, sourceUrl: detail.finalUrl, statusCode: detail.statusCode })
        : parseRussianFoodHtml({ bodyText: detail.bodyText, sourceUrl: detail.finalUrl, statusCode: detail.statusCode });
      result.detailCandidates = Number(result.detailCandidates) + 1;
      result.ingredients = Number(result.ingredients) + candidate.ingredients.length;
      result.steps = Number(result.steps) + candidate.steps.length;
      result.unmappedIngredients = Number(result.unmappedIngredients) + candidate.ingredients.length;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  report.sources[sourceCode] = result;
}

async function main() {
  if (mode === 'dry-run') {
    report.dryRunHttpCalls = 0;
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (mode === 'live-pilot') {
    if (!process.env.OPENAI_API_KEY) throw new Error('STEP339C_PREFLIGHT_OPENAI_API_KEY_MISSING');
    process.env.WEIGHT_APP_DISPOSABLE_MODE = '1';
    const env = await startRuntime();
    try {
      await migrate(env);
      report.disposableDbProvisioning = 'PASS';
      await smokeSource('iamcook');
      await smokeSource('russianfood');
      report.aiBoundary = 'READY_STOPPED_BEFORE_AI';
    } finally {
      stopRuntime(env);
    }
  } else {
    await smokeSource('iamcook');
    await smokeSource('russianfood');
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
