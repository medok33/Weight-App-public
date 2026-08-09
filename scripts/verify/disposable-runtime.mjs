#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import {
  RESULT,
  createInventory,
  redactText,
  resolvePnpmInvocation,
  runBoundedProcess,
  runStage,
  runStagePlan,
  terminateProcessTree,
} from './orchestration.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const composeFile = resolve(root, 'docker/compose.disposable.yaml');
const RUNTIME_ENV = 'WEIGHT_APP_DISPOSABLE_MODE';
const RUNTIME_ID_ENV = 'WEIGHT_APP_RUNTIME_ID';
const REDIS_MARKER = 'weight-app:disposable:runtime-id';
const SAFE_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const STAGE_BOUNDS = Object.freeze({
  topology: 120_000,
  markers: 30_000,
  migration: 180_000,
  static: 300_000,
  apiUnit: 300_000,
  // Measured pre-optimization run reached file 65 at 25m; template-clone harness removes
  // 48 repeated full migrations. Keep a finite 30m bound with margin for cold Windows I/O.
  apiPersistence: 1_800_000,
  web: 600_000,
  worker: 180_000,
  userSmoke: 300_000,
  workoutE2E: 600_000,
  activityE2E: 600_000,
  providerSafety: 30_000,
  content: 120_000,
  cleanup: 120_000,
});

export function isTrue(value) {
  return value === '1' || value === 'true';
}

export function assertRuntimeId(runtimeId) {
  if (!/^wa-[a-z0-9-]{8,80}$/.test(runtimeId ?? '')) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:RUNTIME_ID_INVALID');
  }
  return runtimeId;
}

export function parseDatabaseUrl(value) {
  if (!value) throw new Error('UNSAFE_DISPOSABLE_RUNTIME:DATABASE_URL_MISSING');
  let url;
  try { url = new URL(value); } catch { throw new Error('UNSAFE_DISPOSABLE_RUNTIME:DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:DATABASE_URL_NOT_POSTGRES');
  }
  if (!url.hostname || !SAFE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:POSTGRES_HOST_NOT_LOCAL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, '').split('/')[0] ?? '');
  if (!database) throw new Error('UNSAFE_DISPOSABLE_RUNTIME:DATABASE_NAME_EMPTY');
  return { url, host: url.hostname.toLowerCase(), port: Number(url.port || 5432), database };
}

export function parseRedisUrl(value) {
  if (!value) throw new Error('UNSAFE_DISPOSABLE_RUNTIME:REDIS_URL_MISSING');
  let url;
  try { url = new URL(value); } catch { throw new Error('UNSAFE_DISPOSABLE_RUNTIME:REDIS_URL_INVALID'); }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:REDIS_URL_INVALID');
  }
  if (url.protocol === 'rediss:' || !url.hostname || !SAFE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:REDIS_HOST_NOT_LOCAL');
  }
  return { url, host: url.hostname.toLowerCase(), port: Number(url.port || 6379) };
}

export function assertDisposableConfig(env = process.env) {
  if (!isTrue(env[RUNTIME_ENV])) throw new Error('UNSAFE_DISPOSABLE_RUNTIME:DISPOSABLE_MODE_REQUIRED');
  const runtimeId = assertRuntimeId(env[RUNTIME_ID_ENV]);
  const postgres = parseDatabaseUrl(env.DATABASE_URL);
  const redis = parseRedisUrl(env.REDIS_URL);
  const expectedDb = `weight_app_disposable_${runtimeId.slice(3).replaceAll('-', '_')}`;
  if (postgres.database !== expectedDb) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:POSTGRES_DATABASE_IDENTITY_MISMATCH');
  }
  if (env.DISPOSABLE_POSTGRES_MARKER !== runtimeId) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:POSTGRES_SERVER_MARKER_REQUIRED');
  }
  if (env.DISPOSABLE_REDIS_MARKER !== runtimeId) {
    throw new Error('UNSAFE_DISPOSABLE_RUNTIME:REDIS_SERVER_MARKER_REQUIRED');
  }
  return { runtimeId, postgres, redis };
}

export function redactConnection(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = url.username ? '<redacted>' : '';
    url.password = url.password ? '<redacted>' : '';
    return url.toString();
  } catch { return '<redacted-invalid-url>'; }
}

export function diagnostics(env = process.env, extra = {}) {
  let config;
  let error;
  try { config = assertDisposableConfig(env); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return {
    disposableMode: isTrue(env[RUNTIME_ENV]) ? 'YES' : 'NO',
    runtimeId: env[RUNTIME_ID_ENV] ?? null,
    postgres: config ? { host: config.postgres.host, port: config.postgres.port, database: config.postgres.database, serverMarkerValid: env.DISPOSABLE_POSTGRES_MARKER === config.runtimeId } : { serverMarkerValid: 'NO' },
    redis: config ? { host: config.redis.host, port: config.redis.port, serverMarkerValid: env.DISPOSABLE_REDIS_MARKER === config.runtimeId } : { serverMarkerValid: 'NO' },
    databaseUrl: redactConnection(env.DATABASE_URL),
    redisUrl: redactConnection(env.REDIS_URL),
    error: error ?? null,
    ...extra,
  };
}

export function isTransientMarkerProbeError(error) {
  const message = String(error instanceof Error ? error.message : error ?? '').toLowerCase();
  return /connection refused|could not connect|connection to server|database system is starting up|database system is shutting down|no such container|container .* is not running|relation .* does not exist|schema .* does not exist/.test(message);
}

export function classifyMarkerValue(value, expectedRuntimeId, markerName) {
  const marker = String(value ?? '').trim();
  if (!marker || marker === '(nil)') return { state: 'transient-absent' };
  if (marker !== expectedRuntimeId) {
    throw new Error(`UNSAFE_DISPOSABLE_RUNTIME:${markerName}_IDENTITY_MISMATCH`);
  }
  return { state: 'valid' };
}

function run(command, args, env = process.env, options = {}) {
  let actualCommand = command;
  let actualArgs = args;
  if (process.platform === 'win32' && command === 'pnpm') {
    const pnpmCmd = execFileSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (!pnpmCmd) throw new Error('PNPM_EXECUTABLE_NOT_FOUND');
    actualCommand = process.execPath;
    actualArgs = [resolve(dirname(pnpmCmd), 'node_modules/pnpm/bin/pnpm.mjs'), ...args];
  }
  const stdio = options.stdio ?? (command === 'pnpm' ? 'pipe' : 'inherit');
  const result = spawnSync(actualCommand, actualArgs, { cwd: root, env, stdio, encoding: 'utf8', timeout: options.timeoutMs, killSignal: 'SIGTERM' });
  if (command === 'pnpm' && result.stdout) process.stdout.write(result.stdout);
  if (command === 'pnpm' && result.stderr) process.stderr.write(result.stderr);
  if (options.allowFailure) return result;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${actualCommand} ${actualArgs.join(' ')} failed with ${result.status ?? 1}`);
  return result;
}

function listTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTestFiles(path);
    return /\.(spec|test)\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  }).sort();
}

async function diagnoseApi(env, onlyGroup) {
  const apiRoot = resolve(root, 'apps/api');
  const files = listTestFiles(apiRoot);
  const groups = new Map();
  for (const file of files) {
    const relativePath = relative(apiRoot, file);
    const parts = relativePath.split('\\');
    const name = parts[0] === 'src' && parts[1] === 'modules' ? `src-${parts[2] ?? 'root'}` : `${parts[0]}-${parts[1] ?? 'root'}`;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(file);
  }
  for (const [name, groupFiles] of groups) {
    const databaseBatchRequest = onlyGroup?.match(/^test-database-(\d\d)$/);
    if (onlyGroup && name !== onlyGroup && !name.startsWith(`${onlyGroup}-`) && !(name === 'test-database' && databaseBatchRequest)) continue;
    const selectedFiles = databaseBatchRequest ? groupFiles.slice((Number(databaseBatchRequest[1]) - 1) * 10, Number(databaseBatchRequest[1]) * 10) : groupFiles;
    if (!selectedFiles.length) continue;
    const batches = name === 'test-database' ? Array.from({ length: Math.ceil(selectedFiles.length / (databaseBatchRequest ? 1 : 10)) }, (_, index) => selectedFiles.slice(index * (databaseBatchRequest ? 1 : 10), (index + 1) * (databaseBatchRequest ? 1 : 10))) : [selectedFiles];
    for (const [batchIndex, batchFiles] of batches.entries()) {
      const batchName = databaseBatchRequest ? `${onlyGroup}-${String(batchIndex + 1).padStart(2, '0')}` : batches.length > 1 ? `${name}-${String(batchIndex + 1).padStart(2, '0')}` : name;
      const started = Date.now();
      console.log(`API_GROUP_START ${new Date().toISOString()} ${batchName} files=${batchFiles.length}`);
      const relativeFiles = batchFiles.map((file) => relative(apiRoot, file));
      const longPersistenceFile = relativeFiles.length === 1 && /^(?:test\\database\\activity-01[ab][^\\]*|test\\database\\workout-adaptation[^\\]*)\.spec\.ts$/.test(relativeFiles[0]);
      const timeoutMs = longPersistenceFile ? 300000 : 120000;
      const result = run('pnpm', ['--dir', 'apps/api', 'exec', 'vitest', 'run', '--passWithNoTests', '--pool=forks', '--fileParallelism=false', '--reporter=verbose', ...relativeFiles], env, { stdio: 'inherit', timeoutMs, allowFailure: true });
      const elapsed = Date.now() - started;
      const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`;
      process.stdout.write(output);
      const lastFile = [...output.matchAll(/(?:FAIL|PASS|✓)\s+[^\r\n]*([\\/][^\r\n]*\.(?:spec|test)\.[^\r\n]*)/g)].at(-1)?.[1] ?? relativeFiles.at(-1) ?? 'unknown';
      const timedOut = result?.error?.code === 'ETIMEDOUT';
      console.log(`API_GROUP_RESULT ${batchName} count=${batchFiles.length} elapsedMs=${elapsed} pass=${timedOut ? 'NO' : result?.status === 0 ? 'YES' : 'NO'} fail=${timedOut ? 'UNKNOWN' : result?.status === 0 ? 'NO' : 'YES'} timeout=${timedOut ? 'YES' : 'NO'} lastFile=${lastFile}`);
      if (timedOut || result?.status !== 0) throw new Error(`API_GROUP_FAILED:${batchName}`);
    }
  }
}

function docker(args, env, options) { run('docker', ['compose', '-p', env.DISPOSABLE_COMPOSE_PROJECT, '-f', composeFile, ...args], env, options); }

function dockerOutput(args, env) {
  const result = spawnSync('docker', ['compose', '-p', env.DISPOSABLE_COMPOSE_PROJECT, '-f', composeFile, ...args], { cwd: root, env, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed with ${result.status ?? 1}: ${String(result.stderr ?? '').trim()}`);
  return String(result.stdout ?? '').trim();
}

async function assertServerMarkers(env) {
  assertDisposableConfig(env);
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const postgresMarker = dockerOutput(['exec', '-T', 'postgres', 'psql', '-U', env.DISPOSABLE_POSTGRES_USER, '-d', env.DISPOSABLE_POSTGRES_DB, '-A', '-t', '-c', "SELECT runtime_id FROM weight_app_runtime_metadata.runtime_identity WHERE marker_name = 'postgres-disposable-runtime'"], env);
      classifyMarkerValue(postgresMarker, env.DISPOSABLE_RUNTIME_ID, 'POSTGRES_SERVER_MARKER');
      const redisMarker = dockerOutput(['exec', '-T', 'redis', 'redis-cli', 'GET', REDIS_MARKER], env);
      classifyMarkerValue(redisMarker, env.DISPOSABLE_RUNTIME_ID, 'REDIS_SERVER_MARKER');
      return;
    } catch (error) {
      if (error instanceof Error && /IDENTITY_MISMATCH/.test(error.message)) throw error;
      if (!isTransientMarkerProbeError(error)) throw error;
      lastError = error;
    }
    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 500));
  }
  throw lastError ?? new Error('UNSAFE_DISPOSABLE_RUNTIME:SERVER_MARKER_INVALID');
}

function choosePort(start) {
  for (let port = start; port < start + 1000; port += 1) {
    try {
      if (process.platform === 'win32') {
        execFileSync('powershell.exe', ['-NoProfile', '-Command', `if ((Test-NetConnection -ComputerName 127.0.0.1 -Port ${port} -InformationLevel Quiet).TcpTestSucceeded) { exit 1 } else { exit 0 }`], { stdio: 'ignore' });
      } else {
        execFileSync('sh', ['-c', `if command -v nc >/dev/null && nc -z 127.0.0.1 ${port}; then exit 1; else exit 0; fi`], { stdio: 'ignore' });
      }
      return port;
    } catch { /* try next */ }
  }
  throw new Error('DISPOSABLE_RUNTIME_NO_FREE_PORT');
}

export function createRuntimeEnv() {
  const runtimeId = `wa-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
  const suffix = runtimeId.slice(3).replaceAll('-', '_');
  const password = `test-${randomBytes(18).toString('hex')}`;
  const pgPort = choosePort(55432);
  const redisPort = choosePort(56379);
  const apiPort = '33001';
  const webPort = '33000';
  const apiBaseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const browserApiBaseUrl = `http://localhost:${apiPort}/api/v1`;
  const webBaseUrl = `http://localhost:${webPort}`;
  const env = {
    ...process.env,
    [RUNTIME_ENV]: '1',
    WEIGHT_APP_DISPOSABLE_TEST_DB: '1',
    [RUNTIME_ID_ENV]: runtimeId,
    DISPOSABLE_RUNTIME_ID: runtimeId,
    DISPOSABLE_COMPOSE_PROJECT: `weight-app-disposable-${runtimeId}`,
    DISPOSABLE_POSTGRES_DB: `weight_app_disposable_${suffix}`,
    DISPOSABLE_CATALOG_TEMPLATE_DATABASE: `wt_cat_${suffix}_template`,
    DISPOSABLE_POSTGRES_USER: 'weight_app_disposable',
    DISPOSABLE_POSTGRES_PASSWORD: password,
    DISPOSABLE_POSTGRES_PORT: String(pgPort),
    DISPOSABLE_REDIS_PORT: String(redisPort),
    DISPOSABLE_POSTGRES_MARKER: runtimeId,
    DISPOSABLE_REDIS_MARKER: runtimeId,
    DATABASE_URL: `postgresql://weight_app_disposable:${encodeURIComponent(password)}@127.0.0.1:${pgPort}/weight_app_disposable_${suffix}`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    AI_PROVIDER: 'local',
    OPENAI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    AI_DEEPSEEK_API_KEY: '',
    IMAGE_PROVIDER: 'disabled',
    EXERCISE_MEDIA_GENERATION_ENABLED: 'false',
    RETAILER_PROVIDER: 'disabled',
    OFFICIAL_RETAILER_FEED_ENABLED: 'false',
    ALLOW_OPEN_PRICE_INGEST: '0',
    PAYMENT_PROVIDER: 'mock',
    EMAIL_PROVIDER: 'disabled',
    NOTIFICATION_PROVIDER: 'disabled',
    OWNER_BOOTSTRAP_ENABLED: 'false',
    AUTH_SESSION_SECRET: `test-${randomBytes(24).toString('hex')}`,
    AUTH_REFRESH_SECRET: `test-${randomBytes(24).toString('hex')}`,
    AUTH_ABUSE_HASH_SECRET: `test-${randomBytes(24).toString('hex')}`,
    PLAN_REVISION_CONFIRMATION_SECRET: `test-${randomBytes(24).toString('hex')}`,
    EXPORT_SIGNING_SECRET: `test-${randomBytes(24).toString('hex')}`,
    AUTH_MFA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    DISPOSABLE_API_PORT: apiPort,
    DISPOSABLE_WEB_PORT: webPort,
    NEXT_PUBLIC_API_BASE_URL: browserApiBaseUrl,
    INTERNAL_API_BASE_URL: apiBaseUrl,
    API_BASE_URL: apiBaseUrl,
    WEB_BASE_URL: webBaseUrl,
    E2E_WEB_ORIGIN: webBaseUrl,
    WEIGHT_APP_DIAGNOSTIC_PROGRESS: '1',
  };
  return env;
}

function setRedisMarker(env) {
  docker(['exec', '-T', 'redis', 'redis-cli', 'SET', REDIS_MARKER, env.DISPOSABLE_RUNTIME_ID], env);
}

export async function startRuntime(env = createRuntimeEnv()) {
  docker(['up', '-d', '--wait', 'postgres', 'redis'], env);
  setRedisMarker(env);
  await assertServerMarkers(env);
  return env;
}

export function stopRuntime(env) {
  assertDisposableConfig(env);
  docker(['down', '-v', '--remove-orphans'], env);
}

export async function migrate(env) {
  assertDisposableConfig(env);
  await assertServerMarkers(env);
  run('pnpm', ['db:migrate'], env);
}

export async function fullVerify(env) {
  assertDisposableConfig(env);
  await migrate(env);
  await migrate(env);
  run('pnpm', ['verify'], env);
}

function pnpmCommand(args, env, timeoutMs, label) {
  const runner = resolvePnpmInvocation(env);
  return runBoundedProcess(runner.command, [...runner.argsPrefix, ...args], {
    cwd: root,
    env,
    timeoutMs,
    label,
  });
}

async function preparePersistenceTemplate(env) {
  assertDisposableConfig(env);
  const expectedTemplate = `wt_cat_${env.WEIGHT_APP_RUNTIME_ID.slice(3).replaceAll('-', '_')}_template`;
  if (env.DISPOSABLE_CATALOG_TEMPLATE_DATABASE !== expectedTemplate) {
    return { exitCode: 1, reason: 'UNSAFE_DATABASE_TARGET:CATALOG_TEMPLATE_NAME_INVALID' };
  }
  return runBoundedProcess('docker', [
    'compose', '-p', env.DISPOSABLE_COMPOSE_PROJECT, '-f', composeFile,
    'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', env.DISPOSABLE_POSTGRES_USER, '-d', 'postgres', '-c',
    `CREATE DATABASE "${env.DISPOSABLE_CATALOG_TEMPLATE_DATABASE}" TEMPLATE "${env.DISPOSABLE_POSTGRES_DB}"`,
  ], {
    cwd: root,
    env,
    timeoutMs: STAGE_BOUNDS.migration,
    label: 'persistence runtime template preparation',
  });
}

function databaseUrlFor(databaseUrl, database) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function persistenceDatabaseCommand(env, sql, timeoutMs, label) {
  return runBoundedProcess('docker', [
    'compose', '-p', env.DISPOSABLE_COMPOSE_PROJECT, '-f', composeFile,
    'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', env.DISPOSABLE_POSTGRES_USER, '-d', 'postgres', '-c', sql,
  ], { cwd: root, env, timeoutMs, label });
}

const PUBLIC_NOT_APPLICABLE_PERSISTENCE_TESTS = new Map([
  ['test/database/owner-mfa.persistence.spec.ts', 'PRIVATE_OPERATIONAL_DEPENDENCY_EXCLUDED_FROM_PUBLIC_REPOSITORY'],
]);
const PUBLIC_NOT_APPLICABLE_DEPLOYMENT_TESTS = [
  { file: 'apps/web/src/lib/__tests__/deploy-01b-docker-contract.spec.ts', test: 'prod-like compose has no app source mounts and orders migrate before api' },
  { file: 'apps/web/src/lib/__tests__/deploy-01b-docker-contract.spec.ts', test: 'staging and production require immutable images in compose files' },
  { file: 'apps/web/src/lib/__tests__/deploy-01c-environment-contract.spec.ts', test: 'documents separate compose project names' },
  { file: 'apps/web/src/lib/__tests__/deploy-01c-environment-contract.spec.ts', test: 'keeps INTERNAL_API_BASE_URL out of private env templates' },
  { file: 'apps/web/src/lib/__tests__/deploy-01d-workflow-contract.spec.ts', test: 'publishes only from release workflow with lowercase GHCR names' },
].map((item) => ({ ...item, result: RESULT.NOT_APPLICABLE, classification: 'PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE', reason: 'PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY' }));

async function runPersistenceSuite(env, inventory) {
  const started = Date.now();
  const template = await preparePersistenceTemplate(env);
  if (template.timedOut || template.exitCode !== 0) return template;
  const apiRoot = resolve(root, 'apps/api');
  const files = listTestFiles(resolve(apiRoot, 'test/database')).filter((file) => {
    const relativeFile = relative(apiRoot, file).replaceAll('\\', '/');
    const reason = PUBLIC_NOT_APPLICABLE_PERSISTENCE_TESTS.get(relativeFile);
    if (!reason) return true;
    inventory.publicNotApplicableTests ??= [];
    inventory.publicNotApplicableTests.push({ file: relativeFile, result: RESULT.NOT_APPLICABLE, reason });
    process.stdout.write(`PERSISTENCE_TEST_NOT_APPLICABLE ${JSON.stringify({ file: relativeFile, result: RESULT.NOT_APPLICABLE, reason })}\n`);
    return false;
  });
  const runtimeSuffix = env.DISPOSABLE_RUNTIME_ID.slice(3).replaceAll('-', '_');
  for (const [index, file] of files.entries()) {
    const relativeFile = relative(apiRoot, file).replaceAll('\\', '/');
    const database = `wt_cat_${runtimeSuffix}_f${String(index + 1).padStart(2, '0')}`;
    const elapsed = Date.now() - started;
    const remaining = STAGE_BOUNDS.apiPersistence - elapsed;
    if (remaining <= 0) return { exitCode: 124, timedOut: true, lastProgress: `PERSISTENCE_FILE_PENDING ${relativeFile}` };
    process.stdout.write(`PERSISTENCE_FILE_START ${JSON.stringify({ index: index + 1, total: files.length, file: relativeFile, database })}\n`);
    const create = await persistenceDatabaseCommand(
      env,
      `CREATE DATABASE "${database}" TEMPLATE "${env.DISPOSABLE_CATALOG_TEMPLATE_DATABASE}"`,
      Math.min(30_000, remaining),
      `persistence clone ${relativeFile}`,
    );
    if (create.timedOut || create.exitCode !== 0) return { ...create, reason: `persistence clone failed: ${relativeFile}` };
    let result;
    let drop;
    try {
      const fileEnv = { ...env, DATABASE_URL: databaseUrlFor(env.DATABASE_URL, database) };
      const isLong = /(?:activity-01[ab]|workout-adaptation)/.test(relativeFile);
      const fileBound = isLong ? 300_000 : 120_000;
      result = await pnpmCommand([
        '--dir', 'apps/api', 'exec', 'vitest', 'run', '--passWithNoTests',
        '--pool=forks', '--fileParallelism=false', '--reporter=verbose', relativeFile,
      ], fileEnv, Math.min(fileBound, STAGE_BOUNDS.apiPersistence - (Date.now() - started)), `API persistence ${relativeFile}`);
    } finally {
      drop = await persistenceDatabaseCommand(
        env,
        `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
        30_000,
        `persistence cleanup ${relativeFile}`,
      );
    }
    if (drop?.timedOut || drop?.exitCode !== 0) return { ...drop, reason: `persistence cleanup failed: ${relativeFile}` };
    if (result.timedOut || result.exitCode !== 0) return { ...result, reason: `persistence file failed: ${relativeFile}` };
    process.stdout.write(`PERSISTENCE_FILE_END ${JSON.stringify({ index: index + 1, total: files.length, file: relativeFile, result: 'PASS', elapsedMs: result.elapsedMs })}\n`);
  }
  return { exitCode: 0, lastProgress: `PERSISTENCE_FILE_END total=${files.length}` };
}

async function commandSequence(commands, env, timeoutMs, label) {
  const started = Date.now();
  let lastProgress = null;
  let combinedOutput = '';
  for (const command of commands) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return { exitCode: 124, timedOut: true, lastProgress: lastProgress ?? `${label} exhausted its aggregate bound` };
    process.stdout.write(`VERIFY_SUBCOMMAND_START ${JSON.stringify({ stage: label, command: `pnpm ${command.join(' ')}`, remainingMs: remaining })}\n`);
    const result = await pnpmCommand(command, env, remaining, `${label}:${command.join(' ')}`);
    combinedOutput += `${result.stdout}\n${result.stderr}\n`;
    lastProgress = result.lastProgress ?? lastProgress;
    process.stdout.write(`VERIFY_SUBCOMMAND_END ${JSON.stringify({ stage: label, command: `pnpm ${command.join(' ')}`, elapsedMs: result.elapsedMs, exitCode: result.exitCode, timeout: result.timedOut })}\n`);
    if (result.timedOut || result.exitCode !== 0) {
      return {
        ...result,
        stdout: combinedOutput,
        reason: result.progressTail ?? result.lastProgress ?? `${label} failed`,
        lastProgress,
      };
    }
  }
  return { exitCode: 0, timedOut: false, elapsedMs: Date.now() - started, stdout: combinedOutput, lastProgress };
}

async function staticValidation(env) {
  const started = Date.now();
  const eslint = await runBoundedProcess(process.execPath, [resolve(root, 'node_modules/eslint/bin/eslint.js'), '.'], {
    cwd: root,
    env,
    timeoutMs: STAGE_BOUNDS.static,
    label: 'root ESLint',
  });
  if (eslint.timedOut || eslint.exitCode !== 0) return eslint;
  const remaining = Math.max(1, STAGE_BOUNDS.static - (Date.now() - started));
  return commandSequence([
    ['db:check-migrations'], ['ui:check-ru'], ['ci:validate-workflows'],
    ['--dir', 'apps/api', 'typecheck'], ['--dir', 'apps/web', 'typecheck'], ['--dir', 'apps/worker', 'typecheck'],
    ['--filter', '@weight-app/contracts', 'test'], ['--filter', '@weight-app/config', 'test'],
  ], env, remaining, 'static/type validation');
}

async function startTopology(env) {
  assertDisposableConfig(env);
  return runBoundedProcess('docker', ['compose', '-p', env.DISPOSABLE_COMPOSE_PROJECT, '-f', composeFile, 'up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'redis'], {
    cwd: root,
    env,
    timeoutMs: STAGE_BOUNDS.topology,
    label: 'disposable topology startup',
  });
}

async function verifyRuntimeMarkers(env) {
  assertDisposableConfig(env);
  setRedisMarker(env);
  await assertServerMarkers(env);
  return { exitCode: 0, reason: 'PostgreSQL and Redis runtime markers match the owned runtimeId' };
}

function startService(command, args, env, label, serviceState) {
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { label, child, lastProgress: null, exitCode: null };
  const collect = (chunk, stream) => {
    const text = redactText(chunk, env);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length) state.lastProgress = lines.at(-1).slice(0, 1000);
    stream.write(`[${label}] ${text}`);
  };
  child.stdout?.on('data', (chunk) => collect(chunk, process.stdout));
  child.stderr?.on('data', (chunk) => collect(chunk, process.stderr));
  child.on('close', (code) => { state.exitCode = code ?? 1; });
  serviceState.push(state);
  return state;
}

async function waitForUrl(url, state, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (state.exitCode != null) throw new Error(`${state.label} exited ${state.exitCode}: ${state.lastProgress ?? 'no output'}`);
    try {
      const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 500));
  }
  throw new Error(`${state.label} did not become ready: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function ensureE2EServices(env, serviceState) {
  if (serviceState.length) return { exitCode: 0, reason: 'reusing already-ready API and Web processes' };
  const apiPort = env.DISPOSABLE_API_PORT;
  const webPort = env.DISPOSABLE_WEB_PORT;
  const runtimeEnv = {
    ...env,
    PORT: apiPort,
    NODE_ENV: 'production',
    APP_ENV: 'LOCAL',
    WEB_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    INTERNAL_API_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    WEB_BASE_URL: `http://localhost:${webPort}`,
    E2E_WEB_ORIGIN: `http://localhost:${webPort}`,
  };
  const api = startService(process.execPath, [resolve(root, 'apps/api/dist/main.js')], runtimeEnv, 'api', serviceState);
  await waitForUrl(`http://127.0.0.1:${apiPort}/api/v1/health/live`, api, 90_000);
  const runner = resolvePnpmInvocation(runtimeEnv);
  const web = startService(runner.command, [...runner.argsPrefix, '--dir', 'apps/web', 'exec', 'next', 'start', '-H', '127.0.0.1', '-p', webPort], runtimeEnv, 'web', serviceState);
  await waitForUrl(`http://127.0.0.1:${webPort}/`, web, 90_000);
  Object.assign(env, runtimeEnv);
  return { exitCode: 0, reason: 'built API and Web are live on isolated loopback ports' };
}

async function stopServices(serviceState) {
  for (const state of serviceState.splice(0)) {
    terminateProcessTree(state.child.pid);
    try { state.child.kill('SIGKILL'); } catch { /* already stopped */ }
  }
}

async function cleanupOwnedRuntime(env, serviceState) {
  await stopServices(serviceState);
  const result = await runBoundedProcess('docker', ['compose', '-p', env.DISPOSABLE_COMPOSE_PROJECT, '-f', composeFile, 'down', '-v', '--remove-orphans'], {
    cwd: root,
    env,
    timeoutMs: STAGE_BOUNDS.cleanup,
    label: 'owned disposable cleanup',
  });
  if (result.timedOut || result.exitCode !== 0) return { result: result.timedOut ? RESULT.TIMEOUT : RESULT.FAIL, exitCode: result.exitCode, reason: result.lastProgress };
  const containers = spawnSync('docker', ['ps', '-a', '--filter', `label=com.weight-app.runtime-id=${env.DISPOSABLE_RUNTIME_ID}`, '-q'], { cwd: root, env, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const volumes = spawnSync('docker', ['volume', 'ls', '--filter', `name=weight-app-disposable-${env.DISPOSABLE_RUNTIME_ID}`, '-q'], { cwd: root, env, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const leftovers = `${containers.stdout ?? ''}${volumes.stdout ?? ''}`.trim();
  return leftovers
    ? { result: RESULT.FAIL, exitCode: 1, reason: `owned resources remain: ${leftovers}` }
    : { result: RESULT.PASS, exitCode: 0, reason: 'no owned containers or volumes remain' };
}

function writeInventory(inventory) {
  const directory = process.env.WEIGHT_APP_AUDIT_DIR ?? resolve(root, '.data/verification');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${inventory.runId}.json`);
  writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  process.stdout.write(`VERIFY_INVENTORY ${path}\n`);
  return path;
}

export async function canonicalFullVerify(env = createRuntimeEnv()) {
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const inventory = createInventory({ gitSha, runtimeId: env.DISPOSABLE_RUNTIME_ID });
  inventory.publicNotApplicableTests = [...PUBLIC_NOT_APPLICABLE_DEPLOYMENT_TESTS];
  const serviceState = [];
  let cleanupStage = null;
  let interrupted = false;
  const interrupt = async (signal) => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write(`VERIFY_SIGNAL ${signal}\n`);
    try {
      const result = await cleanupOwnedRuntime(env, serviceState);
      process.stderr.write(`VERIFY_SIGNAL_CLEANUP ${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stderr.write(`VERIFY_SIGNAL_CLEANUP_FAIL ${redactText(error instanceof Error ? error.message : error, env)}\n`);
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const sigint = () => { void interrupt('SIGINT'); };
  const sigterm = () => { void interrupt('SIGTERM'); };
  process.once('SIGINT', sigint);
  process.once('SIGTERM', sigterm);
  const migrationAction = (expected) => async () => {
    await assertServerMarkers(env);
    const result = await pnpmCommand(['db:migrate'], env, STAGE_BOUNDS.migration, `migration ${expected}`);
    if (result.exitCode === 0 && !result.timedOut) {
      const expectedPattern = expected === 'first'
        ? /"applied"\s*:\s*106/
        : /"applied"\s*:\s*0[\s\S]*"skipped"\s*:\s*106/;
      if (!expectedPattern.test(result.stdout)) return { ...result, exitCode: 1, reason: `migration ${expected} result did not match the required ledger counts` };
    }
    return result;
  };
  const stages = [
    { name: 'disposable topology startup', timeoutMs: STAGE_BOUNDS.topology, command: 'docker compose up -d --wait --wait-timeout 90 postgres redis', action: () => startTopology(env) },
    { name: 'PostgreSQL/Redis marker verification', timeoutMs: STAGE_BOUNDS.markers, command: 'owned marker probes', action: () => verifyRuntimeMarkers(env) },
    { name: 'migration first run', timeoutMs: STAGE_BOUNDS.migration, command: 'pnpm db:migrate (expect 106 applied)', action: migrationAction('first') },
    { name: 'migration second run', timeoutMs: STAGE_BOUNDS.migration, command: 'pnpm db:migrate (expect 0 applied / 106 skipped)', action: migrationAction('second') },
    {
      name: 'static/lint/type validation', timeoutMs: STAGE_BOUNDS.static,
      command: 'root ESLint; migration/UI/workflow checks; direct API/Web/Worker typechecks; support package tests',
      action: () => staticValidation(env),
    },
    {
      name: 'API unit/integration', timeoutMs: STAGE_BOUNDS.apiUnit,
      command: 'API build + Vitest src and non-database integration folders',
      action: () => commandSequence([
        ['--filter', 'api', 'build'],
        ['--dir', 'apps/api', 'exec', 'vitest', 'run', '--passWithNoTests', '--pool=forks', '--fileParallelism=false', '--reporter=verbose', 'src', 'test/meal-plan', 'test/payments', 'test/revision-engine'],
      ], env, STAGE_BOUNDS.apiUnit, 'API unit/integration'),
    },
    {
      name: 'API persistence', timeoutMs: STAGE_BOUNDS.apiPersistence,
      command: 'one runtime migration template; every test/database file on an isolated clone (single canonical owner)',
      action: () => runPersistenceSuite(env, inventory),
    },
    {
      name: 'web verification', timeoutMs: STAGE_BOUNDS.web,
      command: 'web Vitest + production Next build',
      action: () => commandSequence([['--filter', 'web', 'test'], ['--filter', 'web', 'build']], env, STAGE_BOUNDS.web, 'web verification'),
    },
    {
      name: 'worker verification', timeoutMs: STAGE_BOUNDS.worker,
      command: 'worker Vitest + production build',
      action: () => commandSequence([['--filter', 'worker', 'test'], ['--filter', 'worker', 'build']], env, STAGE_BOUNDS.worker, 'worker verification'),
    },
    {
      name: 'USER Runtime Smoke', timeoutMs: STAGE_BOUNDS.userSmoke,
      command: 'start built API/Web; pnpm --dir apps/web test:e2e:runtime-smoke',
      action: async () => {
        await ensureE2EServices(env, serviceState);
        return pnpmCommand(['--dir', 'apps/web', 'test:e2e:runtime-smoke'], env, STAGE_BOUNDS.userSmoke, 'USER Runtime Smoke');
      },
    },
    {
      name: 'Workout E2E', timeoutMs: STAGE_BOUNDS.workoutE2E,
      command: 'workout-v2-01c + 01d + 01e + workout-energy-01b',
      action: () => commandSequence([
        ['--dir', 'apps/web', 'test:e2e:workout-v2-01c'], ['--dir', 'apps/web', 'test:e2e:workout-v2-01d'],
        ['--dir', 'apps/web', 'test:e2e:workout-v2-01e'], ['--dir', 'apps/web', 'test:e2e:workout-energy-01b'],
      ], env, STAGE_BOUNDS.workoutE2E, 'Workout E2E'),
    },
    {
      name: 'Activity E2E', timeoutMs: STAGE_BOUNDS.activityE2E,
      command: 'pnpm --dir apps/web test:e2e:activity',
      action: () => pnpmCommand(['--dir', 'apps/web', 'test:e2e:activity'], env, STAGE_BOUNDS.activityE2E, 'Activity E2E'),
    },
    {
      name: 'browser/runtime E2E', applicable: false,
      command: null,
      notApplicableReason: 'dedicated USER Runtime Smoke, Workout E2E, and Activity E2E stages own all PLATFORM-01 browser/runtime acceptance coverage',
      action: async () => ({ exitCode: 0 }),
    },
    {
      name: 'provider-safety verification', timeoutMs: STAGE_BOUNDS.providerSafety,
      command: 'validate provider-disable environment contract',
      action: async () => {
        const safe = env.AI_PROVIDER === 'local' && env.IMAGE_PROVIDER === 'disabled' && env.RETAILER_PROVIDER === 'disabled'
          && env.PAYMENT_PROVIDER === 'mock' && env.EMAIL_PROVIDER === 'disabled' && env.NOTIFICATION_PROVIDER === 'disabled'
          && !env.OPENAI_API_KEY && !env.DEEPSEEK_API_KEY && !env.AI_DEEPSEEK_API_KEY;
        return safe ? { exitCode: 0, reason: 'all external providers disabled/local/mock and provider credentials empty' } : { exitCode: 1, reason: 'provider safety contract mismatch' };
      },
    },
    {
      name: 'content coverage/status check', timeoutMs: STAGE_BOUNDS.content,
      command: 'pnpm workout-energy:content:check',
      action: async () => {
        const result = await pnpmCommand(['workout-energy:content:check'], env, STAGE_BOUNDS.content, 'content coverage/status check');
        if (/CONTENT_COVERAGE_INCOMPLETE/.test(result.stdout + result.stderr)) result.reason = 'EXPECTED_DOMAIN_BLOCKER; PLATFORM blocker NO; owner CONTENT-01';
        return result;
      },
    },
  ];
  try {
    await runStagePlan({
      stages,
      inventory,
      cleanup: async () => {
        try {
          cleanupStage = await runStage({
            inventory,
            name: 'cleanup',
            timeoutMs: STAGE_BOUNDS.cleanup,
            command: 'stop owned API/Web; docker compose down -v --remove-orphans; verify no owned resources',
            action: async () => {
              const result = await cleanupOwnedRuntime(env, serviceState);
              return { exitCode: result.exitCode, timedOut: result.result === RESULT.TIMEOUT, reason: result.reason };
            },
          });
          return { result: cleanupStage.result, exitCode: cleanupStage.exitCode, reason: cleanupStage.reason };
        } catch (error) {
          return { result: error.timedOut ? RESULT.TIMEOUT : RESULT.FAIL, exitCode: error.exitCode ?? 1, reason: error.message };
        }
      },
    });
  } finally {
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
    writeInventory(inventory);
    process.stdout.write(`VERIFY_FINAL_INVENTORY ${JSON.stringify(inventory)}\n`);
  }
  return inventory;
}

async function main() {
  const command = process.argv[2] ?? 'diagnostics';
  if (command === 'guard-test') return run(process.execPath, ['--test', resolve(root, 'scripts/verify/disposable-runtime.spec.mjs'), resolve(root, 'scripts/verify/orchestration.spec.mjs')]);
  if (command === 'diagnostics') { console.log(JSON.stringify(diagnostics(process.env, { gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }), null, 2)); return; }
  if (command === 'up') { const env = await startRuntime(); console.log(JSON.stringify({ runtimeId: env.DISPOSABLE_RUNTIME_ID, DATABASE_URL: redactConnection(env.DATABASE_URL), REDIS_URL: redactConnection(env.REDIS_URL) }, null, 2)); return; }
  if (command === 'full') {
    const env = createRuntimeEnv();
    await canonicalFullVerify(env);
    return;
  }
  if (command === 'api-diagnose') {
    const env = createRuntimeEnv();
    try { await startRuntime(env); await migrate(env); await diagnoseApi(env, process.argv[3]); } finally {
      try { stopRuntime(env); } catch (cleanupError) { console.error(`DISPOSABLE_RUNTIME_CLEANUP_FAILED:${cleanupError instanceof Error ? cleanupError.message : cleanupError}`); }
    }
    return;
  }
  throw new Error(`DISPOSABLE_RUNTIME_COMMAND_UNSUPPORTED:${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(Number.isInteger(error?.exitCode) ? error.exitCode : 1);
});
