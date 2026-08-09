/**
 * CATALOG-V3-01B-PUBLISH — disposable DB: classify → publish → immutability / idempotency.
 */
import { describe, expect, it } from 'vitest';
import {
  confirmSafeDisposableDatabase,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
} from '../../src/test-support/assert-disposable-database';
import { runCatalogV301bClassificationLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01b-classification-loader';
import { CATALOG_V3_01B_CREATED_BY } from '../../src/modules/workout-engine/catalog/catalog-v3-01b-classification';
import {
  CATALOG_V3_01B_PUBLISH_PIN_COUNT,
  CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
} from '../../src/modules/workout-engine/catalog/catalog-v3-01b-publish';
import { runCatalogV301bPublishLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01b-publish-loader';
import { CANONICAL_RELEASE_CODE } from '../../src/modules/workout-engine/catalog/catalog-enums';
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from './helpers/disposable-catalog-db';

describe('CATALOG-V3-01B-PUBLISH loader persistence', () => {
  it('publishes exactly 84 V3 pins without mutating historical release pins', async () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    confirmSafeDisposableDatabase(process.env.DATABASE_URL);

    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      await assertCanonicalPublished(pool);

      const classify = await runCatalogV301bClassificationLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(classify.ok).toBe(true);
      expect(classify.counts.appliedCreate).toBe(84);

      const canonicalBefore = await pool.query<{
        id: string;
        exerciseId: string;
        exerciseRevisionId: string;
        ordinal: number;
        enabledForGenerator: boolean;
      }>(
        `SELECT rel.id, i."exerciseId", i."exerciseRevisionId", i.ordinal, i."enabledForGenerator"
         FROM "WorkoutCatalogRelease" rel
         JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
         WHERE rel.code = $1
         ORDER BY i.ordinal`,
        [CANONICAL_RELEASE_CODE],
      );
      expect(canonicalBefore.rows).toHaveLength(84);
      const canonicalId = canonicalBefore.rows[0]!.id;
      const canonicalPinFingerprint = canonicalBefore.rows.map((r) => ({
        exerciseId: r.exerciseId,
        exerciseRevisionId: r.exerciseRevisionId,
        ordinal: r.ordinal,
        enabledForGenerator: r.enabledForGenerator,
      }));

      const dry = await runCatalogV301bPublishLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
      });
      expect(dry.ok).toBe(true);
      expect(dry.outcome).toBe('PUBLISH');
      expect(dry.pinCount).toBe(CATALOG_V3_01B_PUBLISH_PIN_COUNT);

      const published = await runCatalogV301bPublishLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
        ensureClassification: false,
      });
      expect(published.ok, JSON.stringify(published.issues)).toBe(true);
      expect(published.outcome).toBe('PUBLISH');
      expect(published.previousPublishedCode).toBe(CANONICAL_RELEASE_CODE);
      expect(published.newReleaseCode).toBe(CATALOG_V3_01B_PUBLISH_RELEASE_CODE);
      expect(published.pinCount).toBe(84);
      expect(published.generatorRuntimeUnchanged).toBe(true);

      // Exactly one PUBLISHED release — the bridge.
      const pub = await pool.query<{ id: string; code: string }>(
        `SELECT id, code FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(pub.rows).toHaveLength(1);
      expect(pub.rows[0]?.code).toBe(CATALOG_V3_01B_PUBLISH_RELEASE_CODE);

      // Historical canonical unchanged pin identities + RETIRED.
      const hist = await pool.query<{ status: string }>(
        `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
        [canonicalId],
      );
      expect(hist.rows[0]?.status).toBe('RETIRED');
      const histPins = await pool.query<{
        exerciseId: string;
        exerciseRevisionId: string;
        ordinal: number;
        enabledForGenerator: boolean;
      }>(
        `SELECT "exerciseId", "exerciseRevisionId", ordinal, "enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
         ORDER BY ordinal`,
        [canonicalId],
      );
      expect(histPins.rows).toEqual(canonicalPinFingerprint);

      // New pins: 84, unique exercises, all 01B classified + taxonomy.
      const pins = await pool.query<{
        exerciseId: string;
        exerciseRevisionId: string;
        createdBy: string;
        trainingRole: string | null;
      }>(
        `SELECT i."exerciseId", i."exerciseRevisionId", r."createdBy", t."trainingRole"
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         WHERE i."releaseId" = $1
         ORDER BY i.ordinal`,
        [pub.rows[0]!.id],
      );
      expect(pins.rows).toHaveLength(84);
      expect(new Set(pins.rows.map((p) => p.exerciseId)).size).toBe(84);
      expect(new Set(pins.rows.map((p) => p.exerciseRevisionId)).size).toBe(84);
      for (const p of pins.rows) {
        expect(p.createdBy).toBe(CATALOG_V3_01B_CREATED_BY);
        expect(p.trainingRole).toBeTruthy();
      }

      // New pins must not equal historical revision ids (successors).
      const newRevIds = new Set(pins.rows.map((p) => p.exerciseRevisionId));
      for (const old of canonicalPinFingerprint) {
        expect(newRevIds.has(old.exerciseRevisionId)).toBe(false);
      }

      // A. Deterministic release code — second apply does not create another release.
      const releases = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE code = $1`,
        [CATALOG_V3_01B_PUBLISH_RELEASE_CODE],
      );
      expect(Number(releases.rows[0]?.c ?? 0)).toBe(1);

      // F. No fabricated readiness TRUE.
      const readinessTrue = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseRevisionReadiness" rd
         JOIN "WorkoutCatalogReleaseItem" i ON i."exerciseRevisionId" = rd."exerciseRevisionId"
         WHERE i."releaseId" = $1
           AND (
             rd."generatorReady" OR rd."energyReady"
             OR rd."timingReady" OR rd."mediaReady"
           )`,
        [pub.rows[0]!.id],
      );
      expect(Number(readinessTrue.rows[0]?.c ?? -1)).toBe(0);

      // Energy / Timing not copied onto published successors.
      const energy = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseEnergyProfile" p
         JOIN "WorkoutCatalogReleaseItem" i ON i."exerciseRevisionId" = p."exerciseRevisionId"
         WHERE i."releaseId" = $1`,
        [pub.rows[0]!.id],
      );
      expect(Number(energy.rows[0]?.c ?? -1)).toBe(0);
      const timing = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseEnergyTimingProfile" p
         JOIN "WorkoutCatalogReleaseItem" i ON i."exerciseRevisionId" = p."exerciseRevisionId"
         WHERE i."releaseId" = $1`,
        [pub.rows[0]!.id],
      );
      expect(Number(timing.rows[0]?.c ?? -1)).toBe(0);

      // G. Unpublished path: RETIRED canonical pins still lack taxonomy (not authoritative).
      const retiredTax = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = i."exerciseRevisionId"
         WHERE i."releaseId" = $1`,
        [canonicalId],
      );
      expect(Number(retiredTax.rows[0]?.c ?? -1)).toBe(0);

      // Idempotent re-publish.
      const again = await runCatalogV301bPublishLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(again.ok).toBe(true);
      expect(again.outcome).toBe('UNCHANGED');
      expect(again.newReleaseId).toBe(pub.rows[0]!.id);

      const pubAfter = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      expect(Number(pubAfter.rows[0]?.c ?? 0)).toBe(1);
      const bridgeCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE code = $1`,
        [CATALOG_V3_01B_PUBLISH_RELEASE_CODE],
      );
      expect(Number(bridgeCount.rows[0]?.c ?? 0)).toBe(1);

      // E. Historical pin mutation still blocked at row level (same fingerprint).
      const histPins2 = await pool.query<{
        exerciseId: string;
        exerciseRevisionId: string;
        ordinal: number;
        enabledForGenerator: boolean;
      }>(
        `SELECT "exerciseId", "exerciseRevisionId", ordinal, "enabledForGenerator"
         FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
         ORDER BY ordinal`,
        [canonicalId],
      );
      expect(histPins2.rows).toEqual(canonicalPinFingerprint);
    });
  }, 600_000);

  it('apply can ensure classification then publish in one bridge call', async () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    confirmSafeDisposableDatabase(process.env.DATABASE_URL);

    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      await assertCanonicalPublished(pool);

      const published = await runCatalogV301bPublishLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
        ensureClassification: true,
      });
      expect(published.ok, JSON.stringify(published.issues)).toBe(true);
      expect(published.outcome).toBe('PUBLISH');
      expect(published.pinCount).toBe(84);
      expect(published.successorRevisionCount).toBe(84);

      const v3 = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
         JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         WHERE rel.status = 'PUBLISHED'
           AND r."createdBy" = $1`,
        [CATALOG_V3_01B_CREATED_BY],
      );
      expect(Number(v3.rows[0]?.c ?? 0)).toBe(84);
    });
  }, 600_000);
});
