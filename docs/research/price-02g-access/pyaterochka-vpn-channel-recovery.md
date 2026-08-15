# PRICE-02G Pyaterochka VPN channel recovery

TASK_ID=PRICE-02G-PYATEROCHKA-VPN-CHANNEL-RECOVERY
DATE=2026-08-15 (02:10–02:30 UTC)

## Previous success evidence (restored context)

- Codex v2 report (worktree wt-price-02-source-acquisition-v2): «Chromium can
  load https://5ka.ru/» while Node/curl/PowerShell got HTTP 403 — browser route
  worked, Node route did not. Live Pyaterochka prices were NEVER obtained
  before (all 4 v2 runs = STORE_DISCOVERY_FAILED).
- transport.json (2026-08-14): 5ka.ru/5d.5ka.ru DNS/TCP/TLS OK, HTTP 403 body
  «Проблемы со связью. Проверьте настройки интернета и VPN».
- Conclusion: no earlier price success existed to restore; the recoverable
  precedent was the browser-route access itself.

## Route comparison (this run)

- PUBLIC_IP_COUNTRY_AND_ASN: AM / AS12297 Telecom Armenia, IP 178.160.211.148
- BROWSER_EGRESS = NODE_EGRESS = CURL_EGRESS = 178.160.211.148 (same VPN
  tunnel; no split tunneling detected; no proxy env vars)
- Node/curl direct: HTTP 403 (geo-block page)
- Browser (IAB Chromium): first load → same block page → after page reload the
  site presented its standard «Проверка браузера / Я не робот» challenge;
  owner performed the single manual checkbox (per task §9); afterwards the
  full site opened and stayed open for the whole session.

## Live proof (anonymous session, read-only, no login)

Address flow (site's own modal, Yandex-powered suggest — requires real
keystroke typing, `fill()` does not trigger suggestions):

- Москва: «Первомайская улица, 17 / Россия, Москва» → «Доставить сюда».
  Category /catalog/ovoshchi-frukty-orekhi--251C51627/ rendered store-bound
  products. Run 1 = 72 priced products (02:22:57Z), Run 2 = 24 (02:23:38Z).
- Ковров: «улица Шмидта, 14 / Россия, Владимирская область, Ковров» → same
  category re-bound. Run 1 = 24 (02:28:04Z), Run 2 = 24 (02:28:37Z).

Regional price discrimination: 18 common PLUs, 12 have different RUB prices
Москва vs Ковров (e.g. PLU 3692541 269 vs 179; 3262406 130 vs 139). Prices do
not silently transfer between cities.

sapCode: NOT_EXPOSED_IN_WEB_FLOW — the delivery web flow binds an address
(localStorage `DeliveryPanelStore`), the SAP code is only returned by
5d.5ka.ru store APIs which are geo-blocked for this exit. locationScope=
DELIVERY_ADDRESS (not STORE) is recorded per row; STORE-mode requires the
documented API route from an accepted network.

## Artifacts

.data/research/price-02g/pyaterochka/{Moscow,Kovrov}/run-{1,2}.snapshot.txt
(sanitized ARIA snapshots, address-bound headers included) and
run-{1,2}.json (normalized: plu, name, unit, currentPrice, oldPrice, RUB,
sourceRoute, observedAt, runId, unitPriceBasis).

## Caveats

- «Цена за 100 г» items are unit prices — flagged `unitPriceBasis: true`;
  must not be treated as package checkout price.
- Access depends on the once-completed browser challenge living in the
  session cookies; a fresh profile will hit the challenge again (single
  manual/owned action or the reference library's handling applies).
- Delivery-catalog prices; STORE purchase mode not separately proven.

## Verdict

PYATEROCHKA_ACCESS_ESTABLISHED=YES (browser session route, VPN on)
VPN_BROWSER_ROUTE_REPRODUCED=YES
MOSCOW: address-bound, 72/24 prices; KOVROV: address-bound, 24/24 prices
SECOND_LIVE_RUN_MOSCOW=PASS; SECOND_LIVE_RUN_KOVROV=PASS
FIXTURE_AS_LIVE=NO; SECRETS_COMMITTED=NO
FINAL_VERDICT=PRICE_02G_PYATEROCHKA_VPN_CHANNEL_RECOVERED_PASS
