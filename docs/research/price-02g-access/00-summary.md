# PRICE-02G retailer data access establishment — summary

TASK_ID=PRICE-02G-RETAILER-DATA-ACCESS-ESTABLISHMENT
DATE=2026-08-15
BRANCH=price/02g-access-research (from price/02r-glm-live-public-price-extraction @ eeca8ae; origin/main da23682)
NETWORK_EXIT=Yerevan, AM (unchanged constraint)

## Headline result

| Retailer | Access | Москва context | Ковров context | Live prices (2 runs each) |
|---|---|---|---|---|
| Магнит | YES — public catalog SSR with shopCode cookie | PROVEN (389698, Ясный пр-д 26к1) | PROVEN (812923, Ленина 29) | 32+32, store-discriminating |
| Ярче! | YES — anonymous browser session, address-bound catalog | PROVEN (Первомайская 17) | PROVEN (Шмидта 14с1) | 48+48, city-discriminating composition |
| Пятёрочка | NO (this run) — RU-only IP geo-block, not contract unknown | NOT_PROVEN | NOT_PROVEN | 0 |

ACCESS_ESTABLISHED=2 of 3 (PARTIAL per task §9: минимум один новый рабочий
доступ — exceeded).

## Key discoveries

1. **Magnit**: store binding is the `shopCode` **cookie** (`"%22<code>%22"`),
   not the URL param (root cause of PRICE-02R's non-discriminating proxy
   results). r.jina.ai forwards it via `X-Set-Cookie`. Verified Москва &
   Ковров shopCodes with addresses; store prices differ across stores.
   Structured alternative: `POST /webgate/v2/goods/search` with `storeCode`.
2. **Yarche**: catalog is address-bound via anonymous session + browser address
   modal (GraphQL `setCurrentAddress` → `x-current-catalog-id` header). Full
   browser flow reproduced for Москва and Ковров; WAF never triggered.
3. **Pyaterochka**: 403 is IP-geolocation based (RU-only), including via text
   proxy (US egress). Contract is fully documented from the MIT-licensed
   reference. Official contact found: Service_connect@x5.ru. Requires a lawful
   RU network route or official permission — both are owner actions.

## Counts

PUBLIC_CHANNELS_TESTED=~40 (catalog SSR, store locators, webgate/cities,
shop_by_point, goods/search, graphql, geocode, suggest, mobile-web)
PARTNER_CHANNELS_FOUND=6 (b2b.magnit.ru, magnit-tech GitHub, importx5.com,
x5.tech, zakupkiyarche.ru, info@yarcheplus.ru)
OFFICIAL_CONTACTS_FOUND=6; MESSAGES_PREPARED=3; MESSAGES_SENT=0 (no authorized
channel; see outreach-log.md)
AGGREGATORS_TESTED=0 live; LICENSED_PROVIDER_CANDIDATES_FOUND=3 (see
aggregator-analysis.md)
REAL_RETAILER_REQUESTS=~55 (bounded; ≤35 per retailer; 1–1.5s delays; max
concurrency 1)
403_COUNT≈4 (Pyaterochka geo-block); 429_COUNT=0; CAPTCHA_COUNT=0;
PURCHASES=0; MUTATING_CALLS=0; AUTH/account use=0; bypass/proxy-rotation=0

## Artifacts

docs/research/price-02g-access/: this file, magnit-access.md,
pyaterochka-access.md, yarche-access.md, contacts.md, outreach-log.md,
aggregator-analysis.md, recommended-access-architecture.md
.data/research/price-02g/: magnit/ (4 raw + 2 datasets), yarche/ (4 snapshots +
2 datasets)

## Exact blockers

- Pyaterochka: RU-only geo-policy (IP-based) from every lawful exit available
  to this sandbox; not bypassed (by policy). Owner must either send the
  prepared outreach (Service_connect@x5.ru) or run the documented collector
  from a lawful RU network route.

## Final verdict

FINAL_VERDICT=PRICE_02G_PARTIAL_PASS
(MAGNIT=YES, YARCHE=YES, PYATEROCHKA=NO with proven exact blocker + documented
contract + outreach ready; MOSCOW 2/3, KOVROV 2/3, LIVE_PRICES=YES,
SECOND_LIVE_RUN=PASS for both proven retailers)
