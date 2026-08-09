/** RP2-04A/STEP_215A — URL / network security contract (live sockets blocked unless transport allows). */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

const PRIVATE_IPV4 =
  /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|0\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const METADATA_IPV4 = new Set(['169.254.169.254', '169.254.170.2']);

/** Static hostname allowlists — no dynamic discovery. */
export const FOOD_RU_HOSTNAME_ALLOWLIST = ['food.ru'] as const;
export const IAMCOOK_HOSTNAME_ALLOWLIST = ['www.iamcook.ru', 'iamcook.ru'] as const;
export const RUSSIANFOOD_HOSTNAME_ALLOWLIST = ['www.russianfood.com', 'russianfood.com'] as const;

const FOOD_RU_RECIPE_PATH = /^\/recipes\/([a-z0-9][a-z0-9-]{1,120})$/i;
const FOOD_RU_SEARCH_PATH = /^\/search\/?$/i;
const IAMCOOK_RECIPE_PATH = /^\/recipe\/([a-z0-9][a-z0-9-]{1,120})\/?$/i;
const IAMCOOK_SEARCH_PATH = /^\/search\/?$/i;
const RUSSIANFOOD_RECIPE_PATH = /^\/recipes\/recipe\.php$/i;
const RUSSIANFOOD_SEARCH_PATH = /^\/recipes\/search\.php$/i;

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'yclid',
  'ysclid',
  'ref',
  'ref_src',
]);

export type NormalizedSourceBaseUrl = {
  href: string;
  origin: string;
  hostname: string;
  protocol: 'https:' | 'http:';
};

export type CanonicalFoodRuUrl = {
  href: string;
  hostname: string;
  pathname: string;
  externalId: string | null;
  kind: 'recipe' | 'search' | 'other';
};

export function normalizeAndValidateSourceBaseUrl(
  raw: string,
  opts?: { allowHttpForTest?: boolean },
): NormalizedSourceBaseUrl {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new Error('RECIPE_SOURCE_BASE_URL_REQUIRED');
  assertForbiddenUrlSchemes(trimmed);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('RECIPE_SOURCE_BASE_URL_INVALID');
  }

  if (url.username || url.password) {
    throw new Error('RECIPE_SOURCE_BASE_URL_CREDENTIALS_FORBIDDEN');
  }

  const protocol = url.protocol as 'https:' | 'http:';
  if (protocol !== 'https:' && !(opts?.allowHttpForTest && protocol === 'http:')) {
    throw new Error('RECIPE_SOURCE_BASE_URL_HTTPS_REQUIRED');
  }

  const hostname = url.hostname.toLowerCase();
  assertHostnameNotBlocked(hostname);

  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const href = `${url.protocol}//${url.host}${pathname}`;

  return {
    href,
    origin: url.origin,
    hostname,
    protocol,
  };
}

export function assertForbiddenUrlSchemes(raw: string): void {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return;
  if (
    value.startsWith('javascript:') ||
    value.startsWith('data:') ||
    value.startsWith('file:') ||
    value.startsWith('vbscript:') ||
    value.startsWith('//')
  ) {
    throw new Error('RECIPE_SOURCE_URL_SCHEME_FORBIDDEN');
  }
  if (/[\r\n]/.test(raw)) throw new Error('RECIPE_SOURCE_URL_CRLF_FORBIDDEN');
  if (/%2e%2e|%2f%2e%2e|\.\.%2f|\.\.\\/i.test(raw)) {
    throw new Error('RECIPE_SOURCE_URL_TRAVERSAL_FORBIDDEN');
  }
}

export function assertHostnameNotBlocked(hostname: string): void {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host.includes(' ') || host.startsWith('.')) {
    throw new Error('RECIPE_SOURCE_BASE_URL_HOST_INVALID');
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('RECIPE_SOURCE_BASE_URL_HOST_FORBIDDEN');
  }
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    throw new Error('RECIPE_SOURCE_BASE_URL_PRIVATE_FORBIDDEN');
  }
  if (PRIVATE_IPV4.test(host) || METADATA_IPV4.has(host)) {
    throw new Error('RECIPE_SOURCE_BASE_URL_PRIVATE_FORBIDDEN');
  }
  // IPv6 literal private/link-local/unique-local
  if (host.includes(':') && /^(?:fc|fd|fe80|::ffff:)/i.test(host)) {
    throw new Error('RECIPE_SOURCE_BASE_URL_PRIVATE_FORBIDDEN');
  }
  // IP literal rejection for Food.ru pilot (hostname must be DNS name in allowlist)
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    throw new Error('RECIPE_SOURCE_IP_LITERAL_FORBIDDEN');
  }
}

export function assertHostnameAllowlisted(hostname: string, allowlist: string[]): void {
  const host = String(hostname ?? '').toLowerCase();
  assertHostnameNotBlocked(host);
  const allowed = allowlist.map((h) => h.toLowerCase());
  if (!allowed.includes(host)) {
    throw new Error('RECIPE_SOURCE_DOMAIN_NOT_ALLOWLISTED');
  }
}

/**
 * Redirect policy contract: target hostname must stay on allowlist (same or re-validated).
 * No network I/O — validation only.
 */
export function assertRedirectHostnameAllowed(
  fromHostname: string,
  toHostname: string,
  allowlist: string[],
): void {
  assertHostnameAllowlisted(fromHostname, allowlist);
  const to = String(toHostname ?? '').toLowerCase();
  const allowed = allowlist.map((h) => h.toLowerCase());
  if (!allowed.includes(to)) {
    throw new Error('RECIPE_SOURCE_REDIRECT_OFF_DOMAIN');
  }
  assertHostnameAllowlisted(to, allowlist);
  if (fromHostname.toLowerCase() !== to) {
    throw new Error('RECIPE_SOURCE_REDIRECT_OFF_DOMAIN');
  }
}

export function canonicalizeFoodRuUrl(raw: string): CanonicalFoodRuUrl {
  assertForbiddenUrlSchemes(raw);
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('RECIPE_SOURCE_BASE_URL_INVALID');
  }
  if (url.protocol !== 'https:') throw new Error('RECIPE_SOURCE_BASE_URL_HTTPS_REQUIRED');
  if (url.username || url.password) throw new Error('RECIPE_SOURCE_BASE_URL_CREDENTIALS_FORBIDDEN');
  const hostname = url.hostname.toLowerCase();
  assertHostnameAllowlisted(hostname, [...FOOD_RU_HOSTNAME_ALLOWLIST]);

  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  pathname = pathname.toLowerCase();
  url.hash = '';
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const search = params.toString();
  url.pathname = pathname || '/';
  url.search = search ? `?${search}` : '';

  const recipe = pathname.match(FOOD_RU_RECIPE_PATH);
  if (recipe) {
    return {
      href: `https://food.ru${pathname}`,
      hostname,
      pathname,
      externalId: recipe[1]!.toLowerCase(),
      kind: 'recipe',
    };
  }
  if (FOOD_RU_SEARCH_PATH.test(pathname)) {
    return {
      href: search ? `https://food.ru/search?${search}` : 'https://food.ru/search',
      hostname,
      pathname: '/search',
      externalId: null,
      kind: 'search',
    };
  }
  throw new Error('RECIPE_SOURCE_URL_PATH_FORBIDDEN');
}

export function buildFoodRuRecipeUrl(externalId: string): string {
  const id = String(externalId ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(id)) throw new Error('RECIPE_SOURCE_EXTERNAL_ID_INVALID');
  return canonicalizeFoodRuUrl(`https://food.ru/recipes/${id}`).href;
}

export function buildFoodRuSearchUrl(query: string): string {
  const q = String(query ?? '').trim();
  if (!q || q.length > 120) throw new Error('RECIPE_SOURCE_SEARCH_QUERY_INVALID');
  if (/[\r\n]/.test(q) || /https?:|javascript:|data:/i.test(q)) {
    throw new Error('RECIPE_SOURCE_SEARCH_QUERY_INVALID');
  }
  return canonicalizeFoodRuUrl(`https://food.ru/search?q=${encodeURIComponent(q)}`).href;
}

export function extractFoodRuExternalId(rawUrl: string): string {
  const canonical = canonicalizeFoodRuUrl(rawUrl);
  if (!canonical.externalId) throw new Error('RECIPE_SOURCE_EXTERNAL_ID_INVALID');
  return canonical.externalId;
}

function assertHttpsAllowlistedUrl(raw: string, allowlist: readonly string[]): URL {
  assertForbiddenUrlSchemes(raw);
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('RECIPE_SOURCE_BASE_URL_INVALID');
  }
  if (url.protocol !== 'https:') throw new Error('RECIPE_SOURCE_BASE_URL_HTTPS_REQUIRED');
  if (url.username || url.password) throw new Error('RECIPE_SOURCE_BASE_URL_CREDENTIALS_FORBIDDEN');
  assertHostnameAllowlisted(url.hostname.toLowerCase(), [...allowlist]);
  return url;
}

export type CanonicalIamCookUrl = {
  href: string;
  hostname: string;
  pathname: string;
  externalId: string | null;
  kind: 'recipe' | 'search' | 'other';
};

export function canonicalizeIamCookUrl(raw: string): CanonicalIamCookUrl {
  const url = assertHttpsAllowlistedUrl(raw, IAMCOOK_HOSTNAME_ALLOWLIST);
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  pathname = pathname.toLowerCase();
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const search = params.toString();
  const recipe = pathname.match(IAMCOOK_RECIPE_PATH);
  if (recipe) {
    return {
      href: `https://www.iamcook.ru/recipe/${recipe[1]!.toLowerCase()}`,
      hostname: 'www.iamcook.ru',
      pathname: `/recipe/${recipe[1]!.toLowerCase()}`,
      externalId: recipe[1]!.toLowerCase(),
      kind: 'recipe',
    };
  }
  if (IAMCOOK_SEARCH_PATH.test(pathname)) {
    return {
      href: search ? `https://www.iamcook.ru/search?${search}` : 'https://www.iamcook.ru/search',
      hostname: 'www.iamcook.ru',
      pathname: '/search',
      externalId: null,
      kind: 'search',
    };
  }
  throw new Error('RECIPE_SOURCE_URL_PATH_FORBIDDEN');
}

export function buildIamCookRecipeUrl(externalId: string): string {
  const id = String(externalId ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(id)) throw new Error('RECIPE_SOURCE_EXTERNAL_ID_INVALID');
  return canonicalizeIamCookUrl(`https://www.iamcook.ru/recipe/${id}`).href;
}

export function buildIamCookSearchUrl(query: string): string {
  const q = String(query ?? '').trim();
  if (!q || q.length > 120) throw new Error('RECIPE_SOURCE_SEARCH_QUERY_INVALID');
  if (/[\r\n]/.test(q) || /https?:|javascript:|data:/i.test(q)) {
    throw new Error('RECIPE_SOURCE_SEARCH_QUERY_INVALID');
  }
  return canonicalizeIamCookUrl(`https://www.iamcook.ru/search?q=${encodeURIComponent(q)}`).href;
}

export function extractIamCookExternalId(rawUrl: string): string {
  const canonical = canonicalizeIamCookUrl(rawUrl);
  if (!canonical.externalId) throw new Error('RECIPE_SOURCE_EXTERNAL_ID_INVALID');
  return canonical.externalId;
}

export type CanonicalRussianFoodUrl = {
  href: string;
  hostname: string;
  pathname: string;
  externalId: string | null;
  kind: 'recipe' | 'search' | 'other';
};

export function canonicalizeRussianFoodUrl(raw: string): CanonicalRussianFoodUrl {
  const url = assertHttpsAllowlistedUrl(raw, RUSSIANFOOD_HOSTNAME_ALLOWLIST);
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  pathname = pathname.toLowerCase();
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const rid = params.get('rid') ?? params.get('id');
  if (RUSSIANFOOD_RECIPE_PATH.test(pathname) && rid && /^[a-z0-9][a-z0-9-]{0,120}$/i.test(rid)) {
    const externalId = rid.toLowerCase();
    return {
      href: `https://www.russianfood.com/recipes/recipe.php?rid=${externalId}`,
      hostname: 'www.russianfood.com',
      pathname: '/recipes/recipe.php',
      externalId,
      kind: 'recipe',
    };
  }
  if (RUSSIANFOOD_SEARCH_PATH.test(pathname)) {
    const search = params.toString();
    return {
      href: search
        ? `https://www.russianfood.com/recipes/search.php?${search}`
        : 'https://www.russianfood.com/recipes/search.php',
      hostname: 'www.russianfood.com',
      pathname: '/recipes/search.php',
      externalId: null,
      kind: 'search',
    };
  }
  throw new Error('RECIPE_SOURCE_URL_PATH_FORBIDDEN');
}

export function buildRussianFoodRecipeUrl(externalId: string): string {
  const id = String(externalId ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(id)) throw new Error('RECIPE_SOURCE_EXTERNAL_ID_INVALID');
  return canonicalizeRussianFoodUrl(`https://www.russianfood.com/recipes/recipe.php?rid=${id}`).href;
}

export function buildRussianFoodSearchUrl(query: string): string {
  const q = String(query ?? '').trim();
  if (!q || q.length > 120) throw new Error('RECIPE_SOURCE_SEARCH_QUERY_INVALID');
  if (/[\r\n]/.test(q) || /https?:|javascript:|data:/i.test(q)) {
    throw new Error('RECIPE_SOURCE_SEARCH_QUERY_INVALID');
  }
  return canonicalizeRussianFoodUrl(
    `https://www.russianfood.com/recipes/search.php?q=${encodeURIComponent(q)}`,
  ).href;
}

export function extractRussianFoodExternalId(rawUrl: string): string {
  const canonical = canonicalizeRussianFoodUrl(rawUrl);
  if (!canonical.externalId) throw new Error('RECIPE_SOURCE_EXTERNAL_ID_INVALID');
  return canonical.externalId;
}

export type RecipeSourceNetworkSecurityContract = {
  httpsRequired: true;
  credentialsInUrlForbidden: true;
  privateIpForbidden: true;
  localhostForbidden: true;
  cloudMetadataForbidden: true;
  arbitraryUrlFetchForbidden: true;
  redirectMustRevalidateAllowlist: true;
  redirectOffDomainForbidden: true;
  ipLiteralForbidden: true;
  responseSizeLimitBytes: number;
  mimeAllowlist: readonly string[];
  decompressionLimitBytes: number;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
  maxRedirects: number;
  maxConcurrency: number;
  maxRetries: number;
  noBrowserCookieReuse: true;
  noUserSuppliedHeaders: true;
  noCredentials: true;
  noAuthorizationForwarding: true;
  noRawBodyInLogs: true;
  dnsRebindingPolicy: 'RESOLVE_AND_RECHECK_ALLOWLIST';
  safeUserAgent: string;
};

export const RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT: RecipeSourceNetworkSecurityContract = {
  httpsRequired: true,
  credentialsInUrlForbidden: true,
  privateIpForbidden: true,
  localhostForbidden: true,
  cloudMetadataForbidden: true,
  arbitraryUrlFetchForbidden: true,
  redirectMustRevalidateAllowlist: true,
  redirectOffDomainForbidden: true,
  ipLiteralForbidden: true,
  responseSizeLimitBytes: 2_000_000,
  mimeAllowlist: ['text/html', 'application/json', 'application/xml', 'text/xml', 'application/ld+json'],
  decompressionLimitBytes: 5_000_000,
  connectTimeoutMs: 3_000,
  totalTimeoutMs: 8_000,
  maxRedirects: 3,
  maxConcurrency: 1,
  maxRetries: 1,
  noBrowserCookieReuse: true,
  noUserSuppliedHeaders: true,
  noCredentials: true,
  noAuthorizationForwarding: true,
  noRawBodyInLogs: true,
  dnsRebindingPolicy: 'RESOLVE_AND_RECHECK_ALLOWLIST',
  safeUserAgent: 'WeightAppRecipeResearchBot/1.0 (+internal-research; live-disabled)',
};

export function assertContentTypeAllowed(contentType: string | null | undefined): void {
  const raw = String(contentType ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (!raw || !RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT.mimeAllowlist.includes(raw)) {
    throw new Error('RECIPE_SOURCE_UNSUPPORTED_CONTENT_TYPE');
  }
}

export function assertResponseSizeAllowed(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error('RECIPE_SOURCE_RESPONSE_SIZE_INVALID');
  }
  if (byteLength > RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT.responseSizeLimitBytes) {
    throw new Error('RECIPE_SOURCE_RESPONSE_TOO_LARGE');
  }
}
