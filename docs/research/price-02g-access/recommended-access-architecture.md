# PRICE-02G recommended access architecture (for Codex PRICE-02B/02C planning)

Research-only recommendation; no product code was changed.

## 1. Magnit adapter (highest confidence)

- Store discovery: `GET /webgate/v1/cities?limit=5000` (city UUIDs) →
  `GET /webgate/shops/v1/shop_by_point?x={lat}&y={lon}` → `shops[].xml_id`
  (shopCode) + `formatted_address`. Re-resolve before each collection window
  (codes rotate).
- Price collection (preferred, structured): `POST /webgate/v2/goods/search`
  body `{storeCode, storeType:"1", catalogType:"1", pagination:{limit,offset},
  sort:{type:"popularity",order:"desc"}}` — returns product JSON with prices.
  Fallback (SSR text): `GET /catalog/` with cookie `shopCode="%22<code>%22"`,
  `x_shop_type=1`, `nmg_dt=DELIVERY_TYPE_PICKUP`.
- Must pin: purchaseMode semantics (`shopType=express` vs shop), promo vs
  regular price from structured fields (HTML context heuristic is not
  production-grade), per-store observedAt + raw hash.
- Risks: WAF geo-block on foreign exits (research used a text proxy with
  `X-Set-Cookie`; production must use an accepted RU route or official
  permission), endpoint churn (monitor title/schema), shopCode rotation.

## 2. Yarche adapter

- Ordinary anonymous browser session (Playwright-class) on yarcheplus.ru:
  open site → address modal → type address (Yandex suggest) → «Доставить сюда»
  → catalog pages render store-bound SSR with prices; or replay
  `POST https://api.yarcheplus.ru/api/graphql` with session `token` +
  `x-current-catalog-id/type` headers, query `products(input:{filter,page})`.
- Store context per city: Москва Первомайская 17, Ковров Шмидта 14с1 (verified
  bindings); store lists via `stocks` / `stockPickups` queries.
- Risks: address mutation is WAF-sensitive outside a real browser (keep the
  browser flow); delivery-catalog vs physical-shelf price semantics must be
  labeled; single national price list observed (composition differs by city).

## 3. Pyaterochka

- Blocked by RU-only IP geo-policy from every lawful non-RU exit. Before any
  engineering: owner sends outreach (Service_connect@x5.ru) AND/OR collector
  runs from a lawful RU route. Contract is ready (see pyaterochka-access.md):
  geocode → `orders/v1/orders/stores/?lon&lat` → sapCode →
  `catalog/v2/stores/{sap}/categories` → `.../products?mode=store` (never mix
  `mode=store|delivery`).

## 4. Common adapter requirements (all retailers)

- Two runs per store per collection; distinct raw hashes; sanitized raw
  evidence + normalized dataset with store, address, city, purchaseMode,
  observedAt, currency, source URL, raw hash.
- Kill switch + schema-drift monitor (title/address sentinel per store).
- Never present proxy/fallback data as user-visible live prices without
  SOURCE_POLICY review; research artifacts must not become product fixtures.

## 5. Recommended retailer order

1. Магнит (structured webgate API + proven store codes, store-discriminating
   prices)
2. Ярче (browser-flow adapter, uniform prices, city-bound composition)
3. Пятёрочка (after owner unlocks a lawful RU route or official permission)
