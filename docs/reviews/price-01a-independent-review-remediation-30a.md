# PRICE-01A independent review remediation 30A

Parent review: `PRICE-01A-INDEPENDENT-ADVERSARIAL-REVIEW-30` at
`982c588b31d2f04017b2e2181989440e25f76462`.

| Finding | Severity | Root cause | Fix | Regression proof | Status |
|---|---|---|---|---|---|
| PR30-001 | HIGH | v1 delimiter hash omitted package and promotion qualifiers | Fixed-order v2 tuple, canonical time/decimal/unit/currency plus all evidence dimensions | core identity matrix + real DB dedup | CLOSED |
| PR30-002 | HIGH | catalog/shopping used latest raw observation | shared `readReferencePriceWithQuery`; numeric package price only for eligible CURRENT evidence | fail-closed persistence matrix and ProductPriceResolver assertion | CLOSED |
| PR30-003 | HIGH | unconditional snapshot conflict update | atomic conditional upsert on observedAt and deterministic evidence tie-break; observation transaction | deterministic select barrier with older completion last | CLOSED |
| PR30-004 | HIGH | timeout raced a write-capable repository promise | bounded, abortable source collection precedes any atomic publication | A TIMEOUT/B SUCCESS real-DB test; late A cannot create retailer/observation | CLOSED |
| PR30-005 | HIGH | ingestion accepted any currency while read emitted RUB | canonical RUB-only ingress; reader joins evidence currency; non-RUB never materializes | currency unit and persistence rejection | CLOSED |
| PR30-006 | MEDIUM | negative age was always current | five-minute future clock-skew bound; UTC ISO database serialization | exact boundary/future/timezone tests | CLOSED |
| PR30-007 | MEDIUM | first retailer store and hardcoded generic scope collapsed locations | scoped store upsert; exact STORE requires external ID; city/region/unknown remain lower specificity | distinct-store and exact-store mismatch persistence proof | CLOSED |
| PR30-008 | MEDIUM | incomplete result taxonomy and non-atomic publication | SUCCESS/NO_DATA/TIMEOUT/SOURCE_UNAVAILABLE/ERROR plus atomic provider transaction and bounded inputs | result matrix, partial/timeout isolation tests | CLOSED |

No new schema migration is required. Migration 223 remains immutable. The migration
runner now rejects later insertion of a lower-numbered migration; current absence of
222 remains valid and Assistant Brain must renumber at future re-entry.
