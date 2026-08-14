#!/usr/bin/env node
// Explicit fail-closed collector skeleton: no fixture is promoted as live.
const source = 'https://5ka.ru';
try {
  const response = await fetch(`https://r.jina.ai/http://5ka.ru?price02r=${Date.now()}`, { signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  if (!response.ok || !/₽|руб|RUB/i.test(text)) throw new Error(`public source unavailable or no verified RUB price (HTTP ${response.status})`);
  throw new Error('store/SAP identity and region were not proven; refusing unbound prices');
} catch (error) { console.error(`Pyaterochka collector failed closed: ${error.message}`); process.exitCode = 1; }
export { source };
