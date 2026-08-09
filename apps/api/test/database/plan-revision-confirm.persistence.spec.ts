import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RevisionEngineRepository } from '../../src/modules/revision-engine/infrastructure/revision-engine.repository';
import { RevisionEngineService } from '../../src/modules/revision-engine/application/revision-engine.service';
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
const userA = 'a100a100-a100-4a10-8a10-a100a100a100';
const userB = 'b100b100-b100-4b10-8b10-b100b100b100';
const mealPlanId = '10101010-1010-4010-8010-101010101010';

async function ensureMigrations() {
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'PlanRevision'
    ) AS exists`,
  );
  if (!exists.rows[0]?.exists) {
    await pool.query(readFileSync(resolve(process.cwd(), 'prisma/migrations/167_plan-revision/migration.sql'), 'utf8'));
  }
  const hasIdempotency = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'PlanRevision' AND column_name = 'idempotencyKey'
    ) AS exists`,
  );
  if (!hasIdempotency.rows[0]?.exists) {
    await pool.query(readFileSync(resolve(process.cwd(), 'prisma/migrations/168_plan-revision-confirm/migration.sql'), 'utf8'));
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

async function clearUserRevisions(userId: string) {
  await pool.query('SET session_replication_role = replica');
  try {
    await pool.query('DELETE FROM "PlanRevision" WHERE "userId" = $1', [userId]);
  } finally {
    await pool.query('SET session_replication_role = DEFAULT');
  }
}

async function activeMealPlanIdFor(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "Plan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1',
    [userId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('TEST_ACTIVE_MEAL_PLAN_MISSING');
  return id;
}

describe('STEP_100 plan revision API persistence', () => {
  beforeAll(async () => {
    await ensureMigrations();
    await pool.query('INSERT INTO "User" (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING', [
      userA,
      'rev100-a@test.local',
      userB,
      'rev100-b@test.local',
    ]);
    await pool.query(
      `INSERT INTO "Plan" (id, "userId", version, immutable)
       VALUES ($1, $2, 1, true)
       ON CONFLICT (id) DO NOTHING`,
      [mealPlanId, userA],
    );
    await pool.query(
      `INSERT INTO "PlanDay" (id, "planId", "dayIndex")
       VALUES ('20202020-2020-4020-8020-202020202020', $1, 0)
       ON CONFLICT ("planId", "dayIndex") DO NOTHING`,
      [mealPlanId],
    );
    await pool.query(
      `INSERT INTO "Meal" (id, "planDayId", name)
       VALUES ('30303030-3030-4030-8030-303030303030', '20202020-2020-4020-8020-202020202020', 'oats')
       ON CONFLICT (id) DO NOTHING`,
    );
    await clearUserRevisions(userA);
  });

  beforeEach(async () => {
    await clearUserRevisions(userA);
  });

  afterAll(async () => {
    await clearUserRevisions(userA);
    await clearPlanRevisions(mealPlanId);
    await pool.end();
  });

  it('preview does not create PlanRevision rows', async () => {
    const service = new RevisionEngineService(new RevisionEngineRepository(db));
    const planId = await activeMealPlanIdFor(userA);
    const before = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "planId" = $1',
      [planId],
    );
    await service.preview(userA, planId, 'meal', 'travel');
    const after = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "planId" = $1',
      [planId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('confirm creates one revision and apply replay keeps a single row', async () => {
    const service = new RevisionEngineService(new RevisionEngineRepository(db));
    const planId = await activeMealPlanIdFor(userA);
    const preview = await service.preview(userA, planId, 'meal', 'travel');
    const first = await service.confirm({
      userId: userA,
      planId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: 'confirm-key-0001',
    });
    expect(first.idempotentReplay).toBe(false);
    expect(first.activeVersion).toBeGreaterThan(1);

    const replay = await service.confirm({
      userId: userA,
      planId,
      planKind: 'meal',
      confirmationToken: preview.confirmationToken,
      idempotencyKey: 'confirm-key-0001',
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.revision.id).toBe(first.revision.id);

    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "userId" = $1 AND "idempotencyKey" = $2',
      [userA, 'confirm-key-0001'],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('same key with different payload conflicts', async () => {
    const service = new RevisionEngineService(new RevisionEngineRepository(db));
    const planId = await activeMealPlanIdFor(userA);
    const previewA = await service.preview(userA, planId, 'meal', 'holiday');
    await service.confirm({
      userId: userA,
      planId,
      planKind: 'meal',
      confirmationToken: previewA.confirmationToken,
      idempotencyKey: 'confirm-key-0002',
    });
    const nextPlanId = await activeMealPlanIdFor(userA);
    const previewB = await service.preview(userA, nextPlanId, 'meal', 'shift work');
    await expect(
      service.confirm({
        userId: userA,
        planId: nextPlanId,
        planKind: 'meal',
        confirmationToken: previewB.confirmationToken,
        idempotencyKey: 'confirm-key-0002',
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });

  it('IDOR: user B cannot preview or confirm user A plan', async () => {
    const service = new RevisionEngineService(new RevisionEngineRepository(db));
    const planId = await activeMealPlanIdFor(userA);
    await expect(service.preview(userB, planId, 'meal', 'travel')).rejects.toThrow('REVISION_PLAN_FORBIDDEN');
    const preview = await service.preview(userA, planId, 'meal', 'travel');
    await expect(
      service.confirm({
        userId: userB,
        planId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: 'confirm-key-b-0001',
      }),
    ).rejects.toThrow(/REVISION_TOKEN_FORBIDDEN|REVISION_PLAN_FORBIDDEN/);
  });

  it('transaction failure leaves no revision and no partial applied plan version jump without revision', async () => {
    const failingDb = {
      query: db.query.bind(db),
      async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        const txQuery: SqlQuery = async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values: unknown[] = [],
        ): Promise<QueryResult<R>> => {
          if (text.includes('INSERT INTO "PlanRevision"')) throw new Error('FORCED_REVISION_FAIL');
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

    const service = new RevisionEngineService(new RevisionEngineRepository(failingDb));
    const planId = await activeMealPlanIdFor(userA);
    const preview = await service.preview(userA, planId, 'meal', 'travel');
    const beforePlans = await pool.query<{ max: number }>(
      'SELECT COALESCE(MAX(version),0)::int AS max FROM "Plan" WHERE "userId" = $1',
      [userA],
    );
    const beforeRevisions = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "planId" = $1',
      [planId],
    );

    await expect(
      service.confirm({
        userId: userA,
        planId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: 'confirm-key-rollback',
      }),
    ).rejects.toThrow('FORCED_REVISION_FAIL');

    const afterPlans = await pool.query<{ max: number }>(
      'SELECT COALESCE(MAX(version),0)::int AS max FROM "Plan" WHERE "userId" = $1',
      [userA],
    );
    const afterRevisions = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "PlanRevision" WHERE "planId" = $1',
      [planId],
    );
    expect(afterPlans.rows[0]?.max).toBe(beforePlans.rows[0]?.max);
    expect(afterRevisions.rows[0]?.count).toBe(beforeRevisions.rows[0]?.count);
  });

  it('rejects stale confirmation after a newer active plan version exists', async () => {
    const service = new RevisionEngineService(new RevisionEngineRepository(db));
    const planId = await activeMealPlanIdFor(userA);
    const preview = await service.preview(userA, planId, 'meal', 'travel');
    const bumped = await pool.query<{ id: string }>(
      `INSERT INTO "Plan" (id, "userId", version, immutable)
       VALUES (gen_random_uuid(), $1, (SELECT COALESCE(MAX(version),0)+1 FROM "Plan" WHERE "userId" = $1), true)
       RETURNING id`,
      [userA],
    );
    expect(bumped.rows[0]?.id).toBeTruthy();
    await expect(
      service.confirm({
        userId: userA,
        planId,
        planKind: 'meal',
        confirmationToken: preview.confirmationToken,
        idempotencyKey: `stale-after-bump-${Date.now()}`,
      }),
    ).rejects.toThrow('REVISION_PREVIEW_STALE');
  });

  it('rejects pending status at repository boundary', async () => {
    const repository = new RevisionEngineRepository(db);
    await expect(
      repository.create({
        userId: userA,
        planId: mealPlanId,
        planKind: 'meal',
        version: 0,
        reason: 'draft',
        status: 'pending' as never,
        snapshot: { x: 1 },
      }),
    ).rejects.toThrow('REVISION_CONFIRMATION_REQUIRED');
  });
});
