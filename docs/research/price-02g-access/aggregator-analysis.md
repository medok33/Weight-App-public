# PRICE-02G aggregator / licensed data provider analysis

Researched 2026-08-15. Web-search level only; no paid pilots started.

## Commercial price-monitoring providers (candidate licensed sources)

| Provider | Claimed coverage | Model | Preliminary assessment |
|---|---|---|---|
| Benzup (Ctiu Retail) — https://benzup.ru/products/ctiu-retail | Магнит, Перекрёсток, Пятёрочка, by region/category | B2B subscription monitoring | Closest match to our need (regional store prices); origin of data undisclosed — provenance question must be asked before GO |
| XMLDataFeed — https://xmldatafeed.com/catalog/scraping/produkty/pyaterochka/ | Пятёрочка (and others) | Scraping-as-a-service feed (Excel/XML) | Explicitly built on scraping; redistribution/legal risk inherited from their method |
| Marketparser — https://marketparser.ru/api | marketplaces + some retailers | API subscription | Coverage of Пятёрочка/Магнит store-level prices unverified |
| PriceControl overview — https://pricecontrol.biz/servisy-monitoringa-tsen/ | meta | — | Directory of ~12 similar services; secondary candidates |
| Metacommerce offline — https://mc-offline.ru | offline shelf-price monitoring | B2B | Price-tag recognition in-store; likely enterprise-priced, not self-serve |

## Consumer promo aggregators (NOT price sources)

- SkidkaOnline, «Акции всех магазинов России» (Google Play), pepper-style apps:
  promo leaflets only; no stable SKU-level store price contract; unsuitable as a
  price API. Possible promo-conditions enrichment only.

## Official aggregate data (NOT store prices)

- X5 «Индекс Пятёрочки» — monthly aggregate price dynamics; explicitly not
  store-level current prices. Not usable for per-product budgets.

## Delivery aggregators (display prices legally)

- Яндекс Еда / СберМаркет carry Магнит/Пятёрочка/ВкусВилл catalogs for delivery
  and are official retailer partners. Prices shown are DELIVERY prices of the
  selected retailer store — usable as a legal reference channel only if the
  aggregator's terms permit programmatic access; no public API for third parties.
  Classification: RESTRICTED unless terms allow.

## Verdict

LICENSED_PROVIDER_CANDIDATES_FOUND=3 (Benzup Ctiu Retail, XMLDataFeed,
Marketparser), all requiring commercial contact and a provenance/terms check
before any use. None provides a documented self-serve store-level price API for
Москва/Ковров today. Aggregators cannot replace a direct channel; they are a
fallback if retailer outreach fails.
