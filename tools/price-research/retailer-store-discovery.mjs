#!/usr/bin/env node
// Read-only, bounded store discovery. It never invents store identities.
const sources = {
  magnit: 'https://r.jina.ai/http://magnit.ru/shops',
  pyaterochka: 'https://r.jina.ai/http://5ka.ru',
  yarche: 'https://r.jina.ai/http://yarcheplus.ru',
};
const args = Object.fromEntries(process.argv.slice(2).flatMap((x, i, a) => x.startsWith('--') ? [[x.slice(2), a[i + 1] ?? true]] : []));
const retailer = args.retailer;
if (!retailer || !sources[retailer]) throw new Error('--retailer must be magnit, pyaterochka, or yarche');
const url = `${sources[retailer]}?price02r=${Date.now()}`;
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'text/plain' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const stores = [...body.matchAll(/(?:shopCode|storeCode|storeId|SAP|магазин)[=:" ]+([A-Z0-9-]{3,})/gi)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  if (!stores.length) throw new Error('no store identity in response');
  console.log(JSON.stringify({ retailer, discoveryUrl: url, discoveredAt: new Date().toISOString(), stores }));
} catch (error) {
  console.error(`store discovery failed closed: ${error.message}`);
  process.exitCode = 1;
}
