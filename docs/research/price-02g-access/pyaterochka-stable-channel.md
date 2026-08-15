# PRICE-02G Pyaterochka stable channel research

TASK_ID=PRICE-02G-PYATEROCHKA-STABLE-CHANNEL-RESEARCH (+ RU-native IPv4 correction)
DATE=2026-08-15, 02:35–03:30 UTC
START_HEAD=a27f152 (branch price/02g-access-research)

## Network topology (verified, not assumed)

- VPN: ZoogVPN TUN (was ifIndex 39) hijacking traffic via 0.0.0.0/1 +
  128.0.0.0/1 → 10.20.100.113; egress 178.160.211.148 (Yerevan, AM, AS12297).
- Physical: Ethernet ifIndex 15, 192.168.50.93/24, gateway 192.168.50.1,
  native Russian egress 176.112.71.211 (Kovrov, RU).
- No split tunneling initially; browser/node/curl all egressed via AM.
- Temporary /32 host routes added (elevated, only these two):
  91.221.164.42 (5ka.ru & 5d.5ka.ru) and 193.232.108.28 (api.5ka.ru)
  → 192.168.50.1 if 15. Both removed in cleanup; confirmed gone.

## Channel matrix (result per class)

A. Official API/data feed: none public (X5 has no public developer price API;
   Service_connect@x5.ru outreach remains the official door). NOT_FOUND.
B. Anonymous frontend API (Node): 5d.5ka.ru returns 403 even from RU IPv4
   with browser UA — gated by JS-challenge cookie (servicepipe.tech), not
   by geo. Node-only collection NOT FEASIBLE without a browser-emulated
   bootstrap. Geocode endpoint: HTTP 307/403 similarly gated.
C. Stable anonymous browser session: WORKS WITHOUT CAPTCHA over RU native
   IPv4 → PRIMARY candidate (proof below).
D. Official mobile/delivery flow public endpoints: same hosts as B; same
   gating. NOT FEASIBLE headless.
E. Licensed providers: documented earlier (Benzup/XMLDataFeed/Marketparser);
   unchanged; fallback only.

## Why RU route removes CAPTCHA (A/B comparison)

| Path | Egress | 5ka.ru bare curl | Browser | CAPTCHA | 5d API from Node |
|---|---|---|---|---|---|
| AM VPN (baseline) | 178.160.211.148 AM | 403 block page | block page → challenge after reload | YES («Я не робот», 1 manual pass) | 403 |
| RU native /32 | 176.112.71.211 RU | 403 (JS-challenge shell) | FULL SITE, no challenge, session persists | NO across all runs | 403 (cookie-gated) |

Root cause refined: the «geo-block» was two layers — (1) IP-country filter
(non-RU gets hard block page + CAPTCHA), (2) JS-challenge cookie gating the
API/5d endpoints regardless of country. RU IPv4 removes layer 1 entirely for
the browser flow.

## Stability proof (PRIMARY candidate, all runs anonymous, no manual action)

All runs: category /catalog/ovoshchi-frukty-orekhi--251C51627/, ≥20 priced
products required, persistent anonymous browser profile, CAPTCHA never shown.

| Run | Context | Products | observedAt (UTC) |
|---|---|---|---|
| Moscow 1 | Москва, Первомайская ул. 17 | 24 | 02:47:30 |
| Kovrov 1 (after М→К switch) | Ковров, ул. Шмидта 14 | 24 | 02:51:20 |
| Moscow 2 (К→М switch) | Москва | 24 | 03:00:00 |
| Moscow 3 (new tab, ~3 min interval) | Москва | 24 | 03:03:55 |
| Kovrov 2 (after pause+fresh tab) | Ковров | 24 | 03:24:47 |
| Kovrov 3 (~3 min interval, same session) | Ковров | 24 | 03:29:17 |

Switching М→К→М proven. Regional isolation: common PLUs across M1/K1 →
different prices per region (3/5 differ on the 24-item overlap; earlier
72-item overlap: 12/18 differ). FIXTURE_AS_LIVE=NO throughout.

Session behavior: profile/session survives tab switches and ~3-minute
intervals. Address-change button became unresponsive for ~10 minutes after
several rapid address switches (rate-shaped UI), recovered after pause +
fresh tab — collector must space address switches and treat this state as a
retryable condition, not an error.

sapCode: still not exposed in web flow (localStorage read blocked by sandbox;
5d API cookie-gated). locationScope=DELIVERY_ADDRESS on all rows.

## Reproducible collector contract (research-grade)

1. Ensure RU IPv4 egress for 5ka hosts (/32 routes via physical gateway, or
   native connection); VERIFY egress country=Russia before collecting;
   fail-closed otherwise.
2. Browser (persistent anonymous profile) → open https://5ka.ru/ (no
   challenge expected on RU egress; if challenge appears → MANUAL_BOOTSTRAP_
   REQUIRED status).
3. Address modal: click header address (multi-point click; may need retries),
   type address with real keystrokes (fill() does not trigger Yandex
   suggest), pick first region-matching suggestion, «Доставить сюда».
4. Navigate category, scroll-load ≥24 products, parse product links+prices.
5. Two+ runs per city, 3-min spacing; never switch address more than ~2x per
   10 minutes.
6. Cleanup: remove only self-added routes.

## Post-cleanup network state (honest drift note)

After route cleanup the ZoogVPN TUN adapter re-registered (ifIndex 39→29,
status Up) WITHOUT its /1 hijack routes; default egress is now the native RU
path (176.112.71.211). The VPN app itself was never disabled or reconfigured
by this task (only two /32 host routes were added/deleted). Owner should
re-check ZoogVPN state if Armenian egress is still desired for other traffic.

## Post-reconnect verification (VPN rotated AM→EE on its own; VPN untouched)

After cleanup the ZoogVPN client reconnected by itself (new session, ifIndex
29, exit 185.155.97.59 Tallinn/EE — the adapter and its /1 routes restored
without any intervention; the VPN was never disabled or reconfigured by this
task).

Key finding: through the EE exit the browser opens 5ka.ru with NO routes and
NO CAPTCHA (the earlier hard block page was specific to the AM exit IP
178.160.211.148). The persistent anonymous profile kept the Kovrov address
binding and returned live prices (Kovrov run-4, 12 priced products, no
challenge). Direct Node/curl API calls remain cookie-gated (403) on any exit.

Channel matrix after rotation (all verified 2026-08-15 ~06:50 UTC):

| Retailer | Channel | Status now |
|---|---|---|
| Pyaterochka | browser + RU /32 route | PASS (6/6 canonical runs) |
| Pyaterochka | browser, EE VPN exit, no routes | PASS (no CAPTCHA; run-4) |
| Magnit | r.jina.ai + shopCode cookie | PASS (200; 32 products; «г Ковров, пр-кт Ленина, д 29») |
| Yarche | direct SSR catalog | PASS (200; RUB prices in HTML) |

Route tooling committed at tools/price-research/5ka-ru-route-setup.md
(idempotent add/remove /32 scripts, re-resolving A-records). Non-persistent
routes: re-run setup after reboot; needed only when the current VPN exit hits
the hard block page.

## Verdict

PRIMARY_CHANNEL=anonymous browser collector (persistent profile) — RU /32
route when the VPN exit is hard-blocked, any exit otherwise; NO manual action
in 7/7 post-bootstrap runs
SECONDARY_CHANNEL=Magnit-style text-proxy transport (works from any exit)
OPERATOR_FALLBACK=manual CAPTCHA bootstrap (only if a fresh profile meets the
hard block page)
MOSCOW_RUNS=3/3 PASS; KOVROV_RUNS=3/3 PASS (+1 bonus cross-exit run);
LIVE_PRICE_COUNT_PER_RUN=24 (canonical runs)
REGIONAL_ISOLATION=PASS; NEW_SESSION(new tab)=PASS; TIME_INTERVAL=PASS
COLLECTOR_RESTART(same profile, new tab/process)=PASS
CAPTCHA_FIRST_RUN=NO; CAPTCHA_EVERY_RUN=NO (7/7 after bootstrap)
REPRODUCIBLE_COLLECTOR=YES (contract + route tooling); SECRETS_COMMITTED=NO;
PURCHASES=0; MUTATING_CALLS=0; REAL_RETAILER_REQUESTS≈55
VPN_PRESERVED=YES (owner directive honored: VPN app untouched, only two /32
host routes added/removed; VPN self-rotated AM→EE and stayed functional)
FINAL_VERDICT=PRICE_02G_PYATEROCHKA_STABLE_CHANNEL_PASS
