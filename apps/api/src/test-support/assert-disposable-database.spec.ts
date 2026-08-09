import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  assertDisposableDatabaseUrl,
  confirmSafeDisposableDatabase,
  getDisposableDatabaseUrl,
  inspectDatabaseUrl,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
  WEIGHT_APP_DISPOSABLE_MODE,
  WEIGHT_APP_RUNTIME_ID,
  DISPOSABLE_POSTGRES_MARKER,
} from './assert-disposable-database';

const moduleUrl = pathToFileURL(resolve(__dirname, 'assert-disposable-database.ts')).href;

describe('disposable database fail-closed guard', () => {
  it('rejects missing DATABASE_URL', () => {
    expect(inspectDatabaseUrl(undefined, {})).toEqual({
      ok: false,
      reason: 'DATABASE_URL_MISSING',
    });
    expect(() => assertDisposableDatabaseUrl(undefined, {})).toThrow(
      /UNSAFE_DATABASE_TARGET:DATABASE_URL_MISSING/,
    );
  });

  it('rejects shared weight_app without disposable marker', () => {
    const env = {};
    expect(
      inspectDatabaseUrl(
        'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
        env,
      ),
    ).toEqual({ ok: false, reason: 'SHARED_WEIGHT_APP_DATABASE_FORBIDDEN' });
  });

  it('rejects disposable-looking URL when marker is absent', () => {
    expect(
      inspectDatabaseUrl('postgresql://wa_fix:tmp@127.0.0.1:55433/wa_fix_01b', {}),
    ).toEqual({ ok: false, reason: 'DISPOSABLE_MARKER_REQUIRED' });
  });

  it('rejects ephemeral-looking shared weight_app even with disposable marker', () => {
    const env = { WEIGHT_APP_DISPOSABLE_TEST_DB: '1' };
    const result = inspectDatabaseUrl(
      'postgresql://weight_app:weight_app_local@127.0.0.1:5432/weight_app',
      env,
    );
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, reason: 'SHARED_WEIGHT_APP_DATABASE_FORBIDDEN' });
    expect(() =>
      confirmSafeDisposableDatabase('postgresql://weight_app:x@127.0.0.1:5432/weight_app', env),
    ).toThrow(/SHARED_WEIGHT_APP_DATABASE_FORBIDDEN/);
  });

  it('requires server-backed identity in canonical disposable mode', () => {
    const env = {
      [WEIGHT_APP_DISPOSABLE_MODE]: '1',
      [WEIGHT_APP_RUNTIME_ID]: 'wa-test-12345678',
      [DISPOSABLE_POSTGRES_MARKER]: 'wa-test-12345678',
    };
    expect(inspectDatabaseUrl('postgresql://wa_test:x@127.0.0.1:55433/weight_app_disposable_test_12345678', env).ok).toBe(true);
    expect(inspectDatabaseUrl('postgresql://wa_test:x@127.0.0.1:55433/weight_app_disposable_test_12345678_test_a1b2c3d4', env).ok).toBe(true);
    expect(inspectDatabaseUrl('postgresql://wa_test:x@127.0.0.1:55433/wt_cat_test_12345678_a1b2c3d4', env).ok).toBe(true);
    expect(inspectDatabaseUrl('postgresql://wa_test:x@127.0.0.1:55433/wt_cat_other_a1b2c3d4', env)).toEqual({ ok: false, reason: 'POSTGRES_DATABASE_IDENTITY_MISMATCH' });
    expect(inspectDatabaseUrl('postgresql://wa_test:x@127.0.0.1:55433/weight_app_disposable_other_test_a1b2c3d4', env)).toEqual({ ok: false, reason: 'POSTGRES_DATABASE_IDENTITY_MISMATCH' });
    expect(inspectDatabaseUrl('postgresql://wa_test:x@127.0.0.1:55433/weight_app_disposable_fake', env)).toEqual({ ok: false, reason: 'POSTGRES_DATABASE_IDENTITY_MISMATCH' });
  });

  it('allows alternate disposable database names with marker', () => {
    const env = { WEIGHT_APP_DISPOSABLE_TEST_DB: '1' };
    expect(() =>
      assertDisposableDatabaseUrl(
        'postgresql://wa_review:tmp@127.0.0.1:55432/wa_review_01b',
        env,
      ),
    ).not.toThrow();
    expect(
      getDisposableDatabaseUrl({
        ...env,
        DATABASE_URL: 'postgresql://wa_review:tmp@127.0.0.1:55432/wa_review_01b',
      }),
    ).toContain('wa_review_01b');
  });

  it('child process with stripped env cannot reach shared fallback', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `import { assertDisposableDatabaseUrl } from ${JSON.stringify(moduleUrl)};
         try {
           assertDisposableDatabaseUrl(process.env.DATABASE_URL, process.env);
           console.log('UNEXPECTED_PASS');
           process.exit(2);
         } catch (e) {
           console.log(String(e && e.message ? e.message : e));
           process.exit(0);
         }`,
      ],
      {
        env: {
          PATH: process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot,
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/UNSAFE_DATABASE_TARGET:DATABASE_URL_MISSING/);
  });

  it('child process receives disposable URL and marker', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `import { confirmSafeDisposableDatabase } from ${JSON.stringify(moduleUrl)};
         console.log(confirmSafeDisposableDatabase(process.env.DATABASE_URL, process.env));`,
      ],
      {
        env: {
          PATH: process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot,
          DATABASE_URL: 'postgresql://wa_test:tmp@127.0.0.1:55433/wa_test_01b',
          [WEIGHT_APP_DISPOSABLE_TEST_DB]: '1',
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('SAFE_DISPOSABLE_DATABASE_CONFIRMED');
  });
});
