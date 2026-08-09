/**
 * Vitest setup: fail closed before any test file opens a DB pool.
 * API vitest (including unit) must receive an explicit disposable DATABASE_URL —
 * never rely on shared weight_app fallback when Turbo strips env.
 */
import { assertDisposableDatabaseUrl } from './assert-disposable-database';

assertDisposableDatabaseUrl(process.env.DATABASE_URL);
