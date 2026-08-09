/**
 * Fail-closed guard: integration/persistence/E2E DB targets must be disposable.
 * Never fall back to the shared local developer database without an explicit marker.
 *
 * CI may use a postgres service named `weight_app` on :5432; that is allowed only when
 * WEIGHT_APP_DISPOSABLE_TEST_DB=1 is set (ephemeral runner DB), never as a silent default.
 */

export const WEIGHT_APP_DISPOSABLE_TEST_DB = 'WEIGHT_APP_DISPOSABLE_TEST_DB';
export const WEIGHT_APP_DISPOSABLE_MODE = 'WEIGHT_APP_DISPOSABLE_MODE';
export const WEIGHT_APP_RUNTIME_ID = 'WEIGHT_APP_RUNTIME_ID';
export const DISPOSABLE_POSTGRES_MARKER = 'DISPOSABLE_POSTGRES_MARKER';

const FORBIDDEN_DB_NAME = 'weight_app';
const FORBIDDEN_USER = 'weight_app';
const FORBIDDEN_PORTS = new Set([5432]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type DisposableDatabaseCheck = {
  ok: true;
  host: string;
  port: number;
  database: string;
  user: string;
  markerPresent: boolean;
} | {
  ok: false;
  reason: string;
};

function hasDisposableMarker(env: NodeJS.ProcessEnv = process.env): boolean {
  const marker = env[WEIGHT_APP_DISPOSABLE_TEST_DB] ?? env[WEIGHT_APP_DISPOSABLE_MODE];
  return marker === '1' || marker === 'true';
}

function isCanonicalMode(env: NodeJS.ProcessEnv): boolean {
  return env[WEIGHT_APP_DISPOSABLE_MODE] === '1' || env[WEIGHT_APP_DISPOSABLE_MODE] === 'true';
}

export function inspectDatabaseUrl(
  connectionString: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): DisposableDatabaseCheck {
  if (!connectionString || !String(connectionString).trim()) {
    return { ok: false, reason: 'DATABASE_URL_MISSING' };
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { ok: false, reason: 'DATABASE_URL_INVALID' };
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { ok: false, reason: 'DATABASE_URL_NOT_POSTGRES' };
  }

  const host = (url.hostname || '').toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const port = url.port ? Number(url.port) : 5432;
  const database = decodeURIComponent((url.pathname || '').replace(/^\//, '').split('/')[0] ?? '');
  const user = decodeURIComponent(url.username || '');
  const markerPresent = hasDisposableMarker(env);

  if (!database) {
    return { ok: false, reason: 'DATABASE_NAME_EMPTY' };
  }

  if (!LOCAL_HOSTS.has(host)) {
    return { ok: false, reason: 'POSTGRES_HOST_NOT_LOCAL' };
  }

  const looksLikeSharedLocal =
    LOCAL_HOSTS.has(host) &&
    FORBIDDEN_PORTS.has(port) &&
    database === FORBIDDEN_DB_NAME &&
    (user === FORBIDDEN_USER || user === '');

  if (looksLikeSharedLocal) {
    return { ok: false, reason: 'SHARED_WEIGHT_APP_DATABASE_FORBIDDEN' };
  }

  if (!markerPresent) {
    return { ok: false, reason: 'DISPOSABLE_MARKER_REQUIRED' };
  }

  if (isCanonicalMode(env)) {
    const runtimeId = env[WEIGHT_APP_RUNTIME_ID] ?? '';
    if (!/^wa-[a-z0-9-]{8,80}$/.test(runtimeId)) {
      return { ok: false, reason: 'RUNTIME_ID_REQUIRED' };
    }
    const expectedDatabase = `weight_app_disposable_${runtimeId.slice(3).replaceAll('-', '_')}`;
    const runtimeChildPattern = new RegExp(`^${expectedDatabase}_test_[a-z0-9]{8,16}$`, 'i');
    const catalogChildPattern = new RegExp(`^wt_cat_${runtimeId.slice(3).replaceAll('-', '_')}_[a-z0-9_]{2,24}$`, 'i');
    if (database !== expectedDatabase && !runtimeChildPattern.test(database) && !catalogChildPattern.test(database)) {
      return { ok: false, reason: 'POSTGRES_DATABASE_IDENTITY_MISMATCH' };
    }
    if (env[DISPOSABLE_POSTGRES_MARKER] !== runtimeId) {
      return { ok: false, reason: 'POSTGRES_SERVER_MARKER_REQUIRED' };
    }
  }

  return { ok: true, host, port, database, user, markerPresent };
}

export function assertDisposableDatabaseUrl(
  connectionString: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): asserts connectionString is string {
  const inspected = inspectDatabaseUrl(connectionString, env);
  if (inspected.ok === false) {
    throw new Error(`UNSAFE_DATABASE_TARGET:${inspected.reason}`);
  }
}

export function confirmSafeDisposableDatabase(
  connectionString: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertDisposableDatabaseUrl(connectionString, env);
  return 'SAFE_DISPOSABLE_DATABASE_CONFIRMED';
}

/** Connection string for persistence pools — asserts before first write. */
export function getDisposableDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertDisposableDatabaseUrl(env.DATABASE_URL, env);
  return env.DATABASE_URL!;
}
