#!/usr/bin/env node
// Delivery catalog may expose prices, but this PoC refuses them without store identity.
const source = 'https://yarcheplus.ru/';
try {
  const response = await fetch(`https://r.jina.ai/http://yarcheplus.ru/?price02r=${Date.now()}`, { signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  if (!response.ok || !/₽|руб|RUB/i.test(text)) throw new Error(`public source unavailable or no verified RUB price (HTTP ${response.status})`);
  throw new Error('city/store selection was not proven; refusing regional price attribution');
} catch (error) { console.error(`Yarche collector failed closed: ${error.message}`); process.exitCode = 1; }
export { source };
