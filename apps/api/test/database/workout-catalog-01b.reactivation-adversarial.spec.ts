import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkoutCatalogReleaseService } from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { runSqlMigrations } from "../../scripts/lib/sql-migration-runner.mjs";
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from "./helpers/disposable-catalog-db";

async function insertThinDraft(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  code: string,
  keys: string[],
): Promise<string> {
  const draft = await pool.query(
    `INSERT INTO "WorkoutCatalogRelease" (code, status, "manifestVersion")
     VALUES ($1, 'DRAFT', 'workout-catalog-manifest-01b.1')
     RETURNING id`,
    [code],
  );
  const releaseId = draft.rows[0]!.id;
  let ordinal = 1;
  for (const key of keys) {
    const row = await pool.query(
      `SELECT e.id AS "exerciseId", e."familyId", i."exerciseRevisionId" AS "revisionId"
       FROM "Exercise" e
       JOIN "WorkoutCatalogReleaseItem" i ON i."exerciseId" = e.id
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       WHERE e.key = $1 AND rel.status = 'PUBLISHED'
       LIMIT 1`,
      [key],
    );
    await pool.query(
      `INSERT INTO "WorkoutCatalogReleaseItem" (
         "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
       ) VALUES ($1, $2, $3, $4, $5, true)`,
      [
        releaseId,
        (row.rows[0] as { exerciseId: string }).exerciseId,
        (row.rows[0] as { revisionId: string }).revisionId,
        (row.rows[0] as { familyId: string }).familyId,
        ordinal,
      ],
    );
    ordinal += 1;
  }
  return releaseId;
}

describe("WORKOUT-CATALOG-01B reactivation adversarial", () => {
  it("does not expose production RETIRED→PUBLISHED recovery and migrate stays no-op", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const catalog = new WorkoutCatalogReleaseService(createDb());

      expect(
        Object.prototype.hasOwnProperty.call(catalog, "reactivateRetiredRelease") ||
          typeof (catalog as { reactivateRetiredRelease?: unknown }).reactivateRetiredRelease ===
            "function",
      ).toBe(false);
      expect(
        typeof (WorkoutCatalogReleaseService.prototype as { reactivateRetiredRelease?: unknown })
          .reactivateRetiredRelease,
      ).toBe("undefined");

      const thinId = await insertThinDraft(pool, `thin-${randomUUID()}`, [
        "push_ups",
        "dead_bug",
        "glute_bridge",
      ]);
      expect((await catalog.publishRelease(thinId)).status).toBe("PUBLISHED");

      await pool.query(
        `UPDATE "WorkoutCatalogRelease"
         SET status = 'RETIRED', "retiredAt" = now()
         WHERE id = $1`,
        [thinId],
      );
      const publishedCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(Number(publishedCount.rows[0]?.c)).toBe(0);

      await expect(
        pool.query(
          `UPDATE "WorkoutCatalogRelease"
           SET status = 'PUBLISHED', "publishedAt" = now(), "retiredAt" = NULL
           WHERE id = $1`,
          [thinId],
        ),
      ).rejects.toThrow(/WORKOUT_CATALOG_RELEASE_IMMUTABLE/);

      const client = await pool.connect();
      try {
        const second = await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
        expect(second.applied).toHaveLength(0);
      } finally {
        client.release();
      }

      const thinStatus = await pool.query<{ status: string; code: string }>(
        `SELECT status, code FROM "WorkoutCatalogRelease" WHERE id = $1`,
        [thinId],
      );
      expect(thinStatus.rows[0]?.status).toBe("RETIRED");
      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
            )
          ).rows[0]?.c,
        ),
      ).toBe(0);
    });
  }, 300_000);

  it("atomic publish retires prior PUBLISHED under unique invariant", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const catalog = new WorkoutCatalogReleaseService(createDb());
      const prior = await catalog.resolveCurrentPublishedRelease();
      expect(prior?.code).toBe("workout-catalog-canonical-01b");
      const draftId = await insertThinDraft(pool, `atomic-${randomUUID()}`, [
        "band_row",
        "goblet_squat",
        "morning_walk",
      ]);
      expect((await catalog.publishRelease(draftId)).status).toBe("PUBLISHED");
      expect(
        (
          await pool.query<{ status: string }>(
            `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
            [prior!.id],
          )
        ).rows[0]?.status,
      ).toBe("RETIRED");
      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
            )
          ).rows[0]?.c,
        ),
      ).toBe(1);
    });
  }, 300_000);

  it("fresh 1–211 publishes only workout-catalog-canonical-01b", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      await assertCanonicalPublished(pool);
      const published = await pool.query<{ code: string }>(
        `SELECT code FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(published.rows.map((r) => r.code)).toEqual(["workout-catalog-canonical-01b"]);
      const bootstrap = await pool.query<{ status: string }>(
        `SELECT status FROM "WorkoutCatalogRelease" WHERE code = 'workout-catalog-bootstrap-01a'`,
      );
      expect(bootstrap.rows[0]?.status).toBe("RETIRED");
    });
  }, 300_000);
});
