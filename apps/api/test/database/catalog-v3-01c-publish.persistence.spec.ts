/**
 * CATALOG-V3-01C-PUBLISH-BRIDGE — disposable DB:
 * classify → Batch A → Batch B → DRAFT 156 candidate (no activation).
 */
import { describe, expect, it } from 'vitest';
import {
  confirmSafeDisposableDatabase,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
} from '../../src/test-support/assert-disposable-database';
import { CANONICAL_RELEASE_CODE } from '../../src/modules/workout-engine/catalog/catalog-enums';
import {
  CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS,
  CATALOG_V3_01C_PUBLISH_PIN_COUNT,
  CATALOG_V3_01C_PUBLISH_RELEASE_CODE,
  CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT,
} from '../../src/modules/workout-engine/catalog/catalog-v3-01c-publish';
import { runCatalogV301cPublishLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01c-publish-loader';
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from './helpers/disposable-catalog-db';

describe('CATALOG-V3-01C-PUBLISH-BRIDGE loader persistence', () => {
  it('creates DRAFT 156-pin candidate without activating or mutating published 84', async () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    confirmSafeDisposableDatabase(process.env.DATABASE_URL);

    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      await assertCanonicalPublished(pool);

      const publishedBefore = await pool.query<{
        id: string;
        code: string;
        exerciseId: string;
        exerciseRevisionId: string;
        ordinal: number;
        enabledForGenerator: boolean;
      }>(
        `SELECT rel.id, rel.code, i."exerciseId", i."exerciseRevisionId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogRelease" rel
         JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
         WHERE rel.status = 'PUBLISHED'
         ORDER BY i.ordinal`,
      );
      expect(publishedBefore.rows).toHaveLength(CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT);
      expect(publishedBefore.rows[0]?.code).toBe(CANONICAL_RELEASE_CODE);
      const publishedId = publishedBefore.rows[0]!.id;
      const publishedFingerprint = publishedBefore.rows.map((r) => ({
        exerciseId: r.exerciseId,
        exerciseRevisionId: r.exerciseRevisionId,
        ordinal: r.ordinal,
        enabledForGenerator: r.enabledForGenerator,
      }));

      const eligibleBefore = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE i."releaseId" = $1
           AND i."enabledForGenerator" = true
           AND r.status = 'APPROVED'
           AND e."isActive" IS TRUE
           AND e.key IS NOT NULL`,
        [publishedId],
      );
      const eligibleBeforeCount = Number(eligibleBefore.rows[0]?.c ?? 0);
      expect(eligibleBeforeCount).toBe(CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT);

      const dryMissing = await runCatalogV301cPublishLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
      });
      expect(dryMissing.ok).toBe(false);
      expect(dryMissing.outcome).toBe('CONTENT_REQUIRED');

      const created = await runCatalogV301cPublishLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
        ensureContent: true,
      });
      expect(created.ok, JSON.stringify(created.issues.slice(0, 12))).toBe(true);
      expect(created.outcome).toBe('CANDIDATE');
      expect(created.candidateStatus).toBe('DRAFT');
      expect(created.pinCount).toBe(CATALOG_V3_01C_PUBLISH_PIN_COUNT);
      expect(created.activeCatalogCount).toBe(CATALOG_V3_01C_PUBLISH_PIN_COUNT);
      expect(created.publishedReleaseUnchanged).toBe(true);
      expect(created.generatorRuntimeUnchanged).toBe(true);
      expect(created.candidateReleaseCode).toBe(CATALOG_V3_01C_PUBLISH_RELEASE_CODE);

      // Current PUBLISHED unchanged (still canonical 84).
      const pub = await pool.query<{ id: string; code: string; status: string }>(
        `SELECT id, code, status FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(pub.rows).toHaveLength(1);
      expect(pub.rows[0]?.code).toBe(CANONICAL_RELEASE_CODE);
      expect(pub.rows[0]?.id).toBe(publishedId);

      const publishedAfter = await pool.query<{
        exerciseId: string;
        exerciseRevisionId: string;
        ordinal: number;
        enabledForGenerator: boolean;
      }>(
        `SELECT "exerciseId", "exerciseRevisionId", ordinal, "enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
         ORDER BY ordinal`,
        [publishedId],
      );
      expect(publishedAfter.rows).toEqual(publishedFingerprint);

      const candidate = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM "WorkoutCatalogRelease" WHERE code = $1`,
        [CATALOG_V3_01C_PUBLISH_RELEASE_CODE],
      );
      expect(candidate.rows).toHaveLength(1);
      expect(candidate.rows[0]?.status).toBe('DRAFT');
      expect(candidate.rows[0]?.id).toBe(created.candidateReleaseId);

      const pins = await pool.query<{
        exerciseId: string;
        exerciseRevisionId: string;
        exerciseKey: string;
        ordinal: number;
        trainingRole: string | null;
        primaryMovementPattern: string | null;
        difficulty: string | null;
        muscleCount: string;
        equipmentGroupCount: string;
        generatorReady: boolean | null;
        energyReady: boolean | null;
        timingReady: boolean | null;
        mediaReady: boolean | null;
      }>(
        `SELECT
           i."exerciseId",
           i."exerciseRevisionId",
           e.key AS "exerciseKey",
           i.ordinal,
           t."trainingRole",
           t."primaryMovementPattern",
           e.difficulty,
           (SELECT COUNT(*)::text FROM "ExerciseRevisionMuscleInvolvement" m
             WHERE m."exerciseRevisionId" = r.id) AS "muscleCount",
           (SELECT COUNT(*)::text FROM "ExerciseRevisionEquipmentGroup" g
             WHERE g."exerciseRevisionId" = r.id) AS "equipmentGroupCount",
           rd."generatorReady",
           rd."energyReady",
           rd."timingReady",
           rd."mediaReady"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "Exercise" e ON e.id = i."exerciseId"
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         LEFT JOIN "ExerciseRevisionReadiness" rd ON rd."exerciseRevisionId" = r.id
         WHERE i."releaseId" = $1
         ORDER BY i.ordinal`,
        [candidate.rows[0]!.id],
      );
      expect(pins.rows).toHaveLength(CATALOG_V3_01C_PUBLISH_PIN_COUNT);
      expect(new Set(pins.rows.map((p) => p.exerciseId)).size).toBe(156);
      expect(new Set(pins.rows.map((p) => p.exerciseRevisionId)).size).toBe(156);
      expect(new Set(pins.rows.map((p) => p.exerciseKey)).size).toBe(156);
      for (const p of pins.rows) {
        expect(p.trainingRole).toBeTruthy();
        expect(p.primaryMovementPattern).toBeTruthy();
        expect(Number(p.muscleCount)).toBeGreaterThan(0);
        expect(Number(p.equipmentGroupCount)).toBeGreaterThan(0);
        expect(p.generatorReady).not.toBe(true);
        expect(p.energyReady).not.toBe(true);
        expect(p.timingReady).not.toBe(true);
        expect(p.mediaReady).not.toBe(true);
      }

      const forbidden = pins.rows.filter((p) =>
        (CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS as readonly string[]).includes(p.exerciseKey),
      );
      expect(forbidden).toEqual([]);

      const eligibleAfter = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "Exercise" e ON e.id = i."exerciseId"
         WHERE i."releaseId" = $1
           AND i."enabledForGenerator" = true
           AND r.status = 'APPROVED'
           AND e."isActive" IS TRUE
           AND e.key IS NOT NULL`,
        [publishedId],
      );
      expect(Number(eligibleAfter.rows[0]?.c ?? 0)).toBe(eligibleBeforeCount);

      // Idempotent re-apply does not duplicate the candidate release.
      const again = await runCatalogV301cPublishLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
        ensureContent: true,
      });
      expect(again.ok, JSON.stringify(again.issues.slice(0, 8))).toBe(true);
      expect(again.outcome).toBe('UNCHANGED');
      expect(again.candidateReleaseId).toBe(candidate.rows[0]!.id);

      const candidateCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE code = $1`,
        [CATALOG_V3_01C_PUBLISH_RELEASE_CODE],
      );
      expect(Number(candidateCount.rows[0]?.c ?? 0)).toBe(1);

      const publishedCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(Number(publishedCount.rows[0]?.c ?? 0)).toBe(1);

      const migration220 = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM pg_catalog.pg_tables
         WHERE schemaname = 'public' AND tablename = 'migration_220_marker_absent'`,
      );
      expect(Number(migration220.rows[0]?.c ?? 0)).toBe(0);
    });
  }, 300_000);
});
