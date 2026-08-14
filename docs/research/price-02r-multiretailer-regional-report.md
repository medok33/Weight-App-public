# PRICE-02R regional/multiretailer remediation

TASK_ID=PRICE-02R-GLM-MULTIRETAILER-REGIONAL-COVERAGE-REMEDIATION
BRANCH=price/02r-glm-live-public-price-extraction
RETAILERS_PROVEN=1
MAGNIT_PROVEN=YES (one store only: shopCode=992301, Krasnodar, Krasnodar Krai)
PYATEROCHKA_PROVEN=NO
YARCHE_PROVEN=NO
REGIONS_DISCOVERED=1
CITIES_DISCOVERED=1
STORES_DISCOVERED=1
TOTAL_STORES_PROVEN=1
LIVE_PRICE_COUNT=29
SECOND_LIVE_RUN_PER_STORE=PASS for Magnit shopCode=992301
MAGNIT_RUN_1=PASS; observedAt=2026-08-14T13:29:57.867Z; rawSha256=7c44722314f29d705eaf002fd5d191251bf7d1fca06d5e86f70698c399357ce0; prices=29; productUrlsBound=29/29
MAGNIT_RUN_2=PASS; observedAt=2026-08-14T13:30:52.457Z; rawSha256=f11f6c7d774581e51efe3269af570a82d8d9846f1ad0a66796261759ddeb7da3; prices=29; productUrlsBound=29/29
STORE_DISCOVERY_IMPLEMENTED=PARTIAL (bounded read-only tool; all further store identities still require independent proof)
PYATEROCHKA_PUBLIC_FLOW_IMPLEMENTED=YES (geocode -> nearest store/SAP -> store catalog search; no cookies or credentials)
PYATEROCHKA_CURRENT_RUN=FAIL_CLOSED (2026-08-14: `5ka.ru/api/maps/geocode` returned HTTP 403 before a store or price was read)
NETWORK_EXIT_CHECK=Armenia / Yerevan (current VPN exit, not a Russian exit)
REGIONAL_PRICE_SEPARATION=PASS for the one accepted Magnit record only
HARDCODED_SINGLE_STORE_ONLY=NO (Magnit collector requires --region, --city, and --store, and sends the store in the catalog request)
FIXTURE_AS_LIVE=NO
SECRETS_COMMITTED=NO (raw evidence scan passed)

REGION_STORE_MATRIX=
- Magnit | Krasnodar Krai | Krasnodar | shopCode=992301 | public catalog title identifies Krasnodar, im. Dzerzhinskogo street, house 42; source and all 29 product URLs have shopCode=992301 | 29 | PASS (two saved runs)

FAILED_DOORS=
- Magnit | regional coverage | only one independently evidenced city/store | continue public store discovery for Moscow, St Petersburg, Vladimir/Kovrov, and Novosibirsk, then run twice each | unresolved
- Pyaterochka | 5ka.ru / 5d.5ka.ru | current ordinary public request returned HTTP 403 at geocoding; no store/SAP or price accepted | direct official-contract collector fails closed | unresolved; requires a permitted route where the retailer accepts the request
- Yarche | yarcheplus.ru | current public catalog probe had a transport failure; separately indexed product pages do not expose a selected store identity | fail-closed collector | unresolved; store-selection flow must be accepted by the retailer before regional prices can count

COLLECTOR_PATHS=tools/price-research/retailer-store-discovery.mjs; tools/price-research/magnit-live-collector.mjs; tools/price-research/pyaterochka-live-collector.mjs; tools/price-research/yarche-live-collector.mjs
DATASET_PATH=.data/research/price-02r-glm-live-prices-magnit-992301-run1.json; .data/research/price-02r-glm-live-prices-magnit-992301-run2.json
RAW_EVIDENCE_PATH=.data/research/price-02r-glm-raw/magnit-catalog-magnit-992301-run1.txt; .data/research/price-02r-glm-raw/magnit-catalog-magnit-992301-run2.txt
REPORT_PATH=docs/research/price-02r-multiretailer-regional-report.md
PARSER_TESTS=PASS for Magnit parser (3/3)
SECRETS_SCAN=PASS; no cookies/tokens/credentials

BLOCKERS=The mandatory three-retailer, multi-region threshold is not met. Current network exit is Armenia; Pyaterochka's ordinary geocode route returns HTTP 403 and Yarche's catalog probe fails at transport.
NEXT_ACTION=Use an ordinary retailer-accepted Russian network route; discover each remaining store identity, run each collector twice, and retain sanitized raw evidence.
FINAL_VERDICT=PRICE_02R_PARTIAL_SINGLE_STORE_PROOF
