# Price Intelligence Sources

Price Intelligence is **source-agnostic**. Shopping List, Dashboard, Meal Plan, and AI Assistant never talk to a retailer API, CSV file, or parser. They only read durable `PriceObservation` rows.

## Retailer model (no brand names in business logic)

**Never** write domain rules like `if (retailer === 'vkusvill')`.

Retailers are first-class records:

```
Retailer {
  id
  key      -- stable slug used in code/queries (e.g. chain_alpha)
  name     -- display label only (UI / admin)
  type     -- CHAIN | DISCOUNTER | HYPERMARKET | LOCAL | ONLINE | OTHER
}
```

Imports may include optional columns `retailer_key` and `retailer_type`. If `retailer_key` is omitted, a slug is derived **once at ingest** from the display name — downstream code always works with `retailerId` + `type`.

Future flows (not implemented yet):

- user selects **«купить дешевле»**
- AI compares retailers by `type` + latest `PriceObservation`
- builds an optimal basket per `retailerId`
- suggests alternatives across chains

That enables: *«ИИ составил рацион, рассчитал бюджет и собрал оптимальную корзину в ближайшем магазине»* — without hard-coding any chain.

## Source types

| `sourceType` | Meaning | Example `sourceName` |
|--------------|---------|----------------------|
| `API` | Official retail / partner API | `Mock Official API`, `Partner API` |
| `CSV` | Public / open-data file import (CSV, JSON, XML, Excel-exported TSV) | `Импорт Excel 2026-07-21` |
| `MANUAL` | Admin-entered prices | `Ручной импорт 2026-07-21` |
| `PARSER` | Future web-parser providers (interface only today) | `Web parser` |

## `PriceObservation` provenance

```
id
productId
retailerId      -- FK to Retailer.id (compare baskets by id/type)
storeId         -- optional store grain
price
currency
sourceType      -- API | CSV | MANUAL | PARSER
sourceName      -- human label shown in UI (data channel, not retailer brand)
collectedAt
observedAt      -- legacy synonym
source          -- legacy string column
```

The database does **not** encode “this row came from Magnit SDK”. It stores `retailerId` + `sourceType` + `sourceName`.

## Provider tree

```
PriceProvider
 ├── MockOfficialApiProvider        (dev / contract mock)
 ├── CsvImportProvider               (open-data rows → observations)
 ├── ManualProvider                  (admin rows → observations)
 ├── OfficialApiProviderStub         (future partner APIs — register by retailer.key)
 └── RetailerParserProvider         (stub — not implemented)
```

Contract (`PriceProvider`):

- `getProducts()`
- `getPrices()` → each row includes `retailer: { key, name, type }`
- `getAvailability()`

All ingest paths call `PriceIngestionService` → `PriceIntelligenceRepository.ingestFromProvider`, which upserts `Product` + `Retailer` (by **key**) and inserts `PriceObservation`.

## Open data formats

```csv
product_name,category,brand,weight,price,retailer_key,retailer_type,retailer,date
Куриная грудка,protein,Brand,500g,299,chain_b,CHAIN,Ритейлер B,2026-07-21
```

Binary `.xlsx` is not parsed server-side; export/save as CSV or paste TSV.

## Manual admin import

```csv
product_key,name,price,retailer_key,retailer_type,retailer
chicken_breast,Куриная грудка,299,chain_c,DISCOUNTER,Ритейлер C
```

## HTTP API

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/v1/price-intelligence/sources/mock-api` | Sync mock official API |
| `POST` | `/api/v1/price-intelligence/sources/open-data` | `{ format, payload, sourceName? }` |
| `POST` | `/api/v1/price-intelligence/sources/manual` | `{ csv }` or `{ rows: [...] }` |
| `POST` | `/api/v1/price-intelligence/import` | Legacy UUID CSV |
| `GET`  | `/api/v1/price-intelligence/review` | Owner MFA review queue |

## Downstream consumers

Shopping List resolves the **latest** observation per `productId` and exposes `priceSourceName` (data channel label). Retailer display/compare uses `Retailer.id` + `Retailer.type`, not string matching on names.

## Swapping sources tomorrow

1. Official API arrives → implement provider stub for `retailer.key` — **no Shopping List change**.
2. No API → upload Excel/CSV — **no Shopping List change**.
3. Parser needed → implement `RetailerParserProvider` — **no Meal Plan / Dashboard / AI change**.
