import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PrismaService, type SqlQuery } from "../../src/infrastructure/database/prisma.service";
import {
  CATALOG_PUBLISH_ADVISORY_LOCK_KEY,
  WorkoutCatalogReleaseService,
} from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { WorkoutEngineService } from "../../src/modules/workout-engine/application/workout-engine.service";
import { WorkoutEngineRepository } from "../../src/modules/workout-engine/infrastructure/workout-engine.repository";
import { WorkoutProfileRepository } from "../../src/modules/workout-engine/infrastructure/workout-profile.repository";
import { ALGORITHM_VERSION } from "../../src/modules/workout-engine/domain/workout-plan-generator";
import {
  BOOTSTRAP_RELEASE_CODE,
  CANONICAL_RELEASE_CODE,
} from "../../src/modules/workout-engine/catalog/catalog-enums";
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from "./helpers/disposable-catalog-db";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://weight_app:weight_app_local@localhost:5432/weight_app";
const pool = new Pool({ connectionString });

function createDb(clientPool: Pool = pool): PrismaService {
  const query: SqlQuery = (text, values = []) => clientPool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock(key1: number, key2Text: string, fn: () => Promise<unknown>) {
      const client = await clientPool.connect();
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
    async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
      const client = await clientPool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
      try {
        await client.query("BEGIN");
        const result = await fn(txQuery);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
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

async function expectDbReject(fn: () => Promise<unknown>, pattern: RegExp) {
  await expect(fn()).rejects.toThrow(pattern);
}

async function insertDraftReleaseWithApprovedItems(
  client: PoolClient,
  code: string,
  exerciseKeys: string[],
): Promise<string> {
  const draft = await client.query<{ id: string }>(
    `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
     VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01a.1')
     RETURNING id`,
    [code],
  );
  const releaseId = draft.rows[0]!.id;
  let ordinal = 1;
  for (const key of exerciseKeys) {
    const row = await client.query<{
      exerciseId: string;
      familyId: string;
      revisionId: string;
    }>(
      `SELECT e.id AS "exerciseId", e."familyId", r.id AS "revisionId"
       FROM "Exercise" e
       JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r."revisionNumber" = 1
       WHERE e.key = $1`,
      [key],
    );
    await client.query(
      `INSERT INTO "WorkoutCatalogReleaseItem" (
         "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
       ) VALUES ($1, $2, $3, $4, $5, true)`,
      [releaseId, row.rows[0]!.exerciseId, row.rows[0]!.revisionId, row.rows[0]!.familyId, ordinal],
    );
    ordinal += 1;
  }
  return releaseId;
}

describe("WORKOUT-CATALOG-01A persistence", { timeout: 300_000 }, () => {
  const db = createDb();
  const catalog = new WorkoutCatalogReleaseService(db);
  let userId: string;

  beforeAll(async () => {
    userId = randomUUID();
    await pool.query(`INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
      userId,
      `catalog01a-${userId.slice(0, 8)}@example.com`,
    ]);
    const profile = await pool.query<{ id: string }>(
      `INSERT INTO "UserProfile" ("userId", "trainingLevel", "workoutsPerWeek", "equipmentCodesJson")
       VALUES ($1, 'BEGINNER', 3, '["BODYWEIGHT","NONE","RESISTANCE_BAND"]'::jsonb)
       ON CONFLICT ("userId") DO UPDATE
       SET "trainingLevel" = 'BEGINNER', "workoutsPerWeek" = 3,
           "equipmentCodesJson" = '["BODYWEIGHT","NONE","RESISTANCE_BAND"]'::jsonb
       RETURNING id`,
      [userId],
    );
    const profileId = profile.rows[0]?.id;
    if (profileId) {
      await pool.query(
        `INSERT INTO "UserGoal" ("profileId", kind, target, unit)
         VALUES ($1, 'lose_weight', 70, 'kg')`,
        [profileId],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "WorkoutPlan" WHERE "userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "WorkoutProfile" WHERE "userId" = $1`, [userId]);
    await pool
      .query(
        `DELETE FROM "UserGoal" WHERE "profileId" IN (SELECT id FROM "UserProfile" WHERE "userId" = $1)`,
        [userId],
      )
      .catch(() => undefined);
    await pool
      .query(`DELETE FROM "UserProfile" WHERE "userId" = $1`, [userId])
      .catch(() => undefined);
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [userId]).catch(() => undefined);
    await assertCanonicalPublished(pool);
    await pool.end();
  });

  it("canonical published release exists with 84 APPROVED items; bootstrap retained as RETIRED", async () => {
    const canonical = await pool.query<{ status: string; count: string }>(
      `SELECT rel.status, COUNT(i.id)::text AS count
       FROM "WorkoutCatalogRelease" rel
       JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       WHERE rel.code = $1 AND i."enabledForGenerator" = true AND r.status = 'APPROVED'
       GROUP BY rel.status`,
      [CANONICAL_RELEASE_CODE],
    );
    expect(Number(canonical.rows[0]?.count)).toBe(84);
    expect(canonical.rows[0]?.status).toMatch(/PUBLISHED|RETIRED/);
    const bootstrap = await pool.query<{ status: string; items: string }>(
      `SELECT rel.status, COUNT(i.id)::text AS items
       FROM "WorkoutCatalogRelease" rel
       LEFT JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
       WHERE rel.code = $1
       GROUP BY rel.status`,
      [BOOTSTRAP_RELEASE_CODE],
    );
    expect(bootstrap.rows[0]?.status).toBe("RETIRED");
    expect(Number(bootstrap.rows[0]?.items)).toBe(20);
  });

  it("bootstrap is idempotent (revision/release item counts stable)", async () => {
    const before = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "ExerciseRevision" r
       JOIN "Exercise" e ON e.id = r."exerciseId"
       WHERE r."revisionNumber" = 1 AND e.key = 'bodyweight_squats'`,
    );
    await pool.query(`
      INSERT INTO "ExerciseRevision" (
        "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy", "approvedAt"
      )
      SELECT e.id, 1, 'APPROVED', COALESCE(e."nameRu", e.name), COALESCE(e."nameEn", e.name),
             'system:workout-catalog-01a', now()
      FROM "Exercise" e WHERE e.key = 'bodyweight_squats'
      ON CONFLICT ("exerciseId", "revisionNumber") DO NOTHING
    `);
    const after = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "ExerciseRevision" r
       JOIN "Exercise" e ON e.id = r."exerciseId"
       WHERE r."revisionNumber" = 1 AND e.key = 'bodyweight_squats'`,
    );
    expect(before.rows[0]?.c).toBe("1");
    expect(after.rows[0]?.c).toBe("1");
  });

  it("rejects content update of APPROVED revision", async () => {
    const rev = await pool.query<{ id: string }>(
      `SELECT r.id FROM "ExerciseRevision" r
       JOIN "Exercise" e ON e.id = r."exerciseId"
       WHERE e.key = 'push_ups' AND r.status = 'APPROVED' LIMIT 1`,
    );
    await expectDbReject(
      () =>
        pool.query(`UPDATE "ExerciseRevision" SET "nameRu" = 'X' WHERE id = $1`, [rev.rows[0]!.id]),
      /EXERCISE_REVISION_IMMUTABLE/,
    );
  });

  it("allows APPROVEDв†’RETIRED only when not pinned by PUBLISHED release", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const exercise = await client.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key = 'mobility_flow' LIMIT 1`,
      );
      const nextRev = await client.query<{ n: number }>(
        `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
         FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
        [exercise.rows[0]!.id],
      );
      // Dedicated APPROVED revision that is not in any release item.
      const created = await client.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy", "approvedAt"
         ) VALUES ($1, $2, 'APPROVED', 'retire-ok', 'retire-ok', 'test', now())
         RETURNING id`,
        [exercise.rows[0]!.id, nextRev.rows[0]!.n],
      );
      const id = created.rows[0]!.id;
      await client.query(`UPDATE "ExerciseRevision" SET status = 'RETIRED' WHERE id = $1`, [id]);

      const rejectInTx = async (label: string, sql: string, params: unknown[]) => {
        await client.query(`SAVEPOINT ${label}`);
        try {
          await client.query(sql, params);
          throw new Error(`EXPECTED_REJECT_${label}`);
        } catch (error) {
          const message = String((error as Error).message ?? error);
          expect(message).toMatch(/EXERCISE_REVISION_IMMUTABLE/);
          await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
        }
      };

      await rejectInTx("sp_content", `UPDATE "ExerciseRevision" SET "nameRu" = 'Z' WHERE id = $1`, [
        id,
      ]);
      await rejectInTx(
        "sp_reapprove",
        `UPDATE "ExerciseRevision" SET status = 'APPROVED' WHERE id = $1`,
        [id],
      );
      await rejectInTx(
        "sp_created",
        `UPDATE "ExerciseRevision" SET "createdBy" = 'attacker' WHERE id = $1`,
        [id],
      );
      await rejectInTx(
        "sp_approved_at",
        `UPDATE "ExerciseRevision" SET "approvedAt" = NULL WHERE id = $1`,
        [id],
      );
      await rejectInTx(
        "sp_reviewed",
        `UPDATE "ExerciseRevision" SET "reviewedAt" = now() WHERE id = $1`,
        [id],
      );
      await client.query("ROLLBACK");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw error;
    } finally {
      client.release();
    }
  });

  it("rejects RETIRE of revision pinned by PUBLISHED release", async () => {
    const rev = await pool.query<{ id: string }>(
      `SELECT i."exerciseRevisionId" AS id
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
       WHERE r.status = 'PUBLISHED' AND i."enabledForGenerator" = true
       LIMIT 1`,
    );
    await expectDbReject(
      () =>
        pool.query(`UPDATE "ExerciseRevision" SET status = 'RETIRED' WHERE id = $1`, [
          rev.rows[0]!.id,
        ]),
      /EXERCISE_REVISION_PUBLISHED_RELEASE_PINNED/,
    );
  });

  it("rejects deactivating Exercise pinned by published generator item", async () => {
    const ex = await pool.query<{ id: string }>(
      `SELECT i."exerciseId" AS id
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
       WHERE r.status = 'PUBLISHED' AND i."enabledForGenerator" = true
       LIMIT 1`,
    );
    await expectDbReject(
      () => pool.query(`UPDATE "Exercise" SET "isActive" = false WHERE id = $1`, [ex.rows[0]!.id]),
      /EXERCISE_ACTIVE_PUBLISHED_RELEASE_PINNED/,
    );
  });

  it("rejects SafetyProfile INSERT/UPDATE/DELETE after approval", async () => {
    const rev = await pool.query<{ id: string }>(
      `SELECT r.id FROM "ExerciseRevision" r
       JOIN "Exercise" e ON e.id = r."exerciseId"
       WHERE e.key = 'glute_bridge' AND r.status = 'APPROVED' LIMIT 1`,
    );
    await expectDbReject(
      () =>
        pool.query(
          `UPDATE "ExerciseSafetyProfile" SET "kneeLoad" = 'HIGH' WHERE "exerciseRevisionId" = $1`,
          [rev.rows[0]!.id],
        ),
      /EXERCISE_SAFETY_PROFILE_IMMUTABLE/,
    );
    await expectDbReject(
      () =>
        pool.query(`DELETE FROM "ExerciseSafetyProfile" WHERE "exerciseRevisionId" = $1`, [
          rev.rows[0]!.id,
        ]),
      /EXERCISE_SAFETY_PROFILE_IMMUTABLE/,
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const exercise = await client.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key = 'push_ups' LIMIT 1`,
      );
      const nextRev = await client.query<{ n: number }>(
        `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
         FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
        [exercise.rows[0]!.id],
      );
      const bare = await client.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy"
         ) VALUES ($1, $2, 'DRAFT', 'no-safety', 'no-safety', 'test')
         RETURNING id`,
        [exercise.rows[0]!.id, nextRev.rows[0]!.n],
      );
      await client.query(`UPDATE "ExerciseRevision" SET status = 'APPROVED' WHERE id = $1`, [
        bare.rows[0]!.id,
      ]);
      await client.query("SAVEPOINT sp_safety_ins");
      try {
        await client.query(
          `INSERT INTO "ExerciseSafetyProfile" (
             "exerciseRevisionId", "kneeLoad", "shoulderLoad", "spineLoad",
             "impactLevel", "balanceRequirement"
           ) VALUES ($1, 'LOW', 'LOW', 'LOW', 'LOW', 'LOW')`,
          [bare.rows[0]!.id],
        );
        throw new Error("EXPECTED_SAFETY_INSERT_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/EXERCISE_SAFETY_PROFILE_IMMUTABLE/);
        await client.query("ROLLBACK TO SAVEPOINT sp_safety_ins");
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("rejects ExerciseSourceReference INSERT/UPDATE/DELETE after approval", async () => {
    const ref = await pool.query<{ id: string; revisionId: string; sourceId: string }>(
      `SELECT x.id, x."exerciseRevisionId" AS "revisionId", x."sourceId"
       FROM "ExerciseSourceReference" x
       JOIN "ExerciseRevision" r ON r.id = x."exerciseRevisionId"
       WHERE r.status = 'APPROVED' LIMIT 1`,
    );
    await expectDbReject(
      () =>
        pool.query(`UPDATE "ExerciseSourceReference" SET "factualNotes" = 'HACK' WHERE id = $1`, [
          ref.rows[0]!.id,
        ]),
      /EXERCISE_SOURCE_REFERENCE_IMMUTABLE/,
    );
    await expectDbReject(
      () => pool.query(`DELETE FROM "ExerciseSourceReference" WHERE id = $1`, [ref.rows[0]!.id]),
      /EXERCISE_SOURCE_REFERENCE_IMMUTABLE/,
    );
    await expectDbReject(
      () =>
        pool.query(
          `INSERT INTO "ExerciseSourceReference" (
             "exerciseRevisionId", "sourceId", "externalReference", "factualNotes"
           ) VALUES ($1, $2, 'bypass', 'MUTATED')`,
          [ref.rows[0]!.revisionId, ref.rows[0]!.sourceId],
        ),
      /EXERCISE_SOURCE_REFERENCE_IMMUTABLE/,
    );
  });

  it("rejects mutation of PUBLISHED release items", async () => {
    const item = await pool.query<{ id: string }>(
      `SELECT i.id FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
       WHERE r.code = $1 LIMIT 1`,
      [BOOTSTRAP_RELEASE_CODE],
    );
    await expectDbReject(
      () =>
        pool.query(`UPDATE "WorkoutCatalogReleaseItem" SET ordinal = ordinal WHERE id = $1`, [
          item.rows[0]!.id,
        ]),
      /WORKOUT_CATALOG_RELEASE_ITEM_IMMUTABLE/,
    );
  });

  it("allows at most one PUBLISHED release via unique index", async () => {
    await expectDbReject(
      () =>
        pool.query(
          `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "publishedAt")
           VALUES ($1, 'PUBLISHED', 'x', now())`,
          [`dup-published-${randomUUID()}`],
        ),
      /./,
    );
  });

  it("rejects release item with non-APPROVED revision on INSERT and UPDATE enable bypass", async () => {
    const draftCode = `draft-${randomUUID()}`;
    const draft = await pool.query<{ id: string }>(
      `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
       VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01a.1')
       RETURNING id`,
      [draftCode],
    );
    const exercise = await pool.query<{ id: string; familyId: string }>(
      `SELECT id, "familyId" FROM "Exercise" WHERE key = 'dead_bug'`,
    );
    const nextRev = await pool.query<{ n: number }>(
      `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
       FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
      [exercise.rows[0]!.id],
    );
    const draftRev = await pool.query<{ id: string }>(
      `INSERT INTO "ExerciseRevision" (
         "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy"
       ) VALUES ($1, $2, 'DRAFT', 't', 't', 'test')
       RETURNING id`,
      [exercise.rows[0]!.id, nextRev.rows[0]!.n],
    );
    await expectDbReject(
      () =>
        pool.query(
          `INSERT INTO "WorkoutCatalogReleaseItem" (
             "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
           ) VALUES ($1, $2, $3, $4, 1, false)`,
          [
            draft.rows[0]!.id,
            exercise.rows[0]!.id,
            draftRev.rows[0]!.id,
            exercise.rows[0]!.familyId,
          ],
        ),
      /WORKOUT_CATALOG_RELEASE_ITEM_REQUIRES_APPROVED/,
    );

    const approved = await pool.query<{ id: string }>(
      `SELECT r.id FROM "ExerciseRevision" r
       WHERE r."exerciseId" = $1 AND r.status = 'APPROVED' LIMIT 1`,
      [exercise.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO "WorkoutCatalogReleaseItem" (
         "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
       ) VALUES ($1, $2, $3, $4, 1, false)`,
      [draft.rows[0]!.id, exercise.rows[0]!.id, approved.rows[0]!.id, exercise.rows[0]!.familyId],
    );
    await expectDbReject(
      () =>
        pool.query(
          `UPDATE "WorkoutCatalogReleaseItem"
           SET "exerciseRevisionId" = $2, "enabledForGenerator" = true
           WHERE "releaseId" = $1`,
          [draft.rows[0]!.id, draftRev.rows[0]!.id],
        ),
      /WORKOUT_CATALOG_RELEASE_ITEM_REQUIRES_APPROVED/,
    );

    await pool.query(`DELETE FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`, [
      draft.rows[0]!.id,
    ]);
    await pool.query(`DELETE FROM "ExerciseRevision" WHERE id = $1`, [draftRev.rows[0]!.id]);
    await pool.query(`DELETE FROM "WorkoutCatalogRelease" WHERE id = $1`, [draft.rows[0]!.id]);
  });

  it("rejects family mismatch and revision/exercise mismatch on items", async () => {
    const draft = await pool.query<{ id: string }>(
      `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
       VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01a.1') RETURNING id`,
      [`fam-${randomUUID()}`],
    );
    const deadBug = await pool.query<{
      id: string;
      familyId: string;
      revisionId: string;
    }>(
      `SELECT e.id, e."familyId", r.id AS "revisionId"
       FROM "Exercise" e
       JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r.status = 'APPROVED'
       WHERE e.key = 'dead_bug' LIMIT 1`,
    );
    const otherFamily = await pool.query<{ id: string }>(
      `SELECT id FROM "ExerciseFamily" WHERE id <> $1 LIMIT 1`,
      [deadBug.rows[0]!.familyId],
    );
    await expectDbReject(
      () =>
        pool.query(
          `INSERT INTO "WorkoutCatalogReleaseItem" (
             "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
           ) VALUES ($1, $2, $3, $4, 1, true)`,
          [
            draft.rows[0]!.id,
            deadBug.rows[0]!.id,
            deadBug.rows[0]!.revisionId,
            otherFamily.rows[0]!.id,
          ],
        ),
      /WORKOUT_CATALOG_RELEASE_ITEM_FAMILY_MISMATCH/,
    );

    const pushUps = await pool.query<{ id: string; revisionId: string }>(
      `SELECT e.id, r.id AS "revisionId"
       FROM "Exercise" e
       JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r.status = 'APPROVED'
       WHERE e.key = 'push_ups' LIMIT 1`,
    );
    await expectDbReject(
      () =>
        pool.query(
          `INSERT INTO "WorkoutCatalogReleaseItem" (
             "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
           ) VALUES ($1, $2, $3, $4, 1, true)`,
          [
            draft.rows[0]!.id,
            deadBug.rows[0]!.id,
            pushUps.rows[0]!.revisionId,
            deadBug.rows[0]!.familyId,
          ],
        ),
      /WORKOUT_CATALOG_RELEASE_ITEM_REVISION_MISMATCH/,
    );

    await pool.query(`DELETE FROM "WorkoutCatalogRelease" WHERE id = $1`, [draft.rows[0]!.id]);
  });

  it("rejects empty DRAFTв†’PUBLISHED, only-disabled publish, and family-frozen Exercise updates", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE "WorkoutCatalogRelease" SET status = 'RETIRED', "retiredAt" = now()
         WHERE status = 'PUBLISHED'`,
      );
      const empty = await client.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
         VALUES ($1, 'DRAFT', 't') RETURNING id`,
        [`empty-${randomUUID()}`],
      );
      await client.query("SAVEPOINT sp_empty");
      try {
        await client.query(
          `UPDATE "WorkoutCatalogRelease" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
          [empty.rows[0]!.id],
        );
        throw new Error("EXPECTED_EMPTY_PUBLISH_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/WORKOUT_CATALOG_RELEASE_EMPTY/);
        await client.query("ROLLBACK TO SAVEPOINT sp_empty");
      }

      const disabledOnly = await client.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
         VALUES ($1, 'DRAFT', 't') RETURNING id`,
        [`disabled-${randomUUID()}`],
      );
      const approved = await client.query<{
        exerciseId: string;
        familyId: string;
        revisionId: string;
      }>(
        `SELECT e.id AS "exerciseId", e."familyId", r.id AS "revisionId"
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r.status = 'APPROVED'
         WHERE e.key = 'push_ups' LIMIT 1`,
      );
      await client.query(
        `INSERT INTO "WorkoutCatalogReleaseItem" (
           "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
         ) VALUES ($1, $2, $3, $4, 1, false)`,
        [
          disabledOnly.rows[0]!.id,
          approved.rows[0]!.exerciseId,
          approved.rows[0]!.revisionId,
          approved.rows[0]!.familyId,
        ],
      );
      await client.query("SAVEPOINT sp_disabled");
      try {
        await client.query(
          `UPDATE "WorkoutCatalogRelease" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
          [disabledOnly.rows[0]!.id],
        );
        throw new Error("EXPECTED_DISABLED_ONLY_PUBLISH_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/WORKOUT_CATALOG_RELEASE_EMPTY/);
        await client.query("ROLLBACK TO SAVEPOINT sp_disabled");
      }

      // Mixed: one eligible + one disabled в†’ publish succeeds under lock.
      const mixed = await client.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
         VALUES ($1, 'DRAFT', 't') RETURNING id`,
        [`mixed-${randomUUID()}`],
      );
      const second = await client.query<{
        exerciseId: string;
        familyId: string;
        revisionId: string;
      }>(
        `SELECT e.id AS "exerciseId", e."familyId", r.id AS "revisionId"
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r.status = 'APPROVED'
         WHERE e.key = 'dead_bug' LIMIT 1`,
      );
      await client.query(
        `INSERT INTO "WorkoutCatalogReleaseItem" (
           "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
         ) VALUES
           ($1, $2, $3, $4, 1, true),
           ($1, $5, $6, $7, 2, false)`,
        [
          mixed.rows[0]!.id,
          approved.rows[0]!.exerciseId,
          approved.rows[0]!.revisionId,
          approved.rows[0]!.familyId,
          second.rows[0]!.exerciseId,
          second.rows[0]!.revisionId,
          second.rows[0]!.familyId,
        ],
      );
      await client.query(
        `UPDATE "WorkoutCatalogRelease" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
        [mixed.rows[0]!.id],
      );
      const mixedStatus = await client.query<{ status: string }>(
        `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
        [mixed.rows[0]!.id],
      );
      expect(mixedStatus.rows[0]?.status).toBe("PUBLISHED");

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const ex = await pool.query<{ id: string }>(`SELECT id FROM "Exercise" WHERE key = 'push_ups'`);
    const otherFamily = await pool.query<{ id: string }>(
      `SELECT f.id FROM "ExerciseFamily" f
       JOIN "Exercise" e ON e."familyId" = f.id
       WHERE e.key = 'dead_bug' LIMIT 1`,
    );
    await expectDbReject(
      () =>
        pool.query(`UPDATE "Exercise" SET "familyId" = $2 WHERE id = $1`, [
          ex.rows[0]!.id,
          otherFamily.rows[0]!.id,
        ]),
      /EXERCISE_FAMILY_IMMUTABLE/,
    );
  });

  it("variant partial indexes exist (active = true)", async () => {
    const idxs = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'ExerciseVariantRelation'
         AND indexname IN ('ExerciseVariantRelation_from_idx', 'ExerciseVariantRelation_to_idx')`,
    );
    expect(idxs.rows).toHaveLength(2);
    for (const row of idxs.rows) {
      expect(row.indexdef).toMatch(/WHERE \(active = true\)/);
    }
  });

  it("atomic publish retires previous and leaves exactly one PUBLISHED", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const catalog = new WorkoutCatalogReleaseService(createDb());
      const prior = await catalog.resolveCurrentPublishedRelease();
      expect(prior).toBeTruthy();
      const client = await pool.connect();
      let draftId = "";
      try {
        draftId = await insertDraftReleaseWithApprovedItems(client, `switch-${randomUUID()}`, [
          "push_ups",
          "dead_bug",
          "glute_bridge",
          "bodyweight_squats",
        ]);
      } finally {
        client.release();
      }
      expect((await catalog.publishRelease(draftId)).status).toBe("PUBLISHED");
      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
            )
          ).rows[0]?.c,
        ),
      ).toBe(1);
      expect(
        (
          await pool.query<{ status: string }>(
            `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
            [prior!.id],
          )
        ).rows[0]?.status,
      ).toBe("RETIRED");
    });
  });

  it("publish rollback preserves prior PUBLISHED release", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const catalog = new WorkoutCatalogReleaseService(createDb());
      const prior = await catalog.resolveCurrentPublishedRelease();
      expect(prior).toBeTruthy();
      await expect(
        createDb().withTransaction(async (query) => {
          await query(`SELECT pg_advisory_xact_lock($1)`, [CATALOG_PUBLISH_ADVISORY_LOCK_KEY]);
          await query(
            `UPDATE "WorkoutCatalogRelease" SET status = 'RETIRED', "retiredAt" = now() WHERE id = $1`,
            [prior!.id],
          );
          throw new Error("FORCE_ROLLBACK");
        }),
      ).rejects.toThrow(/FORCE_ROLLBACK/);
      expect(
        (
          await pool.query<{ status: string }>(
            `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
            [prior!.id],
          )
        ).rows[0]?.status,
      ).toBe("PUBLISHED");
    });
  });

  it("concurrent publish leaves exactly one PUBLISHED and serializes via advisory lock", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const poolA = new Pool({ connectionString });
      poolA.on("error", () => undefined);
      const poolB = new Pool({ connectionString });
      poolB.on("error", () => undefined);
      const clientSeed = await pool.connect();
      let draftA = "";
      let draftB = "";
      try {
        draftA = await insertDraftReleaseWithApprovedItems(clientSeed, `conc-a-${randomUUID()}`, [
          "push_ups",
          "dead_bug",
          "glute_bridge",
          "stretching",
        ]);
        draftB = await insertDraftReleaseWithApprovedItems(clientSeed, `conc-b-${randomUUID()}`, [
          "band_row",
          "goblet_squat",
          "core_plank",
          "morning_walk",
        ]);
      } finally {
        clientSeed.release();
      }

      const catalogA = new WorkoutCatalogReleaseService(createDb(poolA));
      const catalogB = new WorkoutCatalogReleaseService(createDb(poolB));
      const results = await Promise.allSettled([
        catalogA.publishRelease(draftA),
        catalogB.publishRelease(draftB),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const published = await pool.query<{ id: string; code: string }>(
        `SELECT id, code FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(published.rows).toHaveLength(1);
      expect([draftA, draftB]).toContain(published.rows[0]!.id);

      // Unique-index race without retire: second PUBLISHED insert/update fails.
      await expectDbReject(
        () =>
          pool.query(
            `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion", "publishedAt")
           VALUES ($1, 'PUBLISHED', 'x', now())`,
            [`race-${randomUUID()}`],
          ),
        /./,
      );

      await poolA.end();
      await poolB.end();
    });
  });

  it("concurrent publish vs RETIRE member revision preserves published integrity", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const poolA = new Pool({ connectionString });
      poolA.on("error", () => undefined);
      const poolB = new Pool({ connectionString });
      poolB.on("error", () => undefined);
      const seed = await pool.connect();
      let draftId = "";
      let memberRevisionId = "";
      try {
        const exercise = await seed.query<{ id: string; familyId: string }>(
          `SELECT id, "familyId" FROM "Exercise" WHERE key = 'push_ups' LIMIT 1`,
        );
        const nextRev = await seed.query<{ n: number }>(
          `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
         FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
          [exercise.rows[0]!.id],
        );
        const created = await seed.query<{ id: string }>(
          `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy", "approvedAt"
         ) VALUES ($1, $2, 'APPROVED', 'race-rev', 'race-rev', 'test', now())
         RETURNING id`,
          [exercise.rows[0]!.id, nextRev.rows[0]!.n],
        );
        memberRevisionId = created.rows[0]!.id;

        const draft = await seed.query<{ id: string }>(
          `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
         VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01a.1')
         RETURNING id`,
          [`race-pub-${randomUUID()}`],
        );
        draftId = draft.rows[0]!.id;
        await seed.query(
          `INSERT INTO "WorkoutCatalogReleaseItem" (
           "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
         ) VALUES ($1, $2, $3, $4, 1, true)`,
          [draftId, exercise.rows[0]!.id, memberRevisionId, exercise.rows[0]!.familyId],
        );
      } finally {
        seed.release();
      }

      const hold = await pool.connect();
      await hold.query("BEGIN");
      await hold.query(`SELECT pg_advisory_xact_lock($1)`, [CATALOG_PUBLISH_ADVISORY_LOCK_KEY]);

      const catalogA = new WorkoutCatalogReleaseService(createDb(poolA));
      const publishP = catalogA.publishRelease(draftId).then(
        (row) => ({ ok: true as const, row }),
        (error: Error) => ({ ok: false as const, error: String(error.message ?? error) }),
      );
      const retireP = (async () => {
        const client = await poolB.connect();
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE "ExerciseRevision" SET status = 'RETIRED' WHERE id = $1`, [
            memberRevisionId,
          ]);
          await client.query("COMMIT");
          return { ok: true as const };
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore
          }
          return { ok: false as const, error: String((error as Error).message ?? error) };
        } finally {
          client.release();
        }
      })();

      await new Promise((r) => setTimeout(r, 400));
      await hold.query("COMMIT");
      hold.release();

      const [pubResult, retireResult] = await Promise.all([publishP, retireP]);
      const published = await pool.query<{ id: string }>(
        `SELECT id FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(published.rows).toHaveLength(1);

      const pinnedStatus = await pool.query<{ status: string }>(
        `SELECT status FROM "ExerciseRevision" WHERE id = $1`,
        [memberRevisionId],
      );

      // Exactly one of: publish succeeded with APPROVED member, or retire succeeded and publish failed.
      if (pubResult.ok) {
        expect(published.rows[0]!.id).toBe(draftId);
        expect(pinnedStatus.rows[0]?.status).toBe("APPROVED");
        expect(retireResult.ok).toBe(false);
        expect(retireResult.error).toMatch(/EXERCISE_REVISION_PUBLISHED_RELEASE_PINNED/);
      } else {
        expect(retireResult.ok).toBe(true);
        expect(pinnedStatus.rows[0]?.status).toBe("RETIRED");
        expect(published.rows[0]!.id).not.toBe(draftId);
      }

      const eligible = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       JOIN "Exercise" e ON e.id = i."exerciseId"
       WHERE rel.status = 'PUBLISHED'
         AND i."enabledForGenerator" = true
         AND r.status = 'APPROVED'
         AND r."exerciseId" = i."exerciseId"
         AND e."familyId" IS NOT DISTINCT FROM i."familyId"
         AND e."isActive" = true
         AND e.key IS NOT NULL`,
      );
      expect(Number(eligible.rows[0]?.c)).toBeGreaterThanOrEqual(1);

      await poolA.end();
      await poolB.end();
    });
  });

  it("generator uses published release, stores provenance, and is DB-deterministic", async () => {
    const profiles = new WorkoutProfileRepository(db);
    const repo = new WorkoutEngineRepository(db);
    const profileStub = {
      async getProfile() {
        return {
          trainingLevel: "BEGINNER",
          workoutsPerWeek: 3,
          equipmentCodes: ["BODYWEIGHT", "NONE", "RESISTANCE_BAND"],
        };
      },
      async getGoal() {
        return { kind: "lose_weight", target: 70, unit: "kg" };
      },
    };
    const engine2 = new WorkoutEngineService(repo, profileStub as never, db, profiles, catalog);

    await profiles.createDefaults(userId, { trainingLevel: "BEGINNER", workoutsPerWeek: 3 });
    await profiles.update(userId, {
      trainingLevel: "BEGINNER",
      trainingPlace: "HOME",
      workoutsPerWeek: 3,
      preferredDuration: "STANDARD",
      availableDays: [0, 2, 4],
      workoutEquipment: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND"],
      preferredActivityTypes: ["strength", "walking", "mobility"],
      excludedExerciseKeys: [],
    });

    const summary1 = await engine2.generatePlan(userId);
    const summary2 = await engine2.generatePlan(userId);
    expect(summary1.version).toBeGreaterThan(0);
    expect(summary2.version).toBeGreaterThan(summary1.version);

    const plans = await pool.query<{
      algorithmVersion: string;
      workoutCatalogReleaseCode: string | null;
      workoutCatalogReleaseId: string | null;
      id: string;
    }>(
      `SELECT id, "algorithmVersion", "workoutCatalogReleaseCode", "workoutCatalogReleaseId"
       FROM "WorkoutPlan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 2`,
      [userId],
    );
    expect(plans.rows[0]?.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(plans.rows[0]?.workoutCatalogReleaseCode).toBeTruthy();
    expect(plans.rows[0]?.workoutCatalogReleaseId).toBeTruthy();

    const keysFor = async (planId: string) => {
      const keys = await pool.query<{ dayIndex: number; key: string | null }>(
        `SELECT d."dayIndex", e.key
         FROM "WorkoutPlanDay" d
         LEFT JOIN "Exercise" e ON e.id = d."exerciseId"
         WHERE d."workoutPlanId" = $1 AND d."isRestDay" = false
         ORDER BY d."dayIndex", d."exerciseOrder"`,
        [planId],
      );
      return keys.rows.map((r) => `${r.dayIndex}:${r.key}`);
    };
    expect(await keysFor(plans.rows[0]!.id)).toEqual(await keysFor(plans.rows[1]!.id));

    const release = await catalog.resolveCurrentPublishedRelease();
    const allowed = await pool.query<{ key: string }>(
      `SELECT e.key
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "Exercise" e ON e.id = i."exerciseId"
       WHERE i."releaseId" = $1`,
      [release!.id],
    );
    const allowedSet = new Set(allowed.rows.map((r) => r.key));
    for (const token of await keysFor(plans.rows[0]!.id)) {
      const key = token.split(":")[1]!;
      expect(allowedSet.has(key)).toBe(true);
    }
  });

  it("no published release: controlled error and no partial plan rows", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      const db = createDb();
      const catalog = new WorkoutCatalogReleaseService(db);
      const disposableUserId = randomUUID();
      await pool.query(`INSERT INTO "User" (id, email) VALUES ($1, $2)`, [
        disposableUserId,
        `catalog-missing-${disposableUserId}@example.com`,
      ]);
      await pool.query(
        `UPDATE "WorkoutCatalogRelease" SET status = 'RETIRED', "retiredAt" = now() WHERE status = 'PUBLISHED'`,
      );
      const beforePlans = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutPlan" WHERE "userId" = $1`,
        [disposableUserId],
      );
      const profiles = new WorkoutProfileRepository(db);
      const engine = new WorkoutEngineService(
        new WorkoutEngineRepository(db),
        {
          async getProfile() {
            return {
              trainingLevel: "BEGINNER",
              workoutsPerWeek: 3,
              equipmentCodes: ["BODYWEIGHT"],
            };
          },
          async getGoal() {
            return { kind: "lose_weight", target: 70, unit: "kg" };
          },
        } as never,
        db,
        profiles,
        catalog,
      );
      await expect(engine.generatePlan(disposableUserId)).rejects.toThrow(
        /WORKOUT_CATALOG_RELEASE_MISSING/,
      );
      const afterPlans = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutPlan" WHERE "userId" = $1`,
        [disposableUserId],
      );
      expect(afterPlans.rows[0]?.c).toBe(beforePlans.rows[0]?.c);
    });
  });

  it("FIX3: rejects null-key-only publish; accepts mixed null+valid; pins published keys", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE "WorkoutCatalogRelease" SET status = 'RETIRED', "retiredAt" = now()
         WHERE status = 'PUBLISHED'`,
      );

      const fam = await client.query<{ id: string }>(`SELECT id FROM "ExerciseFamily" LIMIT 1`);
      const nullEx = await client.query<{ id: string }>(
        `INSERT INTO "Exercise" (id, name, "riskLevel", "movementPattern", difficulty, "familyId", "isActive", key)
         VALUES (gen_random_uuid(), 'fix3-null-key', 'low', 'cardio', 'BEGINNER', $1, true, NULL)
         RETURNING id`,
        [fam.rows[0]!.id],
      );
      const nullRev = await client.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy", "approvedAt"
         ) VALUES ($1, 1, 'APPROVED', 'n', 'n', 'fix3', now())
         RETURNING id`,
        [nullEx.rows[0]!.id],
      );

      const nullOnly = await client.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
         VALUES ($1, 'DRAFT', 't') RETURNING id`,
        [`null-only-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO "WorkoutCatalogReleaseItem" (
           "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
         ) VALUES ($1, $2, $3, $4, 1, true)`,
        [nullOnly.rows[0]!.id, nullEx.rows[0]!.id, nullRev.rows[0]!.id, fam.rows[0]!.id],
      );
      await client.query("SAVEPOINT sp_null_only");
      try {
        await client.query(
          `UPDATE "WorkoutCatalogRelease" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
          [nullOnly.rows[0]!.id],
        );
        throw new Error("EXPECTED_NULL_KEY_ONLY_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/WORKOUT_CATALOG_RELEASE_EMPTY/);
        await client.query("ROLLBACK TO SAVEPOINT sp_null_only");
      }

      const valid = await client.query<{
        exerciseId: string;
        familyId: string;
        revisionId: string;
      }>(
        `SELECT e.id AS "exerciseId", e."familyId", r.id AS "revisionId"
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r.status = 'APPROVED'
         WHERE e.key = 'push_ups' LIMIT 1`,
      );
      const mixed = await client.query<{ id: string }>(
        `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
         VALUES ($1, 'DRAFT', 't') RETURNING id`,
        [`null-mix-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO "WorkoutCatalogReleaseItem" (
           "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
         ) VALUES
           ($1, $2, $3, $4, 1, true),
           ($1, $5, $6, $7, 2, true)`,
        [
          mixed.rows[0]!.id,
          valid.rows[0]!.exerciseId,
          valid.rows[0]!.revisionId,
          valid.rows[0]!.familyId,
          nullEx.rows[0]!.id,
          nullRev.rows[0]!.id,
          fam.rows[0]!.id,
        ],
      );
      await client.query(
        `UPDATE "WorkoutCatalogRelease" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
        [mixed.rows[0]!.id],
      );
      const elig = await client.query<{ c: string }>(
        `SELECT workout_catalog_release_eligible_item_count($1::uuid)::text AS c`,
        [mixed.rows[0]!.id],
      );
      expect(Number(elig.rows[0]?.c)).toBe(1);

      await client.query("SAVEPOINT sp_key_null");
      try {
        await client.query(`UPDATE "Exercise" SET key = NULL WHERE id = $1`, [
          valid.rows[0]!.exerciseId,
        ]);
        throw new Error("EXPECTED_KEY_NULL_PINNED_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/EXERCISE_KEY_PUBLISHED_RELEASE_PINNED/);
        await client.query("ROLLBACK TO SAVEPOINT sp_key_null");
      }

      await client.query("SAVEPOINT sp_key_change");
      try {
        await client.query(`UPDATE "Exercise" SET key = 'hacked_push_ups' WHERE id = $1`, [
          valid.rows[0]!.exerciseId,
        ]);
        throw new Error("EXPECTED_KEY_CHANGE_PINNED_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/EXERCISE_KEY_PUBLISHED_RELEASE_PINNED/);
        await client.query("ROLLBACK TO SAVEPOINT sp_key_change");
      }

      await client.query("SAVEPOINT sp_key_multi");
      try {
        await client.query(
          `UPDATE "Exercise" e SET key = NULL
           FROM "WorkoutCatalogReleaseItem" i
           JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
           WHERE e.id = i."exerciseId" AND r.status = 'PUBLISHED'`,
        );
        throw new Error("EXPECTED_MULTI_KEY_NULL_REJECT");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/EXERCISE_KEY_PUBLISHED_RELEASE_PINNED/);
        await client.query("ROLLBACK TO SAVEPOINT sp_key_multi");
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // Unpinned pre-approval exercise may still receive a key.
    const freeKey = `fix3_free_key_${randomUUID().slice(0, 8)}`;
    const free = await pool.query<{ id: string }>(
      `INSERT INTO "Exercise" (id, name, "riskLevel", "isActive", key)
       VALUES (gen_random_uuid(), 'fix3-free-key', 'low', true, NULL)
       RETURNING id`,
    );
    await pool.query(`UPDATE "Exercise" SET key = $2 WHERE id = $1`, [free.rows[0]!.id, freeKey]);
    const after = await pool.query<{ key: string | null }>(
      `SELECT key FROM "Exercise" WHERE id = $1`,
      [free.rows[0]!.id],
    );
    expect(after.rows[0]?.key).toBe(freeKey);
    await pool.query(`DELETE FROM "Exercise" WHERE id = $1`, [free.rows[0]!.id]);
  });

  it("FIX3: exact eligibility predicate parity across generator/DB/service fixtures", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fam = await client.query<{ id: string }>(`SELECT id FROM "ExerciseFamily" LIMIT 1`);
      const otherFam = await client.query<{ id: string }>(
        `SELECT id FROM "ExerciseFamily" WHERE id <> $1 LIMIT 1`,
        [fam.rows[0]!.id],
      );

      const mk = async (key: string | null, status: string, active: boolean) => {
        const ex = await client.query<{ id: string }>(
          `INSERT INTO "Exercise" (id, name, "riskLevel", "movementPattern", difficulty, "familyId", "isActive", key)
           VALUES (gen_random_uuid(), coalesce($1, 'parity'), 'low', 'cardio', 'BEGINNER', $2, $3, $1)
           RETURNING id`,
          [key, fam.rows[0]!.id, active],
        );
        const rev = await client.query<{ id: string }>(
          `INSERT INTO "ExerciseRevision" (
             "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy", "approvedAt"
           ) VALUES ($1, 1, $2, 'p', 'p', 'fix3',
                     CASE WHEN $2 IN ('APPROVED', 'RETIRED') THEN now() ELSE NULL END)
           RETURNING id`,
          [ex.rows[0]!.id, status],
        );
        return {
          exerciseId: ex.rows[0]!.id,
          revisionId: rev.rows[0]!.id,
          familyId: fam.rows[0]!.id,
        };
      };

      const countTriple = async (releaseId: string) => {
        const dbC = Number(
          (
            await client.query<{ c: string }>(
              `SELECT workout_catalog_release_eligible_item_count($1::uuid)::text AS c`,
              [releaseId],
            )
          ).rows[0]!.c,
        );
        // Generator-shaped predicate without requiring PUBLISHED (parity of item filters).
        const genC = Number(
          (
            await client.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c
               FROM "WorkoutCatalogReleaseItem" i
               JOIN "Exercise" e ON e.id = i."exerciseId"
               JOIN "ExerciseRevision" rev ON rev.id = i."exerciseRevisionId"
               WHERE i."releaseId" = $1
                 AND i."enabledForGenerator" = true
                 AND rev.status = 'APPROVED'
                 AND rev."exerciseId" = i."exerciseId"
                 AND e."familyId" IS NOT DISTINCT FROM i."familyId"
                 AND e."isActive" = true
                 AND e.key IS NOT NULL`,
              [releaseId],
            )
          ).rows[0]!.c,
        );
        const svcC = Number(
          (
            await client.query<{ c: string }>(
              `SELECT COUNT(i.id) FILTER (
                 WHERE i."enabledForGenerator" = true
                    AND rev.id IS NOT NULL
                    AND rev.status = 'APPROVED'
                    AND rev."exerciseId" = i."exerciseId"
                    AND e."familyId" IS NOT DISTINCT FROM i."familyId"
                    AND e."isActive" IS TRUE
                    AND e.key IS NOT NULL
               )::text AS c
               FROM "WorkoutCatalogRelease" rel
               LEFT JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
               LEFT JOIN "ExerciseRevision" rev ON rev.id = i."exerciseRevisionId"
               LEFT JOIN "Exercise" e ON e.id = i."exerciseId"
               WHERE rel.id = $1
               GROUP BY rel.id`,
              [releaseId],
            )
          ).rows[0]?.c ?? 0,
        );
        return { dbC, genC, svcC };
      };

      const insertItem = async (
        releaseId: string,
        row: { exerciseId: string; revisionId: string; familyId: string },
        enabled: boolean,
        familyOverride?: string,
      ) => {
        await client.query(
          `INSERT INTO "WorkoutCatalogReleaseItem" (
             "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
           ) VALUES ($1, $2, $3, $4, 1, $5)`,
          [releaseId, row.exerciseId, row.revisionId, familyOverride ?? row.familyId, enabled],
        );
      };

      const newDraft = async () => {
        const rel = await client.query<{ id: string }>(
          `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
           VALUES ($1, 'DRAFT', 't') RETURNING id`,
          [`parity-${randomUUID()}`],
        );
        return rel.rows[0]!.id;
      };

      const healthy = await mk(`parity-ok-${randomUUID().slice(0, 8)}`, "APPROVED", true);
      {
        const id = await newDraft();
        await insertItem(id, healthy, true);
        expect(await countTriple(id)).toEqual({ dbC: 1, genC: 1, svcC: 1 });
      }
      {
        const n = await mk(null, "APPROVED", true);
        const id = await newDraft();
        await insertItem(id, n, true);
        expect(await countTriple(id)).toEqual({ dbC: 0, genC: 0, svcC: 0 });
      }
      {
        const n = await mk(`parity-inact-${randomUUID().slice(0, 8)}`, "APPROVED", true);
        const id = await newDraft();
        await insertItem(id, n, true);
        await client.query(`UPDATE "Exercise" SET "isActive" = false WHERE id = $1`, [
          n.exerciseId,
        ]);
        expect(await countTriple(id)).toEqual({ dbC: 0, genC: 0, svcC: 0 });
      }
      {
        const id = await newDraft();
        await insertItem(id, healthy, false);
        expect(await countTriple(id)).toEqual({ dbC: 0, genC: 0, svcC: 0 });
      }

      // DRAFT / RETIRED revision cannot be release items; compare predicate SQL directly.
      const draftRev = await mk(`parity-draft-${randomUUID().slice(0, 8)}`, "DRAFT", true);
      const retired = await mk(`parity-ret-${randomUUID().slice(0, 8)}`, "APPROVED", true);
      await client.query(`UPDATE "ExerciseRevision" SET status = 'RETIRED' WHERE id = $1`, [
        retired.revisionId,
      ]);
      const statusPred = async (exerciseId: string, revisionId: string) => {
        const r = await client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c
           FROM "Exercise" e
           JOIN "ExerciseRevision" rev ON rev.id = $2
           WHERE e.id = $1
             AND rev.status = 'APPROVED'
             AND rev."exerciseId" = e.id
             AND e."familyId" IS NOT DISTINCT FROM e."familyId"
             AND e."isActive" = true
             AND e.key IS NOT NULL`,
          [exerciseId, revisionId],
        );
        return Number(r.rows[0]!.c);
      };
      expect(await statusPred(draftRev.exerciseId, draftRev.revisionId)).toBe(0);
      expect(await statusPred(retired.exerciseId, retired.revisionId)).toBe(0);

      // exerciseId mismatch + family mismatch (synthetic COUNT)
      const other = await mk(`parity-other-${randomUUID().slice(0, 8)}`, "APPROVED", true);
      const mismatch = Number(
        (
          await client.query<{ c: string }>(
            `SELECT COUNT(*)::text AS c
             FROM "Exercise" e
             JOIN "ExerciseRevision" rev ON rev.id = $2
             WHERE e.id = $1
               AND rev.status = 'APPROVED'
               AND rev."exerciseId" = e.id
               AND e."familyId" IS NOT DISTINCT FROM e."familyId"
               AND e."isActive" = true
               AND e.key IS NOT NULL`,
            [healthy.exerciseId, other.revisionId],
          )
        ).rows[0]!.c,
      );
      expect(mismatch).toBe(0);
      const famMismatch = Number(
        (
          await client.query<{ c: string }>(
            `SELECT COUNT(*)::text AS c
             FROM "Exercise" e
             JOIN "ExerciseRevision" rev ON rev.id = $2
             WHERE e.id = $1
               AND rev.status = 'APPROVED'
               AND rev."exerciseId" = e.id
               AND e."familyId" IS NOT DISTINCT FROM $3::uuid
               AND e."isActive" = true
               AND e.key IS NOT NULL`,
            [healthy.exerciseId, healthy.revisionId, otherFam.rows[0]!.id],
          )
        ).rows[0]!.c,
      );
      expect(famMismatch).toBe(0);

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("FIX3: concurrent publish vs key mutation preserves published integrity", async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      const poolA = new Pool({ connectionString });
      poolA.on("error", () => undefined);
      const poolB = new Pool({ connectionString });
      poolB.on("error", () => undefined);
      const seed = await pool.connect();
      let draftId = "";
      let pinnedExerciseId = "";
      try {
        const pinned = await seed.query<{ id: string }>(
          `SELECT e.id
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE r.status = 'PUBLISHED' AND i."enabledForGenerator" = true
         ORDER BY i.ordinal ASC LIMIT 1`,
        );
        pinnedExerciseId = pinned.rows[0]!.id;
        draftId = await insertDraftReleaseWithApprovedItems(seed, `key-race-${randomUUID()}`, [
          "push_ups",
          "dead_bug",
          "band_row",
          "goblet_squat",
        ]);
      } finally {
        seed.release();
      }

      const hold = await pool.connect();
      await hold.query("BEGIN");
      await hold.query(`SELECT pg_advisory_xact_lock($1)`, [CATALOG_PUBLISH_ADVISORY_LOCK_KEY]);

      const catalogA = new WorkoutCatalogReleaseService(createDb(poolA));
      const publishP = catalogA.publishRelease(draftId).then(
        (row) => ({ ok: true as const, row }),
        (error: Error) => ({ ok: false as const, error: String(error.message ?? error) }),
      );
      const keyP = (async () => {
        const client = await poolB.connect();
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE "Exercise" SET key = NULL WHERE id = $1`, [pinnedExerciseId]);
          await client.query("COMMIT");
          return { ok: true as const };
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore
          }
          return { ok: false as const, error: String((error as Error).message ?? error) };
        } finally {
          client.release();
        }
      })();

      await new Promise((r) => setTimeout(r, 400));
      await hold.query("COMMIT");
      hold.release();

      const [pubResult, keyResult] = await Promise.all([publishP, keyP]);
      expect(keyResult.ok).toBe(false);
      expect(keyResult.error).toMatch(
        /EXERCISE_KEY_PUBLISHED_RELEASE_PINNED|EXERCISE_KEY_IMMUTABLE/,
      );

      const published = await pool.query<{ id: string }>(
        `SELECT id FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(published.rows).toHaveLength(1);
      if (pubResult.ok) {
        expect(published.rows[0]!.id).toBe(draftId);
      }
      const eligible = await pool.query<{ c: string }>(
        `SELECT workout_catalog_release_eligible_item_count($1::uuid)::text AS c`,
        [published.rows[0]!.id],
      );
      expect(Number(eligible.rows[0]?.c)).toBeGreaterThanOrEqual(1);

      const keyStill = await pool.query<{ key: string | null }>(
        `SELECT key FROM "Exercise" WHERE id = $1`,
        [pinnedExerciseId],
      );
      expect(keyStill.rows[0]?.key).toBeTruthy();

      await poolA.end();
      await poolB.end();
    });
  });

  it("historical plan without release id remains readable", async () => {
    const repo = new WorkoutEngineRepository(db);
    const version = await repo.nextVersion(userId);
    const saved = await repo.savePlan(
      userId,
      version,
      {
        days: [
          {
            dayIndex: 0,
            isRestDay: true,
            dayTitle: "Р”РµРЅСЊ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ",
            exercises: [
              {
                exerciseOrder: 0,
                exerciseName: "rest",
                exerciseKey: "rest",
                riskLevel: "low",
              },
            ],
          },
          ...Array.from({ length: 6 }, (_, i) => ({
            dayIndex: i + 1,
            isRestDay: true,
            dayTitle: "Р”РµРЅСЊ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ",
            exercises: [
              {
                exerciseOrder: 0,
                exerciseName: "rest",
                exerciseKey: "rest",
                riskLevel: "low" as const,
              },
            ],
          })),
        ],
      },
      {
        algorithmVersion: "workout-v2-01b.1",
        inputSnapshotJson: { legacy: true },
        workoutCatalogReleaseId: null,
        workoutCatalogReleaseCode: null,
      },
    );
    const loaded = await repo.findLatestByUserId(userId);
    expect(loaded?.id).toBe(saved.id);
    expect(loaded?.plan.days).toHaveLength(7);
  });
});
