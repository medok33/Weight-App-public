import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { WorkoutCatalogReleaseService } from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { loadCanonicalContent01b } from "../../src/modules/workout-engine/catalog/canonical-content-01b.validation";
import { PrismaService, type SqlQuery } from "../../src/infrastructure/database/prisma.service";
import { assertCanonicalPublished } from "./helpers/disposable-catalog-db";

const HISTORICAL_PREFERRED = [
  { from: "barbell_romanian_deadlift", to: "glute_bridge" },
  { from: "dumbbell_row", to: "band_row" },
  { from: "goblet_squat", to: "bodyweight_squats" },
  { from: "light_jog", to: "morning_walk" },
] as const;

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://weight_app:weight_app_local@localhost:5432/weight_app";
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return {
    query,
    async withSessionAdvisoryLock() {
      throw new Error("unused");
    },
    async withTransaction<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txQuery: SqlQuery = (text, values = []) => client.query(text, values);
      try {
        await client.query("BEGIN");
        const result = await fn(txQuery);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

describe("WORKOUT-CATALOG-01B persisted relation graph parity", () => {
  const sot = loadCanonicalContent01b();

  beforeAll(async () => {
    await assertCanonicalPublished(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("matches SoT edges in PostgreSQL after migration 211", async () => {
    const expected = new Map<
      string,
      { relationType: string; priority: number; levelDelta: number }
    >();
    for (const ex of sot.exercises) {
      for (const alt of ex.candidates.alternatives) {
        expected.set(`${ex.key}|${alt.key}|${alt.relationType}`, {
          relationType: alt.relationType,
          priority: alt.priority,
          levelDelta: alt.levelDelta,
        });
      }
    }

    const dbRows = await pool.query<{
      fromKey: string;
      toKey: string;
      relationType: string;
      priority: number;
      levelDelta: number;
      equipmentContext: string;
      placeContext: string;
      active: boolean;
      targetActive: boolean;
      targetKey: string | null;
      eligible: boolean;
    }>(
      `SELECT f.key AS "fromKey",
              t.key AS "toKey",
              vr."relationType",
              vr.priority,
              vr."levelDelta",
              vr."equipmentContext",
              vr."placeContext",
              vr.active,
              t."isActive" AS "targetActive",
              t.key AS "targetKey",
              EXISTS (
                SELECT 1
                FROM "WorkoutCatalogRelease" rel
                JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
                JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
                WHERE rel.status = 'PUBLISHED'
                  AND i."exerciseId" = t.id
                  AND i."enabledForGenerator" = true
                  AND r.status = 'APPROVED'
                  AND t."isActive" = true
                  AND t.key IS NOT NULL
              ) AS eligible
       FROM "ExerciseVariantRelation" vr
       JOIN "Exercise" f ON f.id = vr."fromExerciseId"
       JOIN "Exercise" t ON t.id = vr."toExerciseId"
       WHERE f.key = ANY($1::text[])`,
      [sot.exercises.map((e) => e.key)],
    );

    const seen = new Set<string>();
    let missing = 0;
    let extra = 0;
    let priorityMismatch = 0;
    let typeMismatch = 0;

    for (const row of dbRows.rows) {
      const key = `${row.fromKey}|${row.toKey}|${row.relationType}`;
      const exp = expected.get(key);
      if (!exp) {
        const fromIsCanonical = sot.exercises.some((e) => e.key === row.fromKey);
        const toIsCanonical = sot.exercises.some((e) => e.key === row.toKey);
        if (fromIsCanonical && toIsCanonical) {
          extra += 1;
        }
        continue;
      }
      seen.add(key);
      expect(row.equipmentContext).toBe("");
      expect(row.placeContext).toBe("");
      expect(row.active).toBe(true);
      expect(row.targetActive).toBe(true);
      expect(row.targetKey).toBeTruthy();
      expect(row.eligible).toBe(true);
      if (row.priority !== exp.priority) priorityMismatch += 1;
      if (row.relationType !== exp.relationType) typeMismatch += 1;
      expect(row.levelDelta).toBe(exp.levelDelta);
    }

    for (const key of expected.keys()) {
      if (!seen.has(key)) missing += 1;
    }

    expect(missing).toBe(0);
    expect(extra).toBe(0);
    expect(priorityMismatch).toBe(0);
    expect(typeMismatch).toBe(0);

    const dupPriority = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM (
         SELECT vr."fromExerciseId", vr.priority
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" f ON f.id = vr."fromExerciseId"
         WHERE vr.active = true
           AND f.key = ANY($1::text[])
         GROUP BY vr."fromExerciseId", vr.priority
         HAVING COUNT(*) > 1
       ) d`,
      [sot.exercises.map((e) => e.key)],
    );
    expect(Number(dupPriority.rows[0]?.c)).toBe(0);

    for (const ex of sot.exercises) {
      if (ex.candidates.alternatives.length === 0) continue;
      const zero = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" f ON f.id = vr."fromExerciseId"
         WHERE f.key = $1 AND vr.active = true AND vr.priority = 0`,
        [ex.key],
      );
      expect(Number(zero.rows[0]?.c)).toBe(1);
    }

    for (const edge of HISTORICAL_PREFERRED) {
      const row = await pool.query<{
        toKey: string;
        priority: number;
        relationType: string;
      }>(
        `SELECT t.key AS "toKey", vr.priority, vr."relationType"
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" f ON f.id = vr."fromExerciseId"
         JOIN "Exercise" t ON t.id = vr."toExerciseId"
         WHERE f.key = $1 AND t.key = $2 AND vr.active = true`,
        [edge.from, edge.to],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]?.priority).toBe(0);
      expect(["EASIER", "SAME_LEVEL"]).toContain(row.rows[0]?.relationType);
      expect(row.rows[0]?.relationType).not.toBe("HARDER");
    }

    const preferredHarder = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "ExerciseVariantRelation" vr
       WHERE vr.active = true
         AND vr.priority = 0
         AND vr."relationType" IN ('HARDER', 'ADVANCED')`,
    );
    expect(Number(preferredHarder.rows[0]?.c)).toBe(0);

    const catalog = new WorkoutCatalogReleaseService(createDb());
    const { exercises } = await catalog.listGeneratorEligibleExercises();
    for (const edge of HISTORICAL_PREFERRED) {
      const row = exercises.find((e) => e.key === edge.from);
      expect(row?.easierVariantKey).toBe(edge.to);
    }

    const familiesWithPreferred = new Set(
      exercises.filter((e) => e.easierVariantKey).map((e) => e.key),
    );
    expect(familiesWithPreferred.size).toBeGreaterThanOrEqual(12);
  });
});
