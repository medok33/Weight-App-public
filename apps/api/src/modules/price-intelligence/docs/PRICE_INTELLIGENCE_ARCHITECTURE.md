# Price Intelligence Architecture

## Goal

Obtain grocery prices from **many sources** without coupling Shopping List, Dashboard, Meal Plan, or AI to any single retailer API.

Official retail APIs may never become available. The system must still work via CSV/XLSX import, manual admin, and (later) approved parsers.

## Engine diagram

```
Price Intelligence Engine
            |
            v
   RetailerPriceProvider
            |
  +---------+---------+----------+
  |         |         |          |
Official  Web      CSV/XLSX   Manual
  API    Parser    Import     Admin
```

Downstream consumers read only durable rows:

- `Product` (normalized by `product_key`)
- `PriceObservation` (price + provenance)
- `Retailer` (by `code`, not display name)

## Retailer entity

```
Retailer {
  id
  name      -- UI only ("Магнит")
  code      -- business id: MAGNIT | PYATEROCHKA | VKUSVILL | X5 | AZBUKA_VKUSA
  region    -- e.g. RU
  active
}
```

**Never** branch business logic on `name`. Use `code` / `id`.

Seeded codes: `MAGNIT`, `PYATEROCHKA`, `VKUSVILL`, `X5`, `AZBUKA_VKUSA`.

## Product normalization

Do **not** store identity as `"Куриная грудка Магнит"` or `"Chicken breast 500g"`.

```
Product {
  id
  product_key   -- chicken_breast
  name          -- display: Куриная грудка
  category
  unit
  weight
}
```

Retailer affiliation belongs on `PriceObservation.retailerId`, not in the product key.

## PriceObservation

```
PriceObservation {
  productId
  retailerId
  price
  currency
  sourceType    -- API | PARSER | CSV | MANUAL
  sourceName    -- "Импорт CSV" | "Магнит каталог" | …
  collectedAt
}
```

Example: product `chicken_breast`, retailer `MAGNIT`, price `299 RUB`, sourceType `CSV`, sourceName `Импорт CSV`.

## RetailerPriceProvider interface

```ts
interface RetailerPriceProvider {
  providerId: string;
  sourceType: 'API' | 'PARSER' | 'CSV' | 'MANUAL';
  sourceName: string;
  retailerCode: string;

  syncCategories(): Promise<…>;
  syncProducts(): Promise<…>;
  syncPrices(): Promise<…>;
  syncAvailability(): Promise<…>;
}
```

### Implementations

| Provider | Status |
|----------|--------|
| `CsvRetailerPriceProvider` | **Implemented** (architecture proving path) |
| `ManualRetailerPriceProvider` | Implemented |
| `MagnitParserProvider` | Stub only — no scraping |
| `PyaterochkaParserProvider` | Stub only — no scraping |
| `OfficialRetailerApiProviderStub` | Stub for future partner APIs |

## CSV catalog format (first provider)

```csv
product_key,name,category,weight,price,retailer
chicken_breast,Куриная грудка,protein,500g,299,Магнит
```

Optional: `retailer_code` (e.g. `MAGNIT`), `unit`, `currency`, `date`.

API: `POST /api/v1/price-intelligence/sources/catalog-csv`

After sync: upsert `Product` by `product_key`, upsert `Retailer` by `code`, insert `PriceObservation`.

## Adding a new store

1. Insert/activate `Retailer` with unique `code` (e.g. `LENTA`).
2. Implement `RetailerPriceProvider` (API or Parser or CSV feed).
3. Call `PriceIntelligenceEngine.syncProvider(provider)`.
4. **No changes** to Shopping List / Dashboard / Meal Plan / AI.

## API vs Parser vs Import

| Source | When to use | `sourceType` |
|--------|-------------|--------------|
| Official API | Partner gives documented feed | `API` |
| Web Parser | Legal approval + dedicated provider | `PARSER` |
| CSV/XLSX | Admin/open data, no API | `CSV` |
| Manual | One-off corrections | `MANUAL` |

Shopping List shows: product, store (`Retailer.name`), price, source (`sourceName`).

## Explicitly out of scope now

- Real Magnit / Pyaterochka HTML parsers
- Circumventing site protections
- Production scraping jobs

## Admin layer (2026-07-21)

Administrative management is exposed via `/price-intelligence/admin/*` endpoints and the web UI at `/price-intelligence`.

- **Retailers**: list, toggle `active`, edit `region` — business logic uses `code`, not display `name`.
- **Products**: CRUD with `productKey`, `category`, `unit`, `weight`.
- **Observations**: append-only history with `sourceType`, `sourceName`, `collectedAt`, `retailerId`.
- **CSV import**: `validateCsvCatalog()` returns column/row errors; `syncCsvCatalog()` returns `ImportReport` with `productsCreated`, `productsUpdated`, `pricesImported`.

Future providers (official API, web parser, external price DB) implement `RetailerPriceProvider` — no UI or Shopping List changes required.

