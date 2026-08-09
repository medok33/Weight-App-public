/**
 * CATALOG-V3-01B — disposable DB: history-safe classify apply + adversarial checks.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmSafeDisposableDatabase,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
} from '../../src/test-support/assert-disposable-database';
import { runCatalogV301bClassificationLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01b-classification-loader';
import { CATALOG_V3_01B_CREATED_BY } from '../../src/modules/workout-engine/catalog/catalog-v3-01b-classification';
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from './helpers/disposable-catalog-db';

describe('CATALOG-V3-01B classification loader persistence', () => {
  it('applies 84 classified revisions without mutating published pins or generator set', async () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    confirmSafeDisposableDatabase(process.env.DATABASE_URL);

    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      await assertCanonicalPublished(pool);

      const beforePins = await pool.query<{ key: string; revisionId: string }>(
        `SELECT e.key, i."exerciseRevisionId" AS "revisionId"
         FROM "WorkoutCatalogRelease" rel
         JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE rel.status = 'PUBLISHED'
         ORDER BY e.key`,
      );
      expect(beforePins.rows.length).toBe(84);

      const eligibleBefore = await pool.query<{ c: string }>(
        `SELECT workout_catalog_release_eligible_item_count(rel.id)::text AS c
         FROM "WorkoutCatalogRelease" rel
         WHERE rel.status = 'PUBLISHED'`,
      );
      expect(Number(eligibleBefore.rows[0]?.c ?? 0)).toBe(84);

      const dry = await runCatalogV301bClassificationLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
      });
      expect(dry.ok).toBe(true);
      expect(dry.counts.plannedCreate).toBe(84);

      const applied = await runCatalogV301bClassificationLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(applied.ok).toBe(true);
      expect(applied.counts.appliedCreate).toBe(84);
      expect(applied.publishedReleaseUnchanged).toBe(true);

      const afterPins = await pool.query<{ key: string; revisionId: string }>(
        `SELECT e.key, i."exerciseRevisionId" AS "revisionId"
         FROM "WorkoutCatalogRelease" rel
         JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE rel.status = 'PUBLISHED'
         ORDER BY e.key`,
      );
      expect(afterPins.rows).toEqual(beforePins.rows);

      const classified = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseRevision" r
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         WHERE r."createdBy" = $1 AND r.status = 'APPROVED'`,
        [CATALOG_V3_01B_CREATED_BY],
      );
      expect(Number(classified.rows[0]?.c ?? 0)).toBe(84);

      // Published pin revisions must remain without taxonomy (history-safe).
      const publishedTax = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = i."exerciseRevisionId"
         WHERE rel.status = 'PUBLISHED'`,
      );
      expect(Number(publishedTax.rows[0]?.c ?? -1)).toBe(0);

      // A. Cannot mutate old approved (published) semantics.
      const pinRev = beforePins.rows[0]!.revisionId;
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionTaxonomy"
            ("exerciseRevisionId", "trainingRole")
           VALUES ($1, 'MAIN')`,
          [pinRev],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);

      // B. No exercise disappears.
      const keys = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "Exercise" WHERE key IS NOT NULL`,
      );
      expect(Number(keys.rows[0]?.c ?? 0)).toBeGreaterThanOrEqual(84);

      // D. Empty equipment group rejected on a mutable draft.
      const draft = await pool.query<{ id: string }>(
        `INSERT INTO "ExerciseRevision" (
           "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy"
         )
         SELECT e.id,
                COALESCE((SELECT MAX(r."revisionNumber") FROM "ExerciseRevision" r WHERE r."exerciseId" = e.id), 0) + 1,
                'DRAFT', 'tmp', 'tmp', 'test:v3-01b-empty'
         FROM "Exercise" e WHERE e.key IS NOT NULL ORDER BY e.key LIMIT 1
         RETURNING id`,
      );
      await expect(
        (async () => {
          const c = await pool.connect();
          try {
            await c.query('BEGIN');
            await c.query(
              `INSERT INTO "ExerciseRevisionEquipmentGroup"
                (id, "exerciseRevisionId", "groupKind", "sortOrder")
               VALUES ($1, $2, 'ALL_OF', 0)`,
              [randomUUID(), draft.rows[0]!.id],
            );
            await c.query('COMMIT');
          } catch (e) {
            await c.query('ROLLBACK').catch(() => undefined);
            throw e;
          } finally {
            c.release();
          }
        })(),
      ).rejects.toThrow(/V3_EQUIPMENT_GROUP_EMPTY/);

      // E. MERGE_VARIANT keys still distinct.
      const walks = await pool.query<{ key: string }>(
        `SELECT key FROM "Exercise"
         WHERE key IN ('morning_walk','recovery_walk','brisk_outdoor_walk')
         ORDER BY key`,
      );
      expect(walks.rows.map((r) => r.key)).toEqual([
        'brisk_outdoor_walk',
        'morning_walk',
        'recovery_walk',
      ]);

      // F. No readiness / generatorReady invented.
      const readiness = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseRevisionReadiness" rd
         JOIN "ExerciseRevision" r ON r.id = rd."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01B_CREATED_BY],
      );
      expect(Number(readiness.rows[0]?.c ?? -1)).toBe(0);

      // G. New revisions do not silently gain energy/timing profiles.
      const energyOnNew = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseEnergyProfile" p
         JOIN "ExerciseRevision" r ON r.id = p."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01B_CREATED_BY],
      );
      expect(Number(energyOnNew.rows[0]?.c ?? -1)).toBe(0);
      const timingOnNew = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseEnergyTimingProfile" p
         JOIN "ExerciseRevision" r ON r.id = p."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01B_CREATED_BY],
      );
      expect(Number(timingOnNew.rows[0]?.c ?? -1)).toBe(0);

      // H. Generator eligibility count unchanged (same published pins).
      const eligibleAfter = await pool.query<{ c: string }>(
        `SELECT workout_catalog_release_eligible_item_count(rel.id)::text AS c
         FROM "WorkoutCatalogRelease" rel
         WHERE rel.status = 'PUBLISHED'`,
      );
      expect(Number(eligibleAfter.rows[0]?.c ?? 0)).toBe(84);

      // Idempotent re-apply.
      const again = await runCatalogV301bClassificationLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(again.ok).toBe(true);
      expect(again.counts.appliedCreate).toBe(0);
      expect(again.counts.appliedUnchanged).toBe(84);
    });
  }, 600_000);
});
