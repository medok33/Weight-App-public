import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { assertDisposableConfig, classifyMarkerValue, createRuntimeEnv, diagnostics, isTransientMarkerProbeError, migrationChildInvocation, parseDatabaseUrl, parseRedisUrl, redactConnection } from './disposable-runtime.mjs';

const base = { WEIGHT_APP_DISPOSABLE_MODE: '1', WEIGHT_APP_RUNTIME_ID: 'wa-test-12345678', DISPOSABLE_POSTGRES_MARKER: 'wa-test-12345678', DISPOSABLE_REDIS_MARKER: 'wa-test-12345678', DATABASE_URL: 'postgresql://user:secret@127.0.0.1:55432/weight_app_disposable_test_12345678', REDIS_URL: 'redis://127.0.0.1:56379' };

test('PostgreSQL healthcheck accepts only the final PID 1 server', () => {
  const compose = readFileSync(new URL('../../docker/compose.disposable.yaml', import.meta.url), 'utf8');
  assert.match(compose, /pg_isready -U \$\$\{POSTGRES_USER\} -d \$\$\{POSTGRES_DB\}/);
  assert.match(compose, /postmaster\.pid/);
  assert.match(compose, /sed -n '1p'/);
  assert.match(compose, /\)" = "1"/);
});

test('shared local database is rejected before mutation', () => assert.throws(() => assertDisposableConfig({ ...base, DATABASE_URL: 'postgresql://weight_app:secret@127.0.0.1:5432/weight_app' }), /POSTGRES_DATABASE_IDENTITY_MISMATCH/));
test('one env flag cannot bypass the database identity', () => assert.throws(() => assertDisposableConfig({ ...base, DISPOSABLE_POSTGRES_MARKER: 'wa-test-12345678', DATABASE_URL: 'postgresql://user:x@127.0.0.1:55432/weight_app_test' }), /POSTGRES_DATABASE_IDENTITY_MISMATCH/));
test('remote database is rejected', () => assert.throws(() => parseDatabaseUrl('postgresql://u:p@db.example.invalid:5432/x'), /POSTGRES_HOST_NOT_LOCAL/));
test('remote redis is rejected', () => assert.throws(() => parseRedisUrl('redis://cache.example.invalid:6379'), /REDIS_HOST_NOT_LOCAL/));
test('server marker and runtime identity are required', () => assert.throws(() => assertDisposableConfig({ ...base, DISPOSABLE_POSTGRES_MARKER: 'wa-other-12345678' }), /POSTGRES_SERVER_MARKER_REQUIRED/));
test('missing opt-in fails closed', () => assert.throws(() => assertDisposableConfig({ ...base, WEIGHT_APP_DISPOSABLE_MODE: undefined }), /DISPOSABLE_MODE_REQUIRED/));
test('marker absence is transient but identity mismatch fails immediately', () => {
  assert.deepEqual(classifyMarkerValue('', base.WEIGHT_APP_RUNTIME_ID, 'POSTGRES_SERVER_MARKER'), { state: 'transient-absent' });
  assert.throws(() => classifyMarkerValue('wa-other-12345678', base.WEIGHT_APP_RUNTIME_ID, 'POSTGRES_SERVER_MARKER'), /POSTGRES_SERVER_MARKER_IDENTITY_MISMATCH/);
  assert.deepEqual(classifyMarkerValue('(nil)', base.WEIGHT_APP_RUNTIME_ID, 'REDIS_SERVER_MARKER'), { state: 'transient-absent' });
});
test('only startup probe errors are retryable', () => {
  assert.equal(isTransientMarkerProbeError(new Error('connection refused')), true);
  assert.equal(isTransientMarkerProbeError(new Error('relation weight_app_runtime_metadata.runtime_identity does not exist')), true);
  assert.equal(isTransientMarkerProbeError(new Error('POSTGRES_SERVER_MARKER_IDENTITY_MISMATCH')), false);
});
test('migration child bypasses package-manager bootstrap after dependency preparation', () => {
  const child = migrationChildInvocation();
  assert.equal(child.command, process.execPath);
  assert.ok(child.args.at(-1).replaceAll('\\', '/').endsWith('/apps/api/scripts/migrate.mjs'));
  assert.ok(!child.args.some((arg) => arg === 'db:migrate' || arg === 'install'));
});
test('diagnostics redact database and redis credentials', () => {
  const out = JSON.stringify(diagnostics({ ...base, REDIS_URL: 'redis://:redis-secret@127.0.0.1:56379' }));
  assert.ok(!out.includes('secret'));
  assert.ok(!out.includes('redis-secret'));
  assert.equal(redactConnection(base.DATABASE_URL).includes('secret'), false);
});
test('independent runtime identities derive independent database identities', () => {
  const a = createRuntimeEnv();
  const b = createRuntimeEnv();
  assert.notEqual(a.WEIGHT_APP_RUNTIME_ID, b.WEIGHT_APP_RUNTIME_ID);
  assert.notEqual(a.DATABASE_URL, b.DATABASE_URL);
  assert.match(a.DISPOSABLE_COMPOSE_PROJECT, new RegExp(a.WEIGHT_APP_RUNTIME_ID));
  assert.match(b.DISPOSABLE_COMPOSE_PROJECT, new RegExp(b.WEIGHT_APP_RUNTIME_ID));
});
test('runtime E2E endpoints use the owned API and Web ports', () => {
  const env = createRuntimeEnv();
  assert.equal(env.NEXT_PUBLIC_API_BASE_URL, `http://localhost:${env.DISPOSABLE_API_PORT}/api/v1`);
  assert.equal(env.INTERNAL_API_BASE_URL, `http://127.0.0.1:${env.DISPOSABLE_API_PORT}/api/v1`);
  assert.equal(env.API_BASE_URL, env.INTERNAL_API_BASE_URL);
  assert.equal(env.WEB_BASE_URL, `http://localhost:${env.DISPOSABLE_WEB_PORT}`);
  assert.equal(env.E2E_WEB_ORIGIN, env.WEB_BASE_URL);
  assert.equal(
    env.DISPOSABLE_CATALOG_TEMPLATE_DATABASE,
    `wt_cat_${env.WEIGHT_APP_RUNTIME_ID.slice(3).replaceAll('-', '_')}_template`,
  );
});
