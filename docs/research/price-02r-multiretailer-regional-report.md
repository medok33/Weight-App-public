# PRICE-02R regional/multiretailer remediation

TASK_ID=PRICE-02R-GLM-MULTIRETAILER-REGIONAL-COVERAGE-REMEDIATION
BRANCH=price/02r-glm-live-public-price-extraction
RETAILERS_PROVEN=0
MAGNIT_PROVEN=NO (the text-extraction proxy returned the same Krasnodar catalog for eight different shopCode values; it is not a discriminating store channel)
PYATEROCHKA_PROVEN=NO
YARCHE_PROVEN=NO
REGIONS_DISCOVERED=0
CITIES_DISCOVERED=0
STORES_DISCOVERED=0
TOTAL_STORES_PROVEN=0
LIVE_PRICE_COUNT=0 (no accepted store-bound record)
SECOND_LIVE_RUN_PER_STORE=NOT_PROVEN
STORE_DISCOVERY_IMPLEMENTED=PARTIAL (bounded read-only tool; no retailer has an accepted automatic store-discovery result)
PYATEROCHKA_PUBLIC_FLOW_IMPLEMENTED=YES (geocode -> nearest store/SAP -> store catalog search; no cookies or credentials)
PYATEROCHKA_CURRENT_RUN=FAIL_CLOSED (2026-08-14: `5ka.ru/api/maps/geocode` returned HTTP 403 before a store or price was read)
NETWORK_EXIT_CHECK=Armenia / Yerevan (current VPN exit, not a Russian exit)
REGIONAL_PRICE_SEPARATION=NOT_PROVEN
HARDCODED_SINGLE_STORE_ONLY=NO (Magnit collector requires explicit selected and control stores and rejects a non-discriminating response)
FIXTURE_AS_LIVE=NO
SECRETS_COMMITTED=NO (saved raw evidence scan passed)

REGION_STORE_MATRIX=
- No accepted entries. Historical Magnit candidate 992301 is retained as raw diagnostic evidence only, not as proof.

FAILED_DOORS=
- Magnit | proxy store discrimination | eight distinct requested shopCode values (842130, 777798, 448944, 473343, 471623, 522856, 610308, 860651) all returned the same Krasnodar catalog title | collector now requires selected/control store discrimination | unresolved; proxy channel rejected as non-store-specific
- Magnit | direct public store discovery | not yet available through an accepted ordinary route | do not infer a city from third-party code postings | unresolved
- Pyaterochka | 5ka.ru / 5d.5ka.ru | current ordinary public request returned HTTP 403 at geocoding; no store/SAP or price accepted | direct official-contract collector fails closed | unresolved; requires a permitted route where the retailer accepts the request
- Yarche | yarcheplus.ru | current public catalog probe had a transport failure; separately indexed product pages do not expose a selected store identity | fail-closed collector | unresolved; store-selection flow must be accepted by the retailer before regional prices can count

COLLECTOR_PATHS=tools/price-research/retailer-store-discovery.mjs; tools/price-research/magnit-live-collector.mjs; tools/price-research/pyaterochka-live-collector.mjs; tools/price-research/yarche-live-collector.mjs
DATASET_PATH=.data/research/price-02r-glm-live-prices*.json (historical diagnostic artifacts only; no accepted live dataset)
RAW_EVIDENCE_PATH=.data/research/price-02r-glm-raw/ (sanitized historical diagnostic artifacts)
REPORT_PATH=docs/research/price-02r-multiretailer-regional-report.md
PARSER_TESTS=PASS for Magnit parser and discriminator (4/4)
SECRETS_SCAN=PASS; no cookies/tokens/credentials

BLOCKERS=No accepted store-bound channel exists. Current network exit is Armenia; Pyaterochka's ordinary geocode route returns HTTP 403 and Yarche's catalog probe fails at transport. Magnit's available text proxy fails store discrimination.
NEXT_ACTION=Use an ordinary retailer-accepted Russian network route; run the retailers' public store-selection flows, obtain IDs issued by each frontend, and collect two sanitized catalog runs per store.
FINAL_VERDICT=PRICE_02R_FAILED
