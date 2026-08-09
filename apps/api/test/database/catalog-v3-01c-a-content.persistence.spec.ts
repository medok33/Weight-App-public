/**
 * CATALOG-V3-01C-A — disposable DB: ADD apply, no published-pin mutation, idempotency.
 */
import { describe, expect, it } from 'vitest';
import {
  confirmSafeDisposableDatabase,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
} from '../../src/test-support/assert-disposable-database';
import {
  CATALOG_V3_01C_A_CONTENT,
  CATALOG_V3_01C_A_CREATED_BY,
  CATALOG_V3_01C_A_EXPECTED_COUNT,
} from '../../src/modules/workout-engine/catalog/catalog-v3-01c-a-content';
import { runCatalogV301cAContentLoad } from '../../src/modules/workout-engine/catalog/catalog-v3-01c-a-content-loader';
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from './helpers/disposable-catalog-db';

describe('CATALOG-V3-01C-A content loader persistence', () => {
  it('creates 40 NEW exercises with V3 taxonomy without mutating published pins', async () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    confirmSafeDisposableDatabase(process.env.DATABASE_URL);

    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      // After 01B-PUBLISH merge, seed still publishes canonical-01b via migrations.
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

      const dry = await runCatalogV301cAContentLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
      });
      expect(dry.ok, JSON.stringify(dry.issues.slice(0, 8))).toBe(true);
      expect(dry.counts.plannedCreate).toBe(CATALOG_V3_01C_A_EXPECTED_COUNT);

      const applied = await runCatalogV301cAContentLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(applied.ok, JSON.stringify(applied.issues.slice(0, 8))).toBe(true);
      expect(applied.counts.appliedCreate).toBe(40);
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

      const created = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "Exercise" e
         JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         WHERE r."createdBy" = $1 AND r.status = 'APPROVED'`,
        [CATALOG_V3_01C_A_CREATED_BY],
      );
      expect(Number(created.rows[0]?.c ?? 0)).toBe(40);

      const totalKeys = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM "Exercise" WHERE key IS NOT NULL`,
      );
      expect(Number(totalKeys.rows[0]?.c ?? 0)).toBeGreaterThanOrEqual(124);

      // No readiness / energy / timing fabrication.
      const readiness = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseRevisionReadiness" rd
         JOIN "ExerciseRevision" r ON r.id = rd."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01C_A_CREATED_BY],
      );
      expect(Number(readiness.rows[0]?.c ?? -1)).toBe(0);
      const energy = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "ExerciseEnergyProfile" p
         JOIN "ExerciseRevision" r ON r.id = p."exerciseRevisionId"
         WHERE r."createdBy" = $1`,
        [CATALOG_V3_01C_A_CREATED_BY],
      );
      expect(Number(energy.rows[0]?.c ?? -1)).toBe(0);

      // Conflict: same identity with mutated technique.
      const conflict = await runCatalogV301cAContentLoad({
        mode: 'dry-run',
        pool,
        databaseUrl: connectionString,
        entries: [
          {
            ...CATALOG_V3_01C_A_CONTENT[0]!,
            techniqueRu: 'Completely different technique text that should conflict on re-plan.',
          },
          ...CATALOG_V3_01C_A_CONTENT.slice(1),
        ],
      });
      expect(conflict.ok).toBe(false);
      expect(conflict.counts.plannedConflict).toBe(1);

      // Idempotent re-apply.
      const again = await runCatalogV301cAContentLoad({
        mode: 'apply',
        pool,
        databaseUrl: connectionString,
      });
      expect(again.ok).toBe(true);
      expect(again.counts.appliedCreate).toBe(0);
      expect(again.counts.appliedUnchanged).toBe(40);
    });
  }, 600_000);
});
