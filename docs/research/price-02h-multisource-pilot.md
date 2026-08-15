# PRICE-02H — Pyaterochka multisource pilot

Date: 2026-08-15

## Reference comparison

Open-Inflation `pyaterochka_api` 0.2.2 documents the following contract:

- address discovery: `suggest(query)` → `geocode(country, city, street, house)`;
- store discovery: `find_store(longitude, latitude)`;
- selected store identity: `delivery_panel_store().selectedStore.sapCode`;
- store catalog: `tree`, `products_list`, `products_line`, `search`, `Product.info`;
- purchase mode: `PurchaseMode.STORE` or `PurchaseMode.DELIVERY`.

The current Node collector matches the public endpoint family for geocode, nearest-store
discovery and `catalog/v3/.../search?mode=store`, but does not implement browser bootstrap
or `delivery_panel_store` session state. Direct Node access remains fail-closed on HTTP 403.

## Provider implementation

Added `PyaterochkaLicensedFeedProvider`, `PyaterochkaCityPromoProvider` and
`PyaterochkaReceiptObservationProvider` in
`apps/api/src/modules/price-intelligence/providers/pyaterochka-multisource.providers.ts`.
They accept only explicit, timestamped RUB rows, validate freshness, preserve city/store
scope, reject duplicate PLUs and expose the required provider priority:

`STORE > DELIVERY_ADDRESS > CITY_PROMO > RECEIPT_HISTORY > OPEN_CROWD`.

No provider promotes `CITY_PROMO` to `STORE`. No commercial feed is accepted without a
real sample file.

## Free-source checks

| Source | City | Scope | Result |
|---|---|---|---|
| Proshoper | Москва | CITY_PROMO | Current catalog dated 11–17 Aug 2026, 248 products; two independent network runs and raw response hash were not captured in this audit. |
| Proshoper | Ковров | CITY_PROMO | Search result exposes historical catalog pages, but no current ≥20-row sample with valid dates was available. Not accepted. |
| SkidkaOnline | Ковров | CITY_PROMO | Current page result was stale/historical; no acceptance sample. |

The Moscow source is not store-specific: source pages explicitly warn that prices can vary
by store. These rows must not be used for store-level PostgreSQL observations.

## Commercial feed pilot

XMLDataFeed, Cenozavr and Metacommerce remain **UNACCEPTED**. No real Moscow and Kovrov
sample files were available; therefore no provider is marked live or persisted.

## Verification

- multisource provider tests: PASS (3/3);
- existing Pyaterochka collector tests: PASS (6/6);
- API typecheck: PASS;
- `git diff --check`: PASS;
- PostgreSQL writer/reader acceptance: NOT RUN — no accepted live rows and no disposable DB run was authorized for this research-only pilot.

## Verdict

`PRICE_02H_MULTISOURCE_PARTIAL_NOT_ACCEPTED`

Direct/browser store channel remains separate and may be unavailable due CAPTCHA/403.
The city-promo adapter is implemented, but only Moscow has a current source indication;
Kovrov, two-run reproducibility, raw hashes and PostgreSQL acceptance remain open.
