import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { WorkoutEngineService } from '../../src/modules/workout-engine/application/workout-engine.service';
import { WorkoutCatalogReleaseService } from '../../src/modules/workout-engine/catalog/workout-catalog-release.service';
import { WorkoutEngineRepository } from '../../src/modules/workout-engine/infrastructure/workout-engine.repository';
import { WorkoutProfileRepository } from '../../src/modules/workout-engine/infrastructure/workout-profile.repository';

const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });
const LOCK_KEY = 207_010_01;

function db(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(key1, key2Text, fn) {
      const client = await pool.connect();
      try {
        const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked', [key1, key2Text]);
        if (!result.rows[0]?.locked) return { acquired: false };
        try { return { acquired: true, result: await fn() }; }
        finally { await client.query('SELECT pg_advisory_unlock($1, hashtext($2))', [key1, key2Text]); }
      } finally { client.release(); }
    },
    async withTransaction<T>(fn: (tx: SqlQuery) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: SqlQuery = (text, values = []) => client.query(text, values);
      try { await client.query('BEGIN'); const value = await fn(tx); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
      finally { client.release(); }
    },
  } as PrismaService;
}

function engine() {
  const database = db();
  const profiles = new WorkoutProfileRepository(database);
  const profile = {
    async getProfile() { return { trainingLevel: 'BEGINNER', workoutsPerWeek: 3, equipmentCodes: ['NONE', 'BODYWEIGHT'] }; },
    async getGoal() { return { kind: 'general', target: 70, unit: 'kg' }; },
  };
  return { service: new WorkoutEngineService(new WorkoutEngineRepository(database), profile as never, database, profiles, new WorkoutCatalogReleaseService(database)), profiles };
}

async function createReadyUser() {
  const user = await pool.query<{ id: string }>('INSERT INTO "User" (id, email) VALUES (gen_random_uuid(), $1) RETURNING id', [`replacement-${randomUUID()}@example.com`]);
  const { service, profiles } = engine();
  const userId = user.rows[0]!.id;
  await profiles.createDefaults(userId, { trainingLevel: 'BEGINNER', workoutsPerWeek: 3 });
  await profiles.update(userId, { trainingLevel: 'BEGINNER', trainingPlace: 'HOME', workoutsPerWeek: 3, preferredDuration: 'SHORT', availableDays: [0, 2, 4], workoutEquipment: ['NONE', 'BODYWEIGHT'], preferredActivityTypes: [], excludedExerciseKeys: [] });
  await service.generatePlan(userId);
  return { userId, service };
}

describe('WORKOUT-01A replacement integrity persistence', { timeout: 30_000 }, () => {
  beforeAll(async () => { await pool.query('SELECT 1'); });
  afterAll(async () => { await pool.end(); });

  it('serializes a replacement behind an in-flight generation lock and targets the new active plan', async () => {
    const { userId, service } = await createReadyUser();
    const repository = new WorkoutEngineRepository(db());
    const planA = await repository.findLatestByUserId(userId);
    const lock = await pool.connect();
    try {
      await lock.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCK_KEY, `workout-generate:${userId}`]);
      const pending = service.applyReplacement(userId, { dayIndex: 0, replacementType: 'WALK' });
      const saved = await repository.savePlan(userId, planA!.version + 1, planA!.plan, { status: 'active', algorithmVersion: 'race-test', inputSnapshotJson: null });
      await lock.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_KEY, `workout-generate:${userId}`]);
      const override = await pending;
      expect(override.workoutPlanId).toBe(saved.id);
      expect(override.workoutPlanId).not.toBe(planA!.id);
    } finally { lock.release(); }
  });

  it('bounds replacement lock contention and performs no write on timeout', async () => {
    const { userId, service } = await createReadyUser();
    const before = await pool.query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM "WorkoutPlanDayOverride" WHERE "userId" = $1',
      [userId],
    );
    const lock = await pool.connect();
    const startedAt = Date.now();
    try {
      await lock.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCK_KEY, `workout-generate:${userId}`]);
      await expect(service.applyReplacement(userId, { dayIndex: 0, replacementType: 'WALK' }))
        .rejects.toThrow('WORKOUT_REPLACEMENT_IN_PROGRESS');
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_KEY, `workout-generate:${userId}`]);
      lock.release();
    }
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(3_500);
    expect(elapsedMs).toBeLessThan(8_000);
    const after = await pool.query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM "WorkoutPlanDayOverride" WHERE "userId" = $1',
      [userId],
    );
    expect(after.rows[0]!.c).toBe(before.rows[0]!.c);
  });

  it('makes concurrent identical replacements return one effective idempotent override', async () => {
    const { userId, service } = await createReadyUser();
    const [first, second] = await Promise.all([
      service.applyReplacement(userId, { dayIndex: 0, replacementType: 'WALK' }),
      service.applyReplacement(userId, { dayIndex: 0, replacementType: 'WALK' }),
    ]);
    expect(second.id).toBe(first.id);
    const active = await pool.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM "WorkoutPlanDayOverride" WHERE "workoutPlanId" = $1 AND "dayIndex" = 0 AND status = \'active\'', [first.workoutPlanId]);
    expect(Number(active.rows[0]!.c)).toBe(1);
  });
});
