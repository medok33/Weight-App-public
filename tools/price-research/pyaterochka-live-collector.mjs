#!/usr/bin/env node
/* global fetch, AbortSignal, URL, Buffer */
// Read-only Pyaterochka store-mode collector. Challenge/CAPTCHA screens fail closed.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export const DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  maxResponseBytes: 2_000_000,
  requestBudget: 8,
  minItems: 20,
  apiBase: "https://5d.5ka.ru/api",
});

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    args[key] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  }
  return args;
}
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseCoordinates(payload) {
  const point = payload?.Point ?? payload?.point ?? payload?.data?.Point;
  const pos = typeof point?.pos === "string" ? point.pos.trim().split(/[ ,]+/).map(Number) : [];
  const longitude = finiteNumber(
    payload?.longitude ?? payload?.coordinates?.longitude ?? payload?.data?.longitude ?? pos[0],
  );
  const latitude = finiteNumber(
    payload?.latitude ?? payload?.coordinates?.latitude ?? payload?.data?.latitude ?? pos[1],
  );
  if (
    longitude === undefined ||
    latitude === undefined ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    return undefined;
  return { longitude, latitude };
}

export function extractStore(payload) {
  const candidates = [];
  const add = (value) => {
    if (Array.isArray(value)) candidates.push(...value);
    else if (value && typeof value === "object") candidates.push(value);
  };
  add(payload);
  add(payload?.stores);
  add(payload?.data);
  add(payload?.data?.stores);
  add(payload?.results);
  for (const store of candidates) {
    const sapCode =
      store?.sapCode ?? store?.sap_code ?? store?.store?.sapCode ?? store?.store?.sap_code;
    if (sapCode !== undefined && sapCode !== null && String(sapCode).trim())
      return { sapCode: String(sapCode).trim(), name: store?.name ?? store?.store?.name };
  }
  return undefined;
}

function unwrapItems(payload) {
  return (
    [
      payload?.products,
      payload?.items,
      payload?.data?.products,
      payload?.data?.items,
      payload?.results,
    ].find(Array.isArray) ?? []
  );
}

export function normalizeProducts(payload, context) {
  return unwrapItems(payload)
    .map((item) => {
      const price = finiteNumber(
        item?.currentPrice ?? item?.price ?? item?.prices?.current ?? item?.price?.value,
      );
      const oldPrice = finiteNumber(item?.oldPrice ?? item?.prices?.old ?? item?.old_price);
      const currency = String(item?.currency ?? item?.price?.currency ?? "RUB").toUpperCase();
      const plu = item?.plu ?? item?.id ?? item?.productId ?? item?.product_id;
      const name = item?.name ?? item?.title;
      const unitPriceBasis = Boolean(
        item?.unitPriceBasis ?? item?.unit_price_basis ?? item?.pricePerUnit,
      );
      if (!plu || !name || price === undefined || price < 0 || currency !== "RUB") return undefined;
      return {
        retailer: "PYATEROCHKA",
        city: context.city,
        region: context.region ?? context.city,
        address: context.address,
        locationScope: "STORE",
        plu: String(plu),
        name: String(name),
        currentPrice: price,
        oldPrice: oldPrice ?? null,
        currency,
        sourceRoute: typeof item?.url === "string" ? item.url : undefined,
        unitPriceBasis,
      };
    })
    .filter(Boolean);
}

export function validateCatalog(products, context, options = {}) {
  const minItems = options.minItems ?? DEFAULTS.minItems;
  if (!context?.city || !context?.address) throw new Error("address context is required");
  if (!Array.isArray(products) || products.length < minItems)
    throw new Error(
      `catalog returned ${Array.isArray(products) ? products.length : 0} verified RUB positions < ${minItems}`,
    );
  if (
    products.some(
      (item) =>
        item.city !== context.city ||
        item.address !== context.address ||
        item.locationScope !== "STORE" ||
        item.currency !== "RUB",
    )
  )
    throw new Error("catalog contains an address, scope, or currency mismatch");
  if (new Set(products.map((item) => item.plu)).size !== products.length)
    throw new Error("catalog contains duplicate PLUs");
  return products;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function getJson(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
    headers: { accept: "application/json", "user-agent": "Weight-App-price-research/1.0" },
  });
  if (!response.ok)
    throw new Error(`${new URL(url).hostname}${new URL(url).pathname}: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  const max = options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
  if (Number.isFinite(length) && length > max) throw new Error("response exceeds size limit");
  const text = await response.text();
  if (Buffer.byteLength(text) > max) throw new Error("response exceeds size limit");
  return JSON.parse(text);
}

export async function collect(input, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const city = String(input.city ?? "").trim();
  const street = String(input.street ?? "").trim();
  const house = String(input.house ?? "").trim();
  if (!city || !street || !house) throw new Error("city, street and house are required");
  const address = `${street}, ${house}`;
  let requests = 0;
  const request = async (url) => {
    requests += 1;
    if (requests > config.requestBudget) throw new Error("request budget exceeded");
    return getJson(url, config);
  };
  const queryAddress = encodeURIComponent(`Россия, ${city}, ${street}, ${house}`);
  const geo = await request(`https://5ka.ru/api/maps/geocode/?geocode=${queryAddress}`);
  const coordinates = parseCoordinates(geo);
  if (!coordinates) throw new Error("geocode returned no verified coordinates");
  const storePayload = await request(
    `${config.apiBase}/orders/v1/orders/stores/?lon=${encodeURIComponent(coordinates.longitude)}&lat=${encodeURIComponent(coordinates.latitude)}`,
  );
  const store = extractStore(storePayload);
  if (!store) throw new Error("nearest-store response returned no SAP/store identity");
  const sourceUrl = `${config.apiBase}/catalog/v3/stores/${encodeURIComponent(store.sapCode)}/search?mode=store&include_restrict=true&q=${encodeURIComponent(input.query ?? "молоко")}&limit=50`;
  const catalog = await request(sourceUrl);
  const context = { city, region: input.region ?? city, address };
  const products = normalizeProducts(catalog, context);
  validateCatalog(products, context, config);
  const collectedAt = new Date().toISOString();
  return {
    schemaVersion: 2,
    retailer: "PYATEROCHKA",
    store: { city, region: context.region, address, sapCode: store.sapCode },
    observedAt: collectedAt,
    count: products.length,
    fixtureAsLive: false,
    locationScope: "STORE",
    sourceUrl,
    rawSha256: sha256(products),
    prices: products.map((item) => ({ ...item, runId: input.runId ?? undefined, collectedAt })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await collect(
    {
      city: args.city,
      street: args.street,
      house: args.house,
      query: args.query,
      region: args.region,
      runId: args.run,
    },
    { minItems: Number(args.minItems ?? DEFAULTS.minItems) },
  );
  if (args.output) {
    await mkdir(dirname(args.output), { recursive: true });
    await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/pyaterochka-live-collector.mjs"))
  main().catch((error) => {
    console.error(`Pyaterochka collector failed closed: ${error.message}`);
    process.exitCode = 1;
  });
