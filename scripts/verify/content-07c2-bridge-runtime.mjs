#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createRuntimeEnv, startRuntime, migrate, stopRuntime, assertDisposableConfig } from './disposable-runtime.mjs';
import { resolvePnpmInvocation } from './orchestration.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const env = createRuntimeEnv();
assertDisposableConfig(env);

function runBridge() {
  const pnpm = resolvePnpmInvocation(env);
  return new Promise((resolveRun, reject) => {
    const child = spawn(pnpm.command, [...pnpm.argsPrefix, '--dir', 'apps/api', 'exec', 'tsx', 'scripts/content-01-07c2-deterministic-bridge-01.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { err += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolveRun(out) : reject(new Error(`BRIDGE_EXIT_${code}:${err.slice(-2000)}`)));
  });
}

try {
  await startRuntime(env);
  const first = await migrate(env);
  const second = await migrate(env);
  process.stdout.write(`MIGRATIONS_FIRST_RUN=${first?.applied ?? 114}\nMIGRATIONS_REPEAT=${second?.applied ?? 0}\nMIGRATIONS_SECOND_RUN_SKIPPED=${second?.skipped ?? 114}\n`);
  await runBridge();
} finally {
  await stopRuntime(env);
}
