/**
 * CATALOG-V3-01C-B — disposable DB: Batch A → Batch B apply, polish, deprecate, idempotency.
 */
import { describe, expect, it } from 'vitest';
import {
  confirmSafeDisposableDatabase,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
} from '../../src/test-support/assert-disposable-database';
import { CATALOG_V3_01C_A_CREATED_BY } from '../../src/modules/workout-engine/catalog/catalog-v3-01c-a-content';
import { runCatalogV301cAContentLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01c-a-content-loader';
import {
  CATALOG_V3_01C_B_CONTENT,
  CATALOG_V3_01C_B_CREATED_BY,
  CATALOG_V3_01C_B_EXPECTED_COUNT,
} from '../../src/modules/workout-engine/catalog/catalog-v3-01c-b-content';
import { runCatalogV301cBContentLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01c-b-content-loader';
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from './helpers/disposable-catalog-db';

describe('CATALOG-V3-01C-B content loader persistence', () => {
  it('applies Batch B + polish/deprecation without mutating published pins', async () => {
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

      const batchA = await runCatalogV301cAContentLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(batchA.ok, JSON.stringify(batchA.issues.slice(0, 8))).toBe(true);
      expect(batchA.counts.appliedCreate).toBe(40);

      const dry = await runCatalogV301cBContentLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
      });
      expect(dry.ok, JSON.stringify(dry.issues.slice(0, 8))).toBe(true);
      expect(dry.counts.plannedCreate).toBe(CATALOG_V3_01C_B_EXPECTED_COUNT);
      expect(dry.counts.plannedPolish).toBe(3);
      expect(dry.counts.plannedDeprecate).toBe(1);

      const applied = await runCatalogV301cBContentLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(applied.ok, JSON.stringify(applied.issues.slice(0, 8))).toBe(true);
      expect(applied.counts.appliedCreate).toBe(CATALOG_V3_01C_B_EXPECTED_COUNT);
      expect(applied.counts.appliedCreate).toBe(33);
      expect(applied.counts.appliedPolish).toBe(3);
      expect(applied.counts.appliedDeprecate).toBe(1);
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

      const activeKeys = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "Exercise" e
         WHERE e."isActive" = true AND e.key IS NOT NULL`,
      );
      // 84 published + 39 remaining Batch A + 33 Batch B = 156
      expect(Number(activeKeys.rows[0]?.c ?? 0)).toBe(156);

      const batchBTaxonomy = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         WHERE r."createdBy" = $1
           AND r.status = 'APPROVED'
           AND r."revisionNumber" = 1
           AND e."isActive" = true`,
        [CATALOG_V3_01C_B_CREATED_BY],
      );
      expect(Number(batchBTaxonomy.rows[0]?.c ?? 0)).toBe(33);

      const forbidden = await pool.query<{ key: string }>(
        `SELECT e.key
         FROM "Exercise" e
         WHERE e.key = ANY($1::text[])`,
        [
          [
            'machine_chest_fly',
            'glute_bridge_march_hold',
            'ankle_mobility_knee_over_toe',
            'tibialis_raise',
          ],
        ],
      );
      expect(forbidden.rows).toEqual([]);

      const deprecated = await pool.query<{ isActive: boolean; status: string }>(
        `SELECT e."isActive", r.status
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
         WHERE e.key = 'lat_pulldown_wide'
         ORDER BY r."revisionNumber" DESC
         LIMIT 1`,
      );
      expect(deprecated.rows[0]?.isActive).toBe(false);
      expect(deprecated.rows[0]?.status).toBe('RETIRED');

      const chin = await pool.query<{ muscleCode: string }>(
        `SELECT m."muscleCode"
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
         JOIN "ExerciseRevisionMuscleInvolvement" m ON m."exerciseRevisionId" = r.id
         WHERE e.key = 'chin_up'
           AND r."createdBy" = $1
           AND r.status = 'APPROVED'
           AND m."muscleCode" = 'UPPER_BACK'`,
        [CATALOG_V3_01C_B_CREATED_BY],
      );
      expect(chin.rows.length).toBe(1);

      const bulgarian = await pool.query<{ equipmentCode: string }>(
        `SELECT i."equipmentCode"
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
         JOIN "ExerciseRevisionEquipmentGroup" g ON g."exerciseRevisionId" = r.id
         JOIN "ExerciseRevisionEquipmentItem" i ON i."groupId" = g.id
         WHERE e.key = 'bulgarian_split_squat'
           AND r."createdBy" = $1
           AND r.status = 'APPROVED'
           AND g."groupKind" = 'ALL_OF'`,
        [CATALOG_V3_01C_B_CREATED_BY],
      );
      expect(bulgarian.rows.map((r) => r.equipmentCode).sort()).toEqual([
        'BENCH',
        'BODYWEIGHT',
      ]);

      // Batch A APPROVED rows for polished keys remain (immutability); successors are additive.
      const aChin = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
         WHERE e.key = 'chin_up'
           AND r."createdBy" = $1
           AND r.status = 'APPROVED'`,
        [CATALOG_V3_01C_A_CREATED_BY],
      );
      expect(Number(aChin.rows[0]?.c ?? 0)).toBe(1);

      const readiness = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseRevisionReadiness" rd
         JOIN "ExerciseRevision" r ON r.id = rd."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01C_B_CREATED_BY],
      );
      expect(Number(readiness.rows[0]?.c ?? -1)).toBe(0);

      const energy = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseEnergyProfile" p
         JOIN "ExerciseRevision" r ON r.id = p."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01C_B_CREATED_BY],
      );
      expect(Number(energy.rows[0]?.c ?? -1)).toBe(0);

      const conflict = await runCatalogV301cBContentLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
        entries: [
          {
            ...CATALOG_V3_01C_B_CONTENT[0]!,
            techniqueRu:
              'Completely different technique text that should conflict on re-plan for Batch B.',
          },
          ...CATALOG_V3_01C_B_CONTENT.slice(1),
        ],
      });
      expect(conflict.ok).toBe(false);
      expect(conflict.counts.plannedConflict).toBe(1);

      const again = await runCatalogV301cBContentLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(again.ok, JSON.stringify(again.issues.slice(0, 8))).toBe(true);
      expect(again.counts.appliedCreate).toBe(0);
      expect(again.counts.appliedPolish).toBe(0);
      expect(again.counts.appliedDeprecate).toBe(0);
      expect(again.counts.appliedUnchanged).toBe(33 + 3 + 1);
    });
  }, 600_000);
});
