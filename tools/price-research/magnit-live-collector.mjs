#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SOURCE = 'https://magnit.ru/catalog';
const FETCH_BASE = `https://r.jina.ai/http://magnit.ru/catalog?nocache=`;
const OUT = '.data/research/price-02r-glm-live-prices.json';
const RAW = '.data/research/price-02r-glm-raw/magnit-catalog.txt';

function parseCatalog(text, observedAt) {
  const re = /\]\((https?:\/\/magnit\.ru\/product\/[^)]+)\s+"([^"]+)"\)/g;
  const rows = [];
  let match;
  while ((match = re.exec(text)) && rows.length < 100) {
    const [, url, title] = match;
    const context = text.slice(Math.max(0, match.index - 500), match.index);
    const prices = [...context.matchAll(/(\d+(?:\.\d+)?)\s*₽/g)].map((m) => Number(m[1]));
    if (!prices.length) continue;
    const price = prices.at(-2) ?? prices.at(-1);
    const regular = prices.length > 1 ? prices.at(-1) : undefined;
    const productId = url.match(/\/product\/(\d+)-/)?.[1];
    if (!productId) continue;
    rows.push({
      retailer: 'Magnit',
      store: { code: '992301', city: 'Краснодар', region: 'Краснодарский край', address: 'ул. им. Дзержинского, дом № 42' },
      product: title.replace(/\s+/g, ' ').trim(),
      productId,
      regularPrice: Number(regular ?? price),
      promoPrice: regular ? Number(price) : null,
      currency: 'RUB',
      unit: title.match(/(?:\d+(?:[.,]\d+)?\s?(?:г|кг|мл|л|шт))/i)?.[0] ?? url.match(/\d+(?:[._]\d+)?(?:g|kg|ml|l|pcs)/i)?.[0] ?? 'package',
      sourceUrl: url,
      observedAt,
      method: 'public HTML via bounded text extraction proxy',
    });
  }
  return rows;
}

async function main() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let response;
  const fetchUrl = `${FETCH_BASE}${Date.now()}`;
  try { response = await fetch(fetchUrl, { signal: controller.signal, headers: { accept: 'text/plain' } }); }
  finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`source HTTP ${response.status}`);
  const text = await response.text();
  const observedAt = new Date().toISOString();
  const rows = parseCatalog(text, observedAt);
  if (rows.length < 20) throw new Error(`verified prices ${rows.length} < 20`);
  await mkdir('.data/research/price-02r-glm-raw', { recursive: true });
  await mkdir('.data/research', { recursive: true });
  await writeFile(RAW, text.replace(/set-cookie:[^\n]*/gi, 'set-cookie: [REDACTED]'));
  const payload = { schemaVersion: 1, retailer: 'Magnit', sourceUrl: SOURCE, fetchUrl, store: rows[0].store, observedAt, requestMs: Date.now() - started, rawSha256: createHash('sha256').update(text).digest('hex'), prices: rows };
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, count: rows.length, observedAt, rawSha256: payload.rawSha256, output: OUT, raw: RAW }));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/magnit-live-collector.mjs')) {
  main().catch((error) => { console.error(`collector failed: ${error.message}`); process.exitCode = 1; });
}

export { parseCatalog };
