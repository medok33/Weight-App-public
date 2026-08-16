#!/usr/bin/env node
/* global fetch, AbortSignal, AbortController, URL, setTimeout, clearTimeout */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SOURCE = 'https://magnit.ru/catalog';
const FETCH_BASE = 'https://r.jina.ai/http://magnit.ru/catalog';
const cli = Object.fromEntries(process.argv.slice(2).flatMap((x, i, a) => x.startsWith('--') ? [[x.slice(2), a[i + 1] ?? true]] : []));
let selectedStore = cli.store ?? process.env.MAGNIT_STORE;
const selectedCity = cli.city ?? process.env.MAGNIT_CITY;
const selectedRegion = cli.region ?? process.env.MAGNIT_REGION;
const selectedAddress = cli.address ?? process.env.MAGNIT_ADDRESS ?? null;
const runId = cli['run-id'] ?? null;
const controlStore = cli['control-store'] ?? process.env.MAGNIT_CONTROL_STORE;

function parseCatalog(text, observedAt) {
  const re = /\]\((https?:\/\/magnit\.ru\/product\/[^)]+)\s+"([^"]+)"\)/g;
  const rows = [];
  let match;
  while ((match = re.exec(text)) && rows.length < 100) {
    const [, url, title] = match;
    const context = text.slice(Math.max(0, match.index - 500), match.index);
    // Some text-extraction responses mojibake the ruble sign as "в‚Ѕ".
    const prices = [...context.matchAll(/(\d+(?:\.\d+)?)\s*(?:\u20BD|в‚Ѕ)/g)].map((m) => Number(m[1]));
    if (!prices.length) continue;
    const price = prices.at(-2) ?? prices.at(-1);
    const regular = prices.length > 1 ? prices.at(-1) : undefined;
    const productId = url.match(/\/product\/(\d+)-/)?.[1];
    if (!productId) continue;
    rows.push({
      retailer: 'Magnit',
      store: { code: selectedStore, city: selectedCity, region: selectedRegion, address: selectedAddress },
      product: title.replace(/\s+/g, ' ').trim(),
      productId,
      regularPrice: Number(regular ?? price),
      promoPrice: regular ? Number(price) : null,
      currency: 'RUB',
      unit: title.match(/(?:\d+(?:[.,]\d+)?\s?(?:г|кг|мл|л|шт|Рі|РєРі|РјР»|Р»|С€С‚))/i)?.[0] ?? url.match(/\d+(?:[._]\d+)?(?:g|kg|ml|l|pcs)/i)?.[0] ?? 'package',
      sourceUrl: url,
      observedAt,
      method: 'public HTML via bounded text extraction proxy',
    });
  }
  return rows;
}

function createCatalogUrls(storeCode, nonce = Date.now()) {
  const shopCode = encodeURIComponent(storeCode);
  return {
    targetUrl: `${SOURCE}?shopCode=${shopCode}`,
    fetchUrl: `${FETCH_BASE}?shopCode=${shopCode}&nocache=${nonce}`,
  };
}

function extractProductShopCodes(text) {
  return [...text.matchAll(/https?:\/\/magnit\.ru\/product\/[^)\s]+[?&]shopCode=([^&")\s]+)/g)]
    .map((match) => decodeURIComponent(match[1]))
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function discoverMagnitStore(city, region) {
  const target = new URL('https://magnit.ru/shops');
  target.searchParams.set('city', city);
  target.searchParams.set('region', region);
  const response = await fetch(`https://r.jina.ai/http://magnit.ru/shops?city=${encodeURIComponent(city)}&region=${encodeURIComponent(region)}&nocache=${Date.now()}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: 'text/plain' },
  });
  if (!response.ok) throw new Error(`Magnit store discovery HTTP ${response.status}`);
  const text = await response.text();
  const matches = [...text.matchAll(/(?:shopCode|storeCode)[=:" ]+([A-Z0-9-]{3,})/gi)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
  if (matches.length !== 1) {
    throw new Error(`Magnit store discovery returned ${matches.length} unambiguous stores for ${city}; refusing to choose`);
  }
  return matches[0];
}

async function fetchCatalog(storeCode, controller) {
  const { targetUrl, fetchUrl } = createCatalogUrls(storeCode);
  const response = await fetch(fetchUrl, { signal: controller.signal, headers: { accept: 'text/plain' } });
  if (!response.ok) throw new Error(`source HTTP ${response.status} for shopCode=${storeCode}`);
  const text = await response.text();
  return { targetUrl, fetchUrl, text, productShopCodes: extractProductShopCodes(text) };
}

async function main() {
  if (!selectedCity || !selectedRegion || !controlStore) {
    throw new Error('--control-store, --city, and --region are required');
  }
  if (!selectedStore) {
    selectedStore = await discoverMagnitStore(selectedCity, selectedRegion);
  }
  if (controlStore === selectedStore) {
    throw new Error('--control-store must differ from --store');
  }
  if (runId !== null && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(runId)) {
    throw new Error('--run-id must contain only letters, digits, underscores, or hyphens');
  }
  const suffix = runId ? `-${runId}` : '';
  const out = `.data/research/price-02r-glm-live-prices${suffix}.json`;
  const raw = `.data/research/price-02r-glm-raw/magnit-catalog${suffix}.txt`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let selected;
  let control;
  try {
    selected = await fetchCatalog(selectedStore, controller);
    control = await fetchCatalog(controlStore, controller);
  }
  finally { clearTimeout(timer); }
  if (selected.productShopCodes.length !== 1 || selected.productShopCodes[0] !== selectedStore) {
    throw new Error(`selected catalog did not preserve its shopCode; observed=${selected.productShopCodes.join(',') || 'none'}`);
  }
  if (control.productShopCodes.length !== 1 || control.productShopCodes[0] !== controlStore) {
    throw new Error(`control catalog did not preserve its shopCode; observed=${control.productShopCodes.join(',') || 'none'}`);
  }
  if (selected.text === control.text) {
    throw new Error('selected and control catalog responses are identical; refusing a non-discriminating proxy result');
  }
  const { targetUrl, fetchUrl, text } = selected;
  const observedAt = new Date().toISOString();
  const rows = parseCatalog(text, observedAt);
  if (rows.length < 20) throw new Error(`verified prices ${rows.length} < 20`);
  await mkdir('.data/research/price-02r-glm-raw', { recursive: true });
  await mkdir('.data/research', { recursive: true });
  await writeFile(raw, text.replace(/set-cookie:[^\n]*/gi, 'set-cookie: [REDACTED]'));
  const payload = { schemaVersion: 1, retailer: 'Magnit', sourceUrl: targetUrl, fetchUrl, store: rows[0].store, observedAt, requestMs: Date.now() - started, rawSha256: createHash('sha256').update(text).digest('hex'), control: { storeCode: controlStore, sourceUrl: control.targetUrl, rawSha256: createHash('sha256').update(control.text).digest('hex') }, prices: rows };
  await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, count: rows.length, observedAt, rawSha256: payload.rawSha256, output: out, raw }));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/magnit-live-collector.mjs')) {
  main().catch((error) => { console.error(`collector failed: ${error.message}`); process.exitCode = 1; });
}

export { createCatalogUrls, discoverMagnitStore, extractProductShopCodes, parseCatalog };
