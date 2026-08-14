# PRICE-02R regional/multiretailer remediation

TASK_ID=PRICE-02R-GLM-MULTIRETAILER-REGIONAL-COVERAGE-REMEDIATION
BRANCH=price/02r-glm-live-public-price-extraction
RETAILERS_PROVEN=0
MAGNIT_PROVEN=NO (the prior collector recorded a shop code but did not send it in the catalog URL; its 29 positions are not accepted as store-bound evidence)
PYATEROCHKA_PROVEN=NO
YARCHE_PROVEN=NO
REGIONS_DISCOVERED=0
CITIES_DISCOVERED=0
STORES_DISCOVERED=0
TOTAL_STORES_PROVEN=0
LIVE_PRICE_COUNT=0 (no accepted store-bound record)
SECOND_LIVE_RUN_PER_STORE=NOT_PROVEN
STORE_DISCOVERY_IMPLEMENTED=PARTIAL (bounded read-only tool; all store identities still require independent proof)
PYATEROCHKA_PUBLIC_FLOW_IMPLEMENTED=YES (geocode -> nearest store/SAP -> store catalog search; no cookies or credentials)
PYATEROCHKA_CURRENT_RUN=FAIL_CLOSED (2026-08-14: `5ka.ru/api/maps/geocode` returned HTTP 403 before a store or price was read)
NETWORK_EXIT_CHECK=Armenia / Yerevan (current VPN exit, not a Russian exit)
REGIONAL_PRICE_SEPARATION=NOT_PROVEN
HARDCODED_SINGLE_STORE_ONLY=NO (Magnit collector now requires --region, --city, and --store, and sends the store in the catalog request)
FIXTURE_AS_LIVE=NO
SECRETS_COMMITTED=NO

REGION_STORE_MATRIX=
- No accepted entries. The former Magnit candidate requires a fresh store-bound collection and repeat after the collector binding repair.

FAILED_DOORS=
- Magnit | catalog store binding | prior implementation failed to include `shopCode` in the actual catalog request; repaired collector now requires it | rerun with a separately discovered store identity and repeat | unresolved
- Pyaterochka | 5ka.ru / 5d.5ka.ru | current ordinary public request returned HTTP 403 at geocoding; no store/SAP or price accepted | direct official-contract collector fails closed | unresolved; requires a permitted route where the retailer accepts the request
- Yarche | yarcheplus.ru | current public catalog probe had a transport failure; separately indexed product pages do not expose a selected store identity | fail-closed collector | unresolved; store-selection flow must be accepted by the retailer before regional prices can count

COLLECTOR_PATHS=tools/price-research/retailer-store-discovery.mjs; tools/price-research/magnit-live-collector.mjs; tools/price-research/pyaterochka-live-collector.mjs; tools/price-research/yarche-live-collector.mjs
DATASET_PATH=.data/research/price-02r-multiretailer-live-prices.json
RAW_EVIDENCE_PATH=.data/research/price-02r-glm-raw/
REPORT_PATH=docs/research/price-02r-multiretailer-regional-report.md
PARSER_TESTS=PASS for Magnit parser (2/2)
SECRETS_SCAN=PASS; no cookies/tokens/credentials

BLOCKERS=No accepted store-bound live-price record currently exists. Current network exit is Armenia, while Pyaterochka's ordinary geocode route returns HTTP 403 and Yarche's catalog probe fails at transport.
NEXT_ACTION=Use an ordinary retailer-accepted Russian network route; discover each store identity, run each collector twice, and retain sanitized raw evidence.
FINAL_VERDICT=PRICE_02R_NO_STORE_BOUND_REGIONAL_PROOF_YET
