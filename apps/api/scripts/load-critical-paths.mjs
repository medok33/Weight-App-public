/* eslint-env node */
/* global fetch */
/**
 * Lightweight critical-path latency probe for STEP_162.
 * Does not mutate application data.
 */
const base = process.env.API_BASE_URL ?? 'http://localhost:3001/api/v1';

async function sample(path, url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return { path, latencyMs: Date.now() - started, statusCode: response.status };
  } catch {
    return { path, latencyMs: Date.now() - started, statusCode: 0 };
  }
}

const samples = [];
for (let i = 0; i < 5; i += 1) {
  samples.push(await sample('health.live', `${base}/health/live`));
  samples.push(await sample('health.ready', `${base}/health/ready`));
}

console.info(JSON.stringify({ samples }, null, 2));
