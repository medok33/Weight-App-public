import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthRepository } from '../../src/modules/auth/infrastructure/auth.repository';
import { AuthService } from '../../src/modules/auth/application/auth.service';
import { authAbuseHash } from '../../src/modules/auth/domain/auth-abuse.policy';
import type { PrismaService, SqlQuery } from '../../src/infrastructure/database/prisma.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

function migrationPath(name: string) {
  const apiRelative = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (existsSync(apiRelative)) return apiRelative;
  return resolve(process.cwd(), `apps/api/prisma/migrations/${name}/migration.sql`);
}

function dbFor(pool: pg.Pool): PrismaService {
  return {
    query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) =>
      pool.query<T>(text, values),
    withTransaction: async <T>(fn: (query: SqlQuery) => Promise<T>) => {
      const client = await pool.connect();
      const query: SqlQuery = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) =>
        client.query<R>(text, values);
      try {
        await client.query('BEGIN');
        const result = await fn(query);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

describeDb('auth abuse PostgreSQL persistence', () => {
  let pool: pg.Pool;
  let repoA: AuthRepository;
  let repoB: AuthRepository;
  const stamp = `arch-sec-02b-${Date.now()}`;
  const secret = 'test-auth-abuse-secret';
  const hashes: string[] = [];
  let userId: string;

  function hashSubject(value: string) {
    const hash = authAbuseHash(value, secret);
    hashes.push(hash);
    return hash;
  }

  async function cleanup() {
    if (hashes.length > 0) {
      await pool.query(`DELETE FROM "AuthThrottleBucket" WHERE "subjectHash" = ANY($1::text[])`, [hashes]);
      await pool.query(`DELETE FROM "AuthAccountLockout" WHERE "accountHash" = ANY($1::text[])`, [hashes]);
    }
    await pool.query(`DELETE FROM "AuditEvent" WHERE metadata->>'testRun' = $1 OR "entityId" = $2`, [stamp, userId ?? null]);
    if (userId) await pool.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await pool.query(readFileSync(migrationPath('152_audit-event'), 'utf8'));
    await pool.query(readFileSync(migrationPath('203_auth-abuse-controls'), 'utf8'));
    repoA = new AuthRepository(dbFor(pool));
    repoB = new AuthRepository(dbFor(pool));
    const auth = new AuthService();
    const created = await repoA.createRegisteredUser(`${stamp}@example.test`, auth.hashPassword('SafePassword123'));
    userId = created;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('shares failed attempts across repository instances and survives recreation', async () => {
    const accountHash = hashSubject(`account:${stamp}:shared`);
    const ipHash = hashSubject(`ip:${stamp}:203.0.113.1`);
    const accountIpHash = hashSubject(`account_ip:${stamp}:shared:203.0.113.1`);

    for (let i = 0; i < 4; i += 1) {
      await repoA.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId });
    }

    const blockFromSecondInstance = await repoB.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId });
    expect(blockFromSecondInstance.blocked).toBe(true);
    expect(blockFromSecondInstance.reason).toBe('account_lockout');

    const recreated = new AuthRepository(dbFor(pool));
    const persisted = await recreated.evaluateAuthBlock({ accountHash, ipHash, accountIpHash });
    expect(persisted.blocked).toBe(true);
    expect(persisted.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('handles concurrent failures atomically at the account threshold', async () => {
    const accountHash = hashSubject(`account:${stamp}:concurrent`);
    const ipHash = hashSubject(`ip:${stamp}:203.0.113.2`);
    const accountIpHash = hashSubject(`account_ip:${stamp}:concurrent:203.0.113.2`);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => repoA.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId })),
    );

    expect(results.some((result) => result.blocked && result.reason === 'account_lockout')).toBe(true);
    const row = await pool.query<{ failureCount: number; locked: boolean }>(
      `SELECT "failureCount", ("lockedUntil" > CURRENT_TIMESTAMP) AS locked
       FROM "AuthAccountLockout" WHERE "accountHash" = $1`,
      [accountHash],
    );
    expect(row.rows[0]?.failureCount).toBe(6);
    expect(row.rows[0]?.locked).toBe(true);
  });

  it('keeps IP throttling independent from successful account recovery', async () => {
    const accountHash = hashSubject(`account:${stamp}:success`);
    const ipHash = hashSubject(`ip:${stamp}:203.0.113.3`);
    const accountIpHash = hashSubject(`account_ip:${stamp}:success:203.0.113.3`);

    await repoA.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId });
    await repoA.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId });
    await repoA.clearSuccessfulLogin({ accountHash, accountIpHash, userId });

    const rows = await pool.query<{ subjectType: string; failureCount: number }>(
      `SELECT "subjectType", "failureCount" FROM "AuthThrottleBucket"
       WHERE "subjectHash" = ANY($1::text[]) ORDER BY "subjectType"`,
      [[accountHash, ipHash, accountIpHash]],
    );
    expect(rows.rows.find((row) => row.subjectType === 'account')?.failureCount).toBe(0);
    expect(rows.rows.find((row) => row.subjectType === 'account_ip')?.failureCount).toBe(0);
    expect(rows.rows.find((row) => row.subjectType === 'ip')?.failureCount).toBe(2);
  });

  it('does not block after lockout expiry', async () => {
    const accountHash = hashSubject(`account:${stamp}:expired`);
    const ipHash = hashSubject(`ip:${stamp}:203.0.113.4`);
    const accountIpHash = hashSubject(`account_ip:${stamp}:expired:203.0.113.4`);

    for (let i = 0; i < 5; i += 1) {
      await repoA.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId });
    }
    await pool.query(`UPDATE "AuthAccountLockout" SET "lockedUntil" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "accountHash" = $1`, [
      accountHash,
    ]);
    await pool.query(`UPDATE "AuthThrottleBucket" SET "blockedUntil" = NULL WHERE "subjectHash" = ANY($1::text[])`, [
      [accountHash, ipHash, accountIpHash],
    ]);

    await expect(repoB.evaluateAuthBlock({ accountHash, ipHash, accountIpHash })).resolves.toMatchObject({ blocked: false });
  });

  it('emits audit events without sensitive identifiers', async () => {
    const accountHash = hashSubject(`account:${stamp}:audit`);
    const ipHash = hashSubject(`ip:${stamp}:203.0.113.5`);
    const accountIpHash = hashSubject(`account_ip:${stamp}:audit:203.0.113.5`);

    for (let i = 0; i < 5; i += 1) {
      await repoA.recordLoginFailure({ accountHash, ipHash, accountIpHash, userId });
    }

    await pool.query(`UPDATE "AuditEvent" SET metadata = metadata || $2::jsonb WHERE "entityId" = $1`, [
      userId,
      JSON.stringify({ testRun: stamp }),
    ]);
    const events = await pool.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM "AuditEvent" WHERE "entityId" = $1 ORDER BY "createdAt"`,
      [userId],
    );
    const serialized = JSON.stringify(events.rows);
    expect(events.rows.map((row) => row.action)).toContain('auth.account.locked');
    expect(serialized).not.toContain(`${stamp}@example.test`);
    expect(serialized).not.toMatch(/SafePassword123|credentialHash|token/i);
  });
});
