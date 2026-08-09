#!/usr/bin/env node
/** Public CI-only validation for local/disposable Compose configuration. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const required = ['compose.yaml', 'docker/compose.local.yaml', 'docker/compose.disposable.yaml', '.env.example', 'docker/env/local.env.example'];
for (const rel of required) {
  if (!existsSync(resolve(root, rel))) throw new Error(`Missing public CI file: ${rel}`);
}
for (const rel of ['docker/compose.staging.yaml', 'docker/compose.production.yaml', 'docker/compose.prod-like.yaml']) {
  if (existsSync(resolve(root, rel))) throw new Error(`Private deployment compose must not be exported: ${rel}`);
}
for (const rel of ['.env', 'apps/api/.env', 'apps/web/.env.local', 'docker/env/staging.env', 'docker/env/production.env']) {
  if (existsSync(resolve(root, rel))) throw new Error(`Runtime environment file must not be committed: ${rel}`);
}
for (const rel of ['compose.yaml', 'docker/compose.local.yaml', 'docker/compose.disposable.yaml']) {
  const text = readFileSync(resolve(root, rel), 'utf8');
  if (/\$\{[^}]*PASSWORD[^}]*\}[^\n]*https?:\/\//i.test(text)) throw new Error(`Unexpected credential-bearing URL in ${rel}`);
}
const disposableEnv = { ...process.env, DISPOSABLE_COMPOSE_PROJECT: 'weight-app-public-validate', DISPOSABLE_RUNTIME_ID: 'public-validate', DISPOSABLE_POSTGRES_PASSWORD: 'public-validate-password', DISPOSABLE_POSTGRES_DB: 'weight_app', DISPOSABLE_POSTGRES_USER: 'weight_app', DISPOSABLE_POSTGRES_PORT: '55432', DISPOSABLE_REDIS_PORT: '56379' };
for (const [args, env] of [[['docker', 'compose', '-f', 'compose.yaml', 'config'], process.env], [['docker', 'compose', '-f', 'docker/compose.local.yaml', 'config'], process.env], [['docker', 'compose', '-f', 'docker/compose.disposable.yaml', 'config'], disposableEnv]]) {
  const result = spawnSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8', shell: false, stdio: 'pipe', env });
  if (result.status !== 0) throw new Error(`Compose config failed: ${args.join(' ')}`);
}
console.info(JSON.stringify({ ok: true, scope: 'public-local-disposable-compose' }));

