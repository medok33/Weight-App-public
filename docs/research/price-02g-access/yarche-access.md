# PRICE-02G Ярче! — access research

Date: 2026-08-15. Live read-only GraphQL verified from research sandbox.

## Transport

- Direct HTTPS to yarcheplus.ru and api.yarcheplus.ru → HTTP 200 (works even
  from non-RU exit; earlier failures were transient/transport, not a hard block).
- WAF: QRATOR (sets `qrator_msid2` cookie). Read GraphQL queries succeed; the
  `setCurrentAddress` mutation called outside a browser → HTTP 400 `[]`
  (WAF-shaped; UNVERIFIED cause).

## City/store selection mechanism

- No URL prefixes/subdomains. City context is server-side, bound to an anonymous
  session `token` embedded in SSR HTML (`window.__INITIAL_STATE__`), plus
  `window.API_URL='https://api.yarcheplus.ru'`.
- Address chosen in browser modal (Yandex suggest); submits GraphQL mutation
  `setCurrentAddress(input: SetCurrentAddressRequest!)` — input:
  `{address, coordinates:{latitude,longitude}, isAccurate, details:[{kind,name}], isForceChangeCurrentCatalog:true}`.
- Server responds with headers `x-current-catalog-id`, `x-current-catalog-type`
  (exposed via CORS); client sends them as request headers on subsequent calls.
  Catalog scoping is header/session-based, NOT URL-based.

## Catalog channel

- `POST https://api.yarcheplus.ru/api/graphql` with header `token: <anon token>`.
- Verified read-only queries: `stocks { id name vendorGuid }` (warehouse list;
  default stock is geo-IP dependent), `currentAddress`, `catalogs`,
  `products(input: ProductsRequest) { list{...} page{total} }` (input
  `{filter: ProductsFilterRequest!, page:{page,limit}}`; catalog via
  `x-current-catalog-id/type` headers), `stockPickups` (store locator).
- Product fields: id, name, slug, prices (price/oldPrice), ratings; thumbnails
  `https://api.yarcheplus.ru/thumbnail/...`.
- SSR `/catalog/newest-732` renders ~50 priced cards anonymously (default
  catalog id 2, no city binding).

## Москва / Ковров coverage — CONFIRMED

- Homepage delivery-info HTML lists 251 store postal addresses incl. ~15 in
  Москва (e.g. 105037, г. Москва, ул. Первомайская, 17) and exactly one Ковров
  store: 601900, г. Ковров, ул. Шмидта, 14с1.
- Delivery city list explicitly includes Ковров, Москва и 25 городов-спутников,
  Владимир, Муром.

## Third-party clients

None found (GitHub/PyPI/npm) — no public parser ecosystem.

## LIVE PROOF (2026-08-15, real anonymous browser session)

Executed the recommended browser flow end-to-end from the research sandbox:

1. Opened https://yarcheplus.ru/ (anonymous, no login). Default address modal
   shows geo-IP default «Ереван, площадь Республики» — confirming catalog is
   address-bound and NOT silently city-agnostic.
2. Set delivery address «Москва, Первомайская улица, 17» via the site's own
   address modal (Yandex suggest → «Доставить сюда»). Header now shows the
   address; category /catalog/ovoschi-i-frukty-187 rendered 48 priced products.
3. Set address «Ковров, улица Шмидта, 14с1» (Владимирская область). Same
   category rendered 48 priced products with a DIFFERENT product set.
4. Two runs per city (reload); raw ARIA snapshots and normalized JSON saved.

Discrimination evidence: 38 common productIds have identical RUB prices, 10
products are Moscow-only and 10 Kovrov-only — catalog composition differs per
city, proving the address context changes the served catalog. Common prices are
uniform across cities (single national price list; composition differs).

Artifacts (.data/research/price-02g/yarche/):
- moscow-catalog-run1/run2.snapshot.txt (sha256
  87b0c2c4544e2dbaa312d398a2369be5fe78845887a23e5d54192c093cf775ce, observedAt
  2026-08-15T02:00:45Z / 02:01:09Z)
- kovrov-catalog-run1/run2.snapshot.txt (sha256
  be3c23dee2c5704276f42a3ddf093f3552fe78db822be327e5e0dd2b7d05761c, observedAt
  2026-08-15T02:03:04Z / 02:03:18Z)
- moscow/kovrov-catalog-run1-prices.json (48 + 48 normalized records: id, name,
  unit, price, oldPrice, RUB, sourceUrl, observedAt, method)

## Verdict

YARCHE_LIVE_SOURCE_PROVEN=YES (anonymous browser flow, reproducible)
YARCHE_STORE_CONTEXT_PROVEN=YES (Москва и Ковров, address-bound catalog)
YARCHE_PRODUCT_CATALOG_PROVEN=YES; YARCHE_PRICE_FIELDS_PROVEN=YES (regular +
old/promo price, unit)
YARCHE_ACCESS_ESTABLISHED=YES, ACCESS_TYPE=official public web catalog via
ordinary anonymous browser session (no auth, no bypass; WAF never triggered)
YARCHE_MOSCOW_CONTEXT=PROVEN; YARCHE_KOVROV_CONTEXT=PROVEN
YARCHE_LIVE_PRICE_COUNT=48+48 (96 records; 76 unique products)
SECOND_LIVE_RUN=PASS (per city)
Caveat: prices are delivery-catalog prices for the selected address (STORE vs
DELIVERY semantics of the physical shelf not separately exposed).
