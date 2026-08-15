# 5ka.ru RU-native route management (PRICE-02G stable channel)

Purpose: keep Pyaterochka hosts (5ka.ru, 5d.5ka.ru, api.5ka.ru) on the
owner's native Russian IPv4 while the ZoogVPN tunnel stays enabled for all
other traffic. Research-only tooling; nothing here reconfigures the VPN.

## ensure-5ka-ru-route.ps1

```powershell
# Run elevated (UAC). Adds /32 host routes for the current A-records of the
# three 5ka hosts via the physical gateway. Idempotent: deletes then re-adds.
$gw = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -eq "Ethernet" } | Select-Object -First 1).NextHop
if (-not $gw) { throw "physical gateway not found" }
$if = (Get-NetAdapter -Name "Ethernet").ifIndex
$hosts = "5ka.ru", "5d.5ka.ru", "api.5ka.ru"
foreach ($h in $hosts) {
  $ips = (Resolve-DnsName $h -Type A | Where-Object {$_.IPAddress}).IPAddress
  foreach ($ip in ($ips | Select-Object -Unique)) {
    route delete $ip 2>$null | Out-Null
    route add $ip mask 255.255.255.255 $gw metric 1 if $if | Out-Null
    "routed $h -> $ip via $gw (if $if)"
  }
}
```

## remove-5ka-ru-route.ps1

```powershell
# Run elevated. Removes /32 routes for the current retailer A-records.
# LIMITATION: this helper does not persist a per-session route marker; review
# the route table before cleanup if another route for the same address may
# pre-exist. Research/operator tooling only.
$hosts = "5ka.ru", "5d.5ka.ru", "api.5ka.ru"
foreach ($h in $hosts) {
  $ips = (Resolve-DnsName $h -Type A | Where-Object {$_.IPAddress}).IPAddress
  foreach ($ip in ($ips | Select-Object -Unique)) { route delete $ip 2>$null | Out-Null; "removed $ip" }
}
```

Notes:
- A-records observed 2026-08-15: 5ka.ru=91.221.164.42, 5d.5ka.ru=91.221.164.42,
  api.5ka.ru=193.232.108.28. The script re-resolves, so CDN changes are handled.
- Routes are non-persistent (lost on reboot) — re-run the setup script after
  reboot if the channel is needed.
- If the physical LAN changes (different gateway), re-run setup; stale routes
  via an unreachable gateway break only these three hosts.
