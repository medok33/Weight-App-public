# PRICE-02G Пятёрочка — access research

Date: 2026-08-15. Research-only; no live store-bound data obtained this run.

## Transport status (tested through r.jina.ai text proxy, 2026-08-15)

| Route | Result |
|---|---|
| https://5ka.ru/ via proxy | HTTP 200, empty SPA shell + CAPTCHA warning; no data |
| 5ka.ru/api/maps/geocode via proxy | upstream HTTP 403, geo-block page («Проверьте настройки интернета и VPN», report ID, exit IP 34.34.225.46 US) |
| 5d.5ka.ru/api/catalog/v2/... via proxy | upstream HTTP 403, same block |
| m.5ka.ru | DNS does not exist |

CONCLUSION: the 403 is **IP-geolocation based** (non-RU exits blocked, including
the proxy's US egress). It is not header-based. No permitted route from the
current Armenian exit; no bypass attempted (and none allowed).

## Reference contract (Open-Inflation/pyaterochka_api @ 237658a2, MIT, active 2026-03)

- Uses Camoufox (anti-detect Firefox) + Playwright; warms up on 5ka.ru, handles
  optional `is-robot` checkbox captcha, sniffs headers `x-app-version`,
  `x-device-id`, `x-platform`; fetches from page context with
  `credentials: include`, referrer https://5ka.ru.
- Anonymous identity: localStorage `deviceId`; selected store:
  `DeliveryPanelStore → store_info["selectedStore"]["sapCode"]`.
- Endpoints (base `https://5d.5ka.ru/api`, secondary `https://api.5ka.ru/api`):
  - geocode: `GET https://5ka.ru/api/maps/geocode/?geocode=<addr>` → `Point.pos` "lon lat"
  - suggest: `GET https://5ka.ru/api/maps/suggest/?text=`
  - nearest store: `GET {5d}/orders/v1/orders/stores/?lon=&lat=` → SAP code
  - categories: `GET {5d}/catalog/v2/stores/{sap}/categories?mode=store`
  - products: `GET {5d}/catalog/v2/stores/{sap}/categories/{id}/products?mode=store&limit=≤499`
  - detail: `GET {5d}/catalog/v2/stores/{sap}/products/{plu}?mode=store`
  - search: `GET {5d}/catalog/v3/stores/{sap}/search?q=&limit=12`
  - `mode` = `store` | `delivery` (must not be mixed)

REFERENCE_CONTRACT_STATUS: valid as a **contract reference** (endpoint/param
map); the Python/Camoufox runtime is not portable to Weight as-is.

## Access verdict (this run)

PYATEROCHKA_ACCESS_ESTABLISHED=NO (blocked by RU-only geo-policy from current
exit; not by unknown contract)
PYATEROCHKA_CONTACT_ESTABLISHED=PARTIAL (Service_connect@x5.ru verified public)
MOSCOW_CONTEXT=NOT_PROVEN; KOVROV_CONTEXT=NOT_PROVEN; LIVE_PRICE_COUNT=0

## Next verifiable actions

1. Owner sends outreach draft to Service_connect@x5.ru (see outreach-log.md).
2. From any lawful Russian network exit, run the documented flow:
   geocode(Москва/Ковров) → stores/?lon&lat → categories → products
   (mode=store) — 2 runs per city, sanitized evidence.
3. If run headless without Camoufox fails, capture `x-device-id` etc. once via
   own anonymous browser session (own session is allowed; no credential use).
