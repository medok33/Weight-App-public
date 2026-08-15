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

Evidence contract for all four runs: `RAW_EVIDENCE_TYPE=DOM_SNAPSHOT`,
`HTTP_RAW_BODY_REQUIRED=NO`, `fixtureAsLive=false`, `currency=RUB`, and
`validTo=2026-08-17`. Run-1/run-2 capturedAt values are distinct; identical snapshot
content/SHA256 is accepted as reproducible acquisition, not as a fabricated HTTP body.

The saved artifacts are browser DOM snapshots, not HTTP HAR bodies. Direct local TLS
retrieval failed with Windows Schannel `SEC_E_NO_CREDENTIALS`; therefore the hashes above
are hashes of the rendered snapshots and are not represented as raw HTTP-response hashes.

## Commercial feed pilot

XMLDataFeed, Cenozavr and Metacommerce remain **UNACCEPTED**. No real Moscow and Kovrov
sample files were available; therefore no provider is marked live or persisted.

## Verification

- multisource provider tests: PASS (5/5), including no-PLU identity collision and CITY_PROMO scope/expiry contracts;
- existing Pyaterochka collector tests: PASS (6/6);
- API typecheck: PASS;
- `git diff --check`: PASS;
- PostgreSQL writer/reader acceptance: BLOCKED — disposable topology startup failed because the Docker Engine named pipe was unavailable; no shared/prod database was contacted and no database writes were attempted.

## Verdict

`PRICE_02J_CITY_PROMO_CONTRACT_READY_DB_BLOCKED`

Direct/browser store channel remains separate and may be unavailable due CAPTCHA/403.
Both Moscow and Kovrov have two independent DOM-snapshot acquisitions with distinct
timestamps and stable snapshot hashes. The adapter now uses a fail-closed identity for
rows without PLU/GTIN and exposes the fallback disclaimer: «Цена по городскому каталогу,
в конкретном магазине может отличаться». PostgreSQL migration/writer/reader acceptance
remains open until Docker Engine is restored.
