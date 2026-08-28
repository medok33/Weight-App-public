import { randomUUID } from 'node:crypto';
import type { RecipeSourceAdapter, RecipeSourceAdapterDescriptor, RecipeSourceExecutionContext, RecipeSourceSearchInput, SourceAdapterHealthResult, SourceAvailabilityResult, SourceRecipeCandidatePayload, SourceRecipeCard } from '../../domain/recipe-source-adapter.contract';
import { assertSearchInput, RecipeSourceAdapterError } from '../../domain/recipe-source-adapter.contract';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../../domain/recipe-external-source.policy';
import { EDA_HOSTNAME_ALLOWLIST, MENU1000_HOSTNAME_ALLOWLIST, canonicalize1000MenuUrl, canonicalizeEdaUrl } from '../../domain/recipe-source-network.policy';
import { createLiveDisabledTransport, RecipeSourceHttpTransport } from '../recipe-source-http.transport';
import { parseEdaHtml, EDA_PARSER_VERSION, EDA_SOURCE_CODE, extractEdaSitemapUrls, extractEdaSitemapChildUrls } from '../eda/eda.parser';
import { extract1000MenuListingUrls, parse1000MenuHtml, MENU1000_PARSER_VERSION, MENU1000_SOURCE_CODE } from '../menu1000/menu1000.parser';

type Donor = 'eda' | '1000menu';

export class PublicDonorSourceAdapter implements RecipeSourceAdapter {
  readonly contractVersion = RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION;
  readonly adapterType: string;
  readonly parserVersion: string;
  readonly descriptor: RecipeSourceAdapterDescriptor;
  private readonly knownUrls = new Map<string, string>();
  constructor(private readonly donor: Donor, private readonly liveTransport: RecipeSourceHttpTransport = createLiveDisabledTransport()) {
    this.adapterType = donor === 'eda' ? 'EDA' : 'MENU1000';
    this.parserVersion = donor === 'eda' ? EDA_PARSER_VERSION : MENU1000_PARSER_VERSION;
    this.descriptor = { adapterType: this.adapterType, contractVersion: this.contractVersion, parserVersion: this.parserVersion, supportedOperations: ['searchByProducts', 'fetchCandidate', 'checkAvailability', 'healthCheck'], collectionModes: ['CONTROLLED_HTML_RESEARCH', 'MANUAL_REFERENCE_ONLY'], supportedLocales: ['ru'], supportedSourceCodes: [donor === 'eda' ? EDA_SOURCE_CODE : MENU1000_SOURCE_CODE] };
  }
  async searchByProducts(input: RecipeSourceSearchInput, context: RecipeSourceExecutionContext): Promise<SourceRecipeCard[]> {
    this.assertContext(context); assertSearchInput(input);
    const policy = this.policy(context); const url = this.donor === 'eda' ? 'https://eda.rambler.ru/sitemap_index.xml' : 'https://1000.menu/catalog/klassicheskie-recepty-blud';
    const response = await this.liveTransport.request({ sourceCode: this.sourceCode, operation: 'SEARCH', url, correlationId: context.correlationId, allowlist: this.allowlist, parserVersion: this.parserVersion, pilotPolicy: policy });
    let urls: string[];
    if (this.donor === 'eda') {
      const direct = extractEdaSitemapUrls(response.bodyText, input.resultLimit);
      const children = extractEdaSitemapChildUrls(response.bodyText, 1);
      if (direct.length || !children.length) urls = direct;
      else { const child = await this.liveTransport.request({ sourceCode: this.sourceCode, operation: 'SEARCH', url: children[0]!, correlationId: context.correlationId, allowlist: this.allowlist, parserVersion: this.parserVersion, pilotPolicy: policy }); urls = extractEdaSitemapUrls(child.bodyText, input.resultLimit); }
    } else urls = extract1000MenuListingUrls(response.bodyText, input.resultLimit);
    return urls.map((sourceUrl, index) => { const externalId = this.externalId(sourceUrl, index); this.knownUrls.set(externalId, sourceUrl); return { sourceCode: this.sourceCode, externalId, sourceUrl, title: externalId, shortDescription: null, imageReference: null, estimatedTimeMinutes: null, servings: null, visibleIngredientNames: [], sourceCategories: [], availability: 'AVAILABLE' as const, fetchedAt: new Date().toISOString(), parserVersion: this.parserVersion, confidence: 0.8, rawReferenceHash: null }; });
  }
  async fetchCandidate(externalId: string, context: RecipeSourceExecutionContext): Promise<SourceRecipeCandidatePayload> {
    this.assertContext(context); const url = this.knownUrls.get(externalId) ?? this.fallbackUrl(externalId);
    const response = await this.liveTransport.request({ sourceCode: this.sourceCode, operation: 'FETCH_CANDIDATE', url, correlationId: context.correlationId, allowlist: this.allowlist, parserVersion: this.parserVersion, pilotPolicy: this.policy(context) });
    return this.donor === 'eda' ? parseEdaHtml({ bodyText: response.bodyText, sourceUrl: response.finalUrl, statusCode: response.statusCode }) : parse1000MenuHtml({ bodyText: response.bodyText, sourceUrl: response.finalUrl, statusCode: response.statusCode });
  }
  async checkAvailability(externalId: string, context: RecipeSourceExecutionContext): Promise<SourceAvailabilityResult> { try { const c = await this.fetchCandidate(externalId, context); return { sourceCode: this.sourceCode, externalId, available: Boolean(c.title), availabilityStatus: 'AVAILABLE', reason: null, checkedAt: new Date().toISOString(), parserVersion: this.parserVersion, correlationId: context.correlationId, networkCalls: 1 }; } catch (error) { return { sourceCode: this.sourceCode, externalId, available: false, availabilityStatus: 'UNKNOWN', reason: error instanceof Error ? error.message : 'UNKNOWN', checkedAt: new Date().toISOString(), parserVersion: this.parserVersion, correlationId: context.correlationId, networkCalls: 1 }; } }
  async healthCheck(context: RecipeSourceExecutionContext): Promise<SourceAdapterHealthResult> { return { adapterType: this.adapterType, contractVersion: this.contractVersion, parserVersion: this.parserVersion, ok: context.testMode, status: context.testMode ? 'HEALTHY' : 'CONFIGURATION_ERROR', details: context.testMode ? 'Deterministic parser health only' : 'Live execution requires controlled pilot transport', checkedAt: new Date().toISOString() }; }
  private get sourceCode() { return this.donor === 'eda' ? EDA_SOURCE_CODE : MENU1000_SOURCE_CODE; }
  private get allowlist() { return this.donor === 'eda' ? EDA_HOSTNAME_ALLOWLIST : MENU1000_HOSTNAME_ALLOWLIST; }
  private policy(context: RecipeSourceExecutionContext) { return context.collectionMode === 'CONTROLLED_PILOT' ? { sourceId: context.sourceId, allowControlledPilot: true, maxTotalRequests: 80, maxConcurrentRequests: 1, perHostMinIntervalMs: 2500, requestTimeoutMs: Math.min(context.requestTimeoutMs, 20000), maxRedirects: 3 } : undefined; }
  private externalId(url: string, index: number) { return this.donor === 'eda' ? url.match(/-(\d+)(?:\/?$)/)?.[1] ?? `url-${index}` : url.match(/\/cooking\/(\d+)/i)?.[1] ?? `url-${index}`; }
  private fallbackUrl(id: string) { return this.donor === 'eda' ? canonicalizeEdaUrl(`https://eda.rambler.ru/recepty/recipe-${id}`) : canonicalize1000MenuUrl(`https://1000.menu/cooking/${id}-recipe`); }
  private assertContext(context: RecipeSourceExecutionContext) {
    if (context.sourceCode !== this.sourceCode) throw new RecipeSourceAdapterError({ code: 'CONFIGURATION_ERROR', sourceCode: this.sourceCode, operation: 'context', retryable: false, safeMessage: 'Source context does not match adapter', correlationId: context.correlationId ?? randomUUID(), parserVersion: this.parserVersion });
    if (context.testMode) throw new RecipeSourceAdapterError({ code: 'UNSUPPORTED_OPERATION', sourceCode: this.sourceCode, operation: 'live', retryable: false, safeMessage: 'Use deterministic fixture adapter in test mode', correlationId: context.correlationId ?? randomUUID(), parserVersion: this.parserVersion });
  }
}

export class EdaSourceAdapter extends PublicDonorSourceAdapter { constructor(transport?: RecipeSourceHttpTransport) { super('eda', transport); } }
export class Menu1000SourceAdapter extends PublicDonorSourceAdapter { constructor(transport?: RecipeSourceHttpTransport) { super('1000menu', transport); } }
