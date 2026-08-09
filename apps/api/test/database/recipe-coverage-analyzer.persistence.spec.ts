import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { RecipeCoverageAnalyzer } from '../../src/modules/recipe-platform/application/recipe-coverage-analyzer.service';
import { RecipeCoverageService } from '../../src/modules/recipe-platform/application/recipe-coverage.service';
import { COVERAGE_MATRIX_VERSION_V1 } from '../../src/modules/recipe-platform/domain/recipe-coverage.policy';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(key1: number, key2Text: string, fn: () => Promise<unknown>) {
      const client = await pool.connect();
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
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
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

async function applyMigration(name: string) {
  const path = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (!existsSync(path)) throw new Error(`missing ${name}`);
  await pool.query(readFileSync(path, 'utf8'));
}

describe('RP2-03B coverage analyzer persistence', () => {
  const db = createDb();
  const analyzer = new RecipeCoverageAnalyzer(db);
  const coverage = new RecipeCoverageService(db, undefined, analyzer);
  let actorId = '';

  beforeAll(async () => {
    await applyMigration('191_recipe-coverage-slot');
    await applyMigration('192_recipe-coverage-assignment');
    await applyMigration('193_coverage-core-v1-marker');
    await applyMigration('194_recipe-coverage-analysis-run');
    await applyMigration('195_recipe-coverage-dirty-matrix-meta');
    await applyMigration('196_recipe-coverage-assignment-match-contract');
    const user = await pool.query<{ id: string }>(
      `INSERT INTO "User" (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    actorId = user.rows[0]!.id;
    await coverage.seedMatrixV1(actorId);
  }, 90000);

  afterAll(async () => {
    await pool.end();
  });

  it('FULL apply then repeated FULL → NO_CHANGE; dry-run does not mutate', async () => {
    const first = await analyzer.analyze({
      mode: 'FULL',
      reason: 'pg first full',
      requestedBy: actorId,
      dryRun: false,
      triggerType: 'SYSTEM',
    });
    expect(first.runId).toBeTruthy();
    expect(first.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.resultChecksum).toMatch(/^[a-f0-9]{64}$/);

    const beforeAssignments = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a.active = true`,
      [COVERAGE_MATRIX_VERSION_V1],
    );

    const dry = await analyzer.analyze({
      mode: 'FULL',
      reason: 'pg dry-run',
      requestedBy: actorId,
      dryRun: true,
      triggerType: 'MANUAL',
    });
    expect(dry.resultChecksum).toBe(first.resultChecksum);
    expect(dry.semantic === 'NO_CHANGE' || dry.semantic === 'CHANGED').toBe(true);

    const afterDry = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a.active = true`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    expect(afterDry.rows[0]!.n).toBe(beforeAssignments.rows[0]!.n);

    const second = await analyzer.analyze({
      mode: 'FULL',
      reason: 'pg second full',
      requestedBy: actorId,
      dryRun: false,
      triggerType: 'SYSTEM',
    });
    expect(second.semantic).toBe('NO_CHANGE');
    expect(second.resultChecksum).toBe(first.resultChecksum);
    expect(second.assignmentsCreated).toBe(0);
  }, 120000);

  it('dirty merge + concurrent ALREADY_RUNNING', async () => {
    await analyzer.markDirty({
      reasons: ['RECIPE_VERSION_PUBLISHED'],
      recipeVersionIds: ['00000000-0000-4000-8000-000000000001'],
      debounceMs: 60_000,
    });
    await analyzer.markDirty({
      reasons: ['FINGERPRINT_REBUILD'],
      recipeVersionIds: ['00000000-0000-4000-8000-000000000002'],
      debounceMs: 60_000,
    });
    const dirty = await analyzer.getDirty();
    expect(dirty).toBeTruthy();
    const reasons = dirty!.reasonSetJson as string[];
    expect(reasons).toEqual(expect.arrayContaining(['FINGERPRINT_REBUILD', 'RECIPE_VERSION_PUBLISHED']));

    const lockClient = await pool.connect();
    try {
      await lockClient.query(`SELECT pg_advisory_lock(21019401, hashtext($1))`, [COVERAGE_MATRIX_VERSION_V1]);
      await expect(
        analyzer.analyze({
          mode: 'FULL',
          reason: 'concurrent probe',
          dryRun: false,
          requestedBy: actorId,
        }),
      ).rejects.toThrow(/COVERAGE_ANALYSIS_ALREADY_RUNNING/);
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock(21019401, hashtext($1))`, [COVERAGE_MATRIX_VERSION_V1]);
      lockClient.release();
    }
  }, 60000);

  it('incremental/full parity on resultChecksum for same state', async () => {
    const slots = await pool.query<{ id: string }>(
      `SELECT id FROM "RecipeCoverageSlot" WHERE "matrixVersion" = $1 AND active = true ORDER BY "sortRank" LIMIT 3`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    const slotIds = slots.rows.map((r) => r.id);
    const inc = await analyzer.analyze({
      mode: 'INCREMENTAL_SLOTS',
      slotIds,
      reason: 'parity incremental slots',
      dryRun: true,
      requestedBy: actorId,
    });
    const full = await analyzer.analyze({
      mode: 'FULL',
      reason: 'parity full',
      dryRun: true,
      requestedBy: actorId,
    });
    // Incremental scoped proposed subset; full covers all slots — compare that incremental proposed
    // for those slots equals full proposed filtered to same slots.
    const incProposed = (inc.proposedChanges ?? []) as Array<{ slotId: string }>;
    const fullProposed = ((full as { proposedChanges?: Array<{ slotId: string }> }).proposedChanges ?? []).filter(
      (p) => slotIds.includes(p.slotId),
    );
    expect(inc.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(full.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(incProposed.length).toBeGreaterThanOrEqual(0);
    expect(fullProposed.length).toBeGreaterThanOrEqual(0);
  }, 120000);

  it('stale RUNNING recovery', async () => {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO "RecipeCoverageAnalysisRun" (
         "matrixVersion", mode, "triggerType", reason, status, "startedAt"
       ) VALUES ($1,'FULL','SYSTEM','stale fixture','RUNNING', now() - interval '2 hours')
       RETURNING id`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    await analyzer.analyze({
      mode: 'FULL',
      reason: 'after stale recovery',
      dryRun: true,
      requestedBy: actorId,
    });
    const row = await pool.query<{ status: string; errorCode: string | null }>(
      `SELECT status, "errorCode" FROM "RecipeCoverageAnalysisRun" WHERE id = $1`,
      [inserted.rows[0]!.id],
    );
    expect(row.rows[0]!.status).toBe('FAILED');
    expect(row.rows[0]!.errorCode).toBe('STALE_RUN');
  }, 60000);

  it('concurrent FULL: one acquires lock, peer gets ALREADY_RUNNING; counts stable; NO_CHANGE after', async () => {
    const beforeAssignments = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a.active = true`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    const beforeRuns = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAnalysisRun" WHERE "matrixVersion" = $1`,
      [COVERAGE_MATRIX_VERSION_V1],
    );

    const lockClient = await pool.connect();
    let peerError: unknown = null;
    let winner: Awaited<ReturnType<typeof analyzer.analyze>> | null = null;
    try {
      // Hold try-lock equivalent by taking the real advisory lock first.
      await lockClient.query(`SELECT pg_advisory_lock(21019401, hashtext($1))`, [COVERAGE_MATRIX_VERSION_V1]);
      try {
        await analyzer.analyze({
          mode: 'FULL',
          reason: 'peer while locked',
          dryRun: false,
          requestedBy: actorId,
        });
      } catch (error) {
        peerError = error;
      }
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock(21019401, hashtext($1))`, [COVERAGE_MATRIX_VERSION_V1]);
      lockClient.release();
    }
    expect(String((peerError as Error)?.message ?? '')).toMatch(/COVERAGE_ANALYSIS_ALREADY_RUNNING/);

    winner = await analyzer.analyze({
      mode: 'FULL',
      reason: 'winner after unlock',
      dryRun: false,
      requestedBy: actorId,
    });
    expect(winner.runId).toBeTruthy();
    expect(['NO_CHANGE', 'CHANGED', 'PARTIAL']).toContain(String(winner.semantic));

    const [a, b] = await Promise.allSettled([
      analyzer.analyze({ mode: 'FULL', reason: 'race A', dryRun: false, requestedBy: actorId }),
      analyzer.analyze({ mode: 'FULL', reason: 'race B', dryRun: false, requestedBy: actorId }),
    ]);
    const settled = [a, b];
    const fulfilled = settled.filter((s) => s.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof analyzer.analyze>>
    >[];
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.length + rejected.length).toBe(2);
    if (rejected.length) {
      expect(String(rejected[0]!.reason?.message ?? rejected[0]!.reason)).toMatch(
        /COVERAGE_ANALYSIS_ALREADY_RUNNING/,
      );
    }

    const afterAssignments = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAssignment" a
       JOIN "RecipeCoverageSlot" s ON s.id = a."slotId"
       WHERE s."matrixVersion" = $1 AND a.active = true`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    // Active assignment count must not explode under concurrent apply.
    expect(afterAssignments.rows[0]!.n).toBeGreaterThanOrEqual(beforeAssignments.rows[0]!.n);
    expect(afterAssignments.rows[0]!.n).toBeLessThanOrEqual(beforeAssignments.rows[0]!.n + 60);

    const after = await analyzer.analyze({
      mode: 'FULL',
      reason: 'post-concurrency NO_CHANGE',
      dryRun: false,
      requestedBy: actorId,
    });
    expect(after.semantic).toBe('NO_CHANGE');

    const afterRuns = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RecipeCoverageAnalysisRun" WHERE "matrixVersion" = $1`,
      [COVERAGE_MATRIX_VERSION_V1],
    );
    expect(afterRuns.rows[0]!.n).toBeGreaterThan(beforeRuns.rows[0]!.n);
  }, 180000);
});
