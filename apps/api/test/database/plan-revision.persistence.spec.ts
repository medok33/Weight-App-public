import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RevisionEngineRepository } from '../../src/modules/revision-engine/infrastructure/revision-engine.repository';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = <T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values);

  return {
    query,
    async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txQuery: SqlQuery = <R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
        client.query<R>(text, values);
      try {
        await client.query('BEGIN');
        const result = await fn(txQuery);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

const db = createDb();

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mealPlanId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const concurrentPlanId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const autoVersionPlanId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const rollbackPlanId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const idorPlanId = '99999999-9999-4999-8999-999999999999';

async function ensureMigration() {
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'PlanRevision'
    ) AS exists`,
  );
  if (!exists.rows[0]?.exists) {
    const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/167_plan-revision/migration.sql'), 'utf8');
    await pool.query(migration);
  }
  const confirmCols = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'PlanRevision' AND column_name = 'idempotencyKey'
    ) AS exists`,
  );
  if (!confirmCols.rows[0]?.exists) {
    const confirm = readFileSync(resolve(process.cwd(), 'prisma/migrations/168_plan-revision-confirm/migration.sql'), 'utf8');
    await pool.query(confirm);
  }
}

async function clearPlanRevisions(planId: string) {
  await pool.query('SET session_replication_role = replica');
  try {
    await pool.query('DELETE FROM "PlanRevision" WHERE "planId" = $1', [planId]);
  } finally {
    await pool.query('SET session_replication_role = DEFAULT');
  }
}

async function ensurePlan(planId: string, userId: string, version: number) {
  await pool.query(
    'INSERT INTO "Plan" (id, "userId", version, immutable) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO NOTHING',
    [planId, userId, version],
  );
}

describe('plan revision persistence', () => {
  beforeAll(async () => {
    await ensureMigration();
    await pool.query('INSERT INTO "User" (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING', [
      userA,
      'revision-a@test.local',
      userB,
      'revision-b@test.local',
    ]);
    await ensurePlan(mealPlanId, userA, 1);
    await ensurePlan(concurrentPlanId, userA, 2);
    await ensurePlan(autoVersionPlanId, userA, 3);
    await ensurePlan(rollbackPlanId, userA, 4);
    await ensurePlan(idorPlanId, userA, 5);
    for (const planId of [mealPlanId, concurrentPlanId, autoVersionPlanId, rollbackPlanId, idorPlanId]) {
      await clearPlanRevisions(planId);
    }
  });

  afterAll(async () => {
    for (const planId of [mealPlanId, concurrentPlanId, autoVersionPlanId, rollbackPlanId, idorPlanId]) {
      await clearPlanRevisions(planId);
    }
    await pool.end();
  });

  it('persists a confirmed revision in PostgreSQL', async () => {
    const repository = new RevisionEngineRepository(db);
    const created = await repository.create({
      userId: userA,
      planId: mealPlanId,
      planKind: 'meal',
      version: 0,
      reason: 'travel',
      status: 'confirmed',
      snapshot: { planVersion: 1 },
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.version).toBe(1);
    expect(created.status).toBe('confirmed');
  });

  it('survives a new repository instance after restart', async () => {
    const writer = new RevisionEngineRepository(db);
    const created = await writer.create({
      userId: userA,
      planId: mealPlanId,
      planKind: 'meal',
      version: 0,
      reason: 'injury',
      status: 'confirmed',
      snapshot: { planVersion: 1, note: 'restart-check' },
    });

    const reader = new RevisionEngineRepository(db);
    const reloaded = await reader.findById(userA, created.id);
    expect(reloaded?.reason).toBe('injury');
    expect(reloaded?.snapshot).toEqual({ planVersion: 1, note: 'restart-check' });
  });

  it('returns revision history in ascending version order', async () => {
    const repository = new RevisionEngineRepository(db);
    const history = await repository.listByPlan(userA, mealPlanId, 'meal');
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.map((revision) => revision.version)).toEqual(
      [...history.map((revision) => revision.version)].sort((a, b) => a - b),
    );
  });

  it('IDOR: User B cannot read or create against User A plan/revision', async () => {
    const writer = new RevisionEngineRepository(db);
    const created = await writer.create({
      userId: userA,
      planId: idorPlanId,
      planKind: 'meal',
      version: 0,
      reason: 'idor-seed',
      status: 'confirmed',
      snapshot: { planVersion: 5 },
    });

    const reader = new RevisionEngineRepository(db);
    expect(await reader.findById(userA, created.id)).not.toBeNull();
    expect(await reader.findById(userB, created.id)).toBeNull();
    expect(await reader.listByPlan(userB, idorPlanId, 'meal')).toHaveLength(0);
    expect(await reader.findLatestByPlan(userB, idorPlanId, 'meal')).toBeNull();

    await expect(
      reader.create({
        userId: userB,
        planId: idorPlanId,
        planKind: 'meal',
        version: 0,
        reason: 'stolen',
        status: 'confirmed',
        snapshot: { planVersion: 5 },
      }),
    ).rejects.toThrow('REVISION_PLAN_FORBIDDEN');
  });

  it('prevents duplicate explicit versions for the same plan', async () => {
    const repository = new RevisionEngineRepository(db);
    await expect(
      repository.create({
        userId: userA,
        planId: mealPlanId,
        planKind: 'meal',
        version: 1,
        reason: 'duplicate',
        status: 'confirmed',
        snapshot: { planVersion: 1 },
      }),
    ).rejects.toThrow('REVISION_VERSION_CONFLICT');
  });

  it('does not silently fall back to memory on PostgreSQL errors', async () => {
    const failingDb = {
      query: async () => {
        throw new Error('DB_UNAVAILABLE');
      },
      withTransaction: async () => {
        throw new Error('DB_UNAVAILABLE');
      },
    } as PrismaService;
    const repository = new RevisionEngineRepository(failingDb);
    await expect(
      repository.create({
        userId: userA,
        planId: mealPlanId,
        planKind: 'meal',
        version: 0,
        reason: 'db-fail',
        status: 'confirmed',
        snapshot: { planVersion: 1 },
      }),
    ).rejects.toThrow('DB_UNAVAILABLE');
  });

  it('rejects revisions for plans owned by another user', async () => {
    const repository = new RevisionEngineRepository(db);
    await expect(
      repository.create({
        userId: userB,
        planId: mealPlanId,
        planKind: 'meal',
        version: 0,
        reason: 'stolen',
        status: 'confirmed',
        snapshot: { planVersion: 1 },
      }),
    ).rejects.toThrow('REVISION_PLAN_FORBIDDEN');
  });

  it('rejects pending status at persistence boundary', async () => {
    const repository = new RevisionEngineRepository(db);
    await expect(
      repository.create({
        userId: userA,
        planId: mealPlanId,
        planKind: 'meal',
        version: 0,
        reason: 'draft',
        status: 'pending',
        snapshot: { planVersion: 1 },
      }),
    ).rejects.toThrow('REVISION_CONFIRMATION_REQUIRED');
  });

  it('does not create duplicate explicit versions under concurrent writes', async () => {
    const repository = new RevisionEngineRepository(db);
    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        repository.create({
          userId: userA,
          planId: concurrentPlanId,
          planKind: 'meal',
          version: 50,
          reason: 'concurrent',
          status: 'confirmed',
          snapshot: { planVersion: 2 },
        }),
      ),
    );

    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ message: 'REVISION_VERSION_CONFLICT' });

    const history = await repository.listByPlan(userA, concurrentPlanId, 'meal');
    expect(history.filter((revision) => revision.version === 50)).toHaveLength(1);
  });

  it('auto-allocates sequential unique versions under concurrent create(version=0)', async () => {
    const repository = new RevisionEngineRepository(db);
    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) =>
        repository.create({
          userId: userA,
          planId: autoVersionPlanId,
          planKind: 'meal',
          version: 0,
          reason: `auto-${index}`,
          status: 'confirmed',
          snapshot: { planVersion: 3, index },
        }),
      ),
    );

    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<RevisionEngineRepository['create']>>
    >[];
    expect(fulfilled).toHaveLength(2);

    const versions = fulfilled.map((attempt) => attempt.value.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2]);

    const history = await repository.listByPlan(userA, autoVersionPlanId, 'meal');
    expect(history.map((revision) => revision.version)).toEqual([1, 2]);
  });

  it('rolls back failed create without leaving a row or consuming a version', async () => {
    const failingDb = {
      query: db.query.bind(db),
      async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        const txQuery: SqlQuery = async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values: unknown[] = [],
        ): Promise<QueryResult<R>> => {
          if (text.includes('INSERT INTO "PlanRevision"')) {
            throw new Error('FORCED_INSERT_FAILURE');
          }
          return client.query<R>(text, values);
        };
        try {
          await client.query('BEGIN');
          const result = await fn(txQuery);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore
          }
          throw error;
        } finally {
          client.release();
        }
      },
    } as PrismaService;

    const failingRepository = new RevisionEngineRepository(failingDb);
    await expect(
      failingRepository.create({
        userId: userA,
        planId: rollbackPlanId,
        planKind: 'meal',
        version: 0,
        reason: 'rollback',
        status: 'confirmed',
        snapshot: { planVersion: 4 },
      }),
    ).rejects.toThrow('FORCED_INSERT_FAILURE');

    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "planId" = $1',
      [rollbackPlanId],
    );
    expect(count.rows[0]?.count).toBe('0');

    const repository = new RevisionEngineRepository(db);
    const created = await repository.create({
      userId: userA,
      planId: rollbackPlanId,
      planKind: 'meal',
      version: 0,
      reason: 'after-rollback',
      status: 'confirmed',
      snapshot: { planVersion: 4 },
    });
    expect(created.version).toBe(1);
  });
});
