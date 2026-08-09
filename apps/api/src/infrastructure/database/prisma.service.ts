import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export type SqlQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<T>>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();
    const appEnv = String(process.env.APP_ENV ?? '').trim().toUpperCase();
    if (!connectionString) {
      if (appEnv === 'STAGING' || appEnv === 'PRODUCTION' || process.env.NODE_ENV === 'production') {
        throw new Error('DATABASE_URL is required');
      }
    }
    this.pool = new Pool({
      connectionString:
        connectionString ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }

  async onModuleInit(): Promise<void> { await this.pool.query('SELECT 1'); }
  async onModuleDestroy(): Promise<void> { await this.pool.end(); }
  query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) { return this.pool.query<T>(text, values); }

  /**
   * Hold a session advisory lock on a dedicated connection for the duration of `fn`.
   * Other sessions calling the same lock key will fail tryLock (ALREADY_RUNNING).
   */
  async withSessionAdvisoryLock<T>(
    key1: number,
    key2Text: string,
    fn: () => Promise<T>,
  ): Promise<{ acquired: false } | { acquired: true; result: T }> {
    const client = await this.pool.connect();
    try {
      const got = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
        [key1, key2Text],
      );
      if (!got.rows[0]?.locked) return { acquired: false };
      try {
        const result = await fn();
        return { acquired: true, result };
      } finally {
        await client.query(`SELECT pg_advisory_unlock($1, hashtext($2))`, [key1, key2Text]);
      }
    } finally {
      client.release();
    }
  }

  /** Run work on one dedicated client so BEGIN/COMMIT cannot leak across pool connections. */
  async withTransaction<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    const query: SqlQuery = <R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
      client.query<R>(text, values);
    try {
      await client.query('BEGIN');
      const result = await fn(query);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure; original error is authoritative
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
