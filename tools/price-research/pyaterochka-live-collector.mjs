#!/usr/bin/env node
// Read-only public flow: geocode -> nearest store/SAP -> catalog search.
// No cookies, session headers, credentials, purchases, or anti-bot bypasses.
const args = Object.fromEntries(process.argv.slice(2).flatMap((x, i, a) => x.startsWith('--') ? [[x.slice(2), a[i + 1]]] : []));
const city = args.city ?? '\u041c\u043e\u0441\u043a\u0432\u0430';
const street = args.street ?? '\u043f\u0440\u043e\u0441\u043f\u0435\u043a\u0442 \u041c\u0438\u0440\u0430';
const house = args.house ?? '1';
const query = args.query ?? '\u043c\u043e\u043b\u043e\u043a\u043e';
const timeout = AbortSignal.timeout(20_000);

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { signal: timeout, headers: { accept: 'application/json' } });
  } catch (error) {
    throw new Error(`${new URL(url).hostname}: transport ${error.cause?.code ?? error.cause?.message ?? error.message}`);
  }
  if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const geocode = encodeURIComponent(`\u0420\u043e\u0441\u0441\u0438\u044f, ${city}, ${street}, ${house}`);
  const geo = await getJson(`https://5ka.ru/api/maps/geocode/?geocode=${geocode}`);
  const lon = geo?.longitude ?? geo?.coordinates?.longitude ?? geo?.data?.longitude;
  const lat = geo?.latitude ?? geo?.coordinates?.latitude ?? geo?.data?.latitude;
  if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) throw new Error('geocode returned no coordinates');
  const store = await getJson(`https://5d.5ka.ru/api/orders/v1/orders/stores/?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`);
  const sap = store?.sap_code ?? store?.sapCode ?? store?.store?.sap_code ?? store?.data?.sap_code;
  if (!sap) throw new Error('nearest-store response returned no SAP/store identity');
  const url = `https://5d.5ka.ru/api/catalog/v3/stores/${encodeURIComponent(sap)}/search?mode=store&include_restrict=true&q=${encodeURIComponent(query)}&limit=12`;
  const catalog = await getJson(url);
  const items = catalog?.products ?? catalog?.items ?? catalog?.data?.products ?? [];
  if (!Array.isArray(items) || items.length < 10) throw new Error(`catalog returned ${Array.isArray(items) ? items.length : 0} verified positions < 10`);
  console.log(JSON.stringify({ retailer: 'Pyaterochka', city, storeSap: sap, sourceUrl: url, observedAt: new Date().toISOString(), items }));
}

main().catch((error) => { console.error(`Pyaterochka collector failed closed: ${error.message}`); process.exitCode = 1; });

export { getJson };
