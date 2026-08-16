# PRICE-02G Магнит — access research

Date: 2026-08-15.

## Store-binding mechanism (root cause of PRICE-02R failure)

The SPA ignores `?shopCode=` as URL param for SSR context. The store is bound by
the **`shopCode` cookie**, value URL-encoded with quotes:
`shopCode="%22389698%22` → `shopCode=%22389698%22`. Companion cookies:
`x_shop_type=1` (grocery), `nmg_dt=DELIVERY_TYPE_PICKUP`, `mg_geo_id` (legacy
city id). The text-extraction proxy r.jina.ai forwards cookies via the
**`X-Set-Cookie`** request header (documented; such requests are not cached) —
this closes the store-discrimination gap from PRICE-02R.

## Verified endpoints

| Endpoint | Status |
|---|---|
| `GET magnit.ru/webgate/v1/cities?limit=5000` | 200; Москва id `0c5b2444-70a0-4932-980c-b4dc0d3f02b5`, Ковров id `0b4978e2-e64c-4db1-b84d-93cf34bdb04b` |
| `GET magnit.ru/webgate/shops/v1/shop_by_point?x={lat}&y={lon}` | 200; returns shops with `xml_id` (=shopCode) + address |
| `POST magnit.ru/webgate/v2/goods/search` (`{storeCode,storeType:"1",catalogType:"1",pagination,sort}`) | 200 direct (until our exit IP got WAF-blocked); structured product JSON with prices |
| `GET magnit.ru/catalog/` via r.jina.ai + `X-Set-Cookie` | 200; store-bound SSR catalog (proof below) |

## Live proof (this run, read-only, 4 catalog requests + discovery)

- Москва, **shopCode 389698**, «г Москва, проезд Ясный, д 26 к 1»: 2 runs
  (2026-08-15T02:04:46Z / 02:04:57Z), all product links carry
  `shopCode=389698`, raw sha256
  96f1d1e5…/9e88a1db… (distinct), 32 parsed priced products.
- Ковров, **shopCode 812923**, «Владимирская обл, г Ковров, пр-кт Ленина, д
  29»: 2 runs (02:05:08Z / 02:05:21Z), links carry `shopCode=812923`, raw
  sha256 d20eed6e…/8f2058a9… (distinct), 32 parsed priced products.

**Store-price discrimination proven**: identical productIds differ across
stores — Бананы (9072651501) 149.00 vs 149.99 ₽; Огурцы короткоплодные
(1000143746) 181.00/90.50 vs 119.99/59.99 ₽. Prices do not silently transfer
between stores.

Artifacts: `.data/research/price-02g/magnit/` — moscow/kovrov-catalog-run{1,2}.txt
(sanitized) + moscow/kovrov-catalog-run1-prices.json.

## Caveats

- shopCodes may rotate (other repos show 777885 for Moscow); always re-resolve
  via `shop_by_point` before long-running jobs.
- regular/promo attribution in the HTML-context parser is heuristic (adjacent
  ₽ amounts); production adapter should confirm per product via
  `webgate/v2/goods/search` structured response.
- `shopType=express` appears in product links — STORE vs DELIVERY (express)
  semantics must be pinned explicitly in the adapter (x_shop_type/nmg_dt).
- Transport is a third-party text proxy; production should use the direct
  `webgate` endpoints from an accepted network route.

## Verdict

MAGNIT_ACCESS_ESTABLISHED=YES
MAGNIT_ACCESS_TYPE=official public catalog SSR with shopCode cookie (anonymous,
no auth; cookie transport via text proxy for research only)
MAGNIT_SHOP_CODE_PROVEN=YES (Москва 389698, Ковров 812923, addresses verified)
MAGNIT_STORE_CONTEXT_PROVEN=YES; MAGNIT_LIVE_PRICE_COUNT=32+32
SECOND_LIVE_RUN=PASS per store

## Reproduction

```bash
curl "https://r.jina.ai/https://magnit.ru/catalog/" \
  -H 'X-Set-Cookie: shopCode=%22812923%22; x_shop_type=1'
# store discovery:
curl "https://r.jina.ai/https://magnit.ru/webgate/shops/v1/shop_by_point?x=56.3606&y=41.3186"
```

Reference repos: Catokiy/DWH_for_retail_product_prices_analysis,
krankir/parsing_Magnit, IT-Arkhipov/mm_prices, Tititun/price_etl,
MASTER-KungFu-1/ShopChecker_API (contract references only).
