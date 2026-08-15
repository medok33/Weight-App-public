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
| Proshoper | Москва | CITY_PROMO | Current catalog dated 11–17 Aug 2026, 248 products; two browser acquisitions, 20 normalized RUB offers per run. Snapshot SHA256: `348d7a36098d657a72bfd4a70b0c0ee725eda6eda777cbbb40091a74491ddab6`. |
| Proshoper | Ковров | CITY_PROMO | Current catalog dated 11–17 Aug 2026, 239 products; two browser acquisitions, 20 normalized RUB offers per run. Snapshot SHA256: `8c5d60da199c3e95d95cf6b04c2b1351157fc56529696858eef281b2133165e1`. |
| SkidkaOnline | Ковров | CITY_PROMO | Historical page available, but not used for acceptance because Proshoper supplied a current catalog. |

Both Proshoper sources are city-level only: source pages explicitly warn that prices can
vary by store. These rows must not be used for store-level PostgreSQL observations.

The saved artifacts are browser DOM snapshots, not HTTP HAR bodies. Direct local TLS
retrieval failed with Windows Schannel `SEC_E_NO_CREDENTIALS`; therefore the hashes above
are hashes of the rendered snapshots and are not represented as raw HTTP-response hashes.

## Commercial feed pilot

XMLDataFeed, Cenozavr and Metacommerce remain **UNACCEPTED**. No real Moscow and Kovrov
sample files were available; therefore no provider is marked live or persisted.

## Verification

- multisource provider tests: PASS (3/3);
- existing Pyaterochka collector tests: PASS (6/6);
- API typecheck: PASS;
- `git diff --check`: PASS;
- PostgreSQL writer/reader acceptance: BLOCKED — Docker/PostgreSQL is unavailable in the current environment; no database writes were attempted.

## Verdict

`PRICE_02H_MULTISOURCE_CITY_PROMO_EVIDENCE_READY_DB_BLOCKED`

Direct/browser store channel remains separate and may be unavailable due CAPTCHA/403.
The city-promo adapter is implemented, but only Moscow has a current source indication;
Kovrov, two-run reproducibility, raw hashes and PostgreSQL acceptance remain open.
