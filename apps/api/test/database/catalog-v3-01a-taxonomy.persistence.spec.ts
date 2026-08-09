/**
 * WORKOUT-CATALOG-V3-01A (+ FIX-01) — disposable DB migration + invariants.
 * Does not touch shared/staging/production.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CANONICAL_RELEASE_CODE } from '../../src/modules/workout-engine/catalog/catalog-enums';
import {
  confirmSafeDisposableDatabase,
  WEIGHT_APP_DISPOSABLE_TEST_DB,
} from '../../src/test-support/assert-disposable-database';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';
import type { Pool } from 'pg';

async function createDraftRevision(pool: Pool): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO "ExerciseRevision" (
       "exerciseId", "revisionNumber", status, "nameRu", "nameEn", "createdBy"
     )
     SELECT e.id,
            COALESCE((SELECT MAX(r."revisionNumber") FROM "ExerciseRevision" r WHERE r."exerciseId" = e.id), 0) + 1,
            'DRAFT',
            'V3 FIX draft RU',
            'V3 FIX draft EN',
            'test:v3-01a-fix-01'
     FROM "Exercise" e
     WHERE e.key IS NOT NULL
     ORDER BY e.key ASC
     LIMIT 1
     RETURNING id`,
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('DRAFT_REVISION_CREATE_FAILED');
  return id;
}

async function approvedRevisionId(pool: Pool): Promise<string> {
  const rev = await pool.query<{ id: string }>(
    `SELECT r.id FROM "ExerciseRevision" r
     WHERE r.status = 'APPROVED'
     ORDER BY r."createdAt" ASC
     LIMIT 1`,
  );
  const id = rev.rows[0]?.id;
  if (!id) throw new Error('APPROVED_REVISION_MISSING');
  return id;
}

describe('CATALOG-V3-01A FIX-01 migration 219 invariants', () => {
  it('applies 219, freezes semantic metadata, enforces empty-group + vocab', async () => {
    process.env[WEIGHT_APP_DISPOSABLE_TEST_DB] = '1';
    confirmSafeDisposableDatabase(process.env.DATABASE_URL);

    await withDisposableMigratedDb(async ({ pool }) => {
      const pins = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "WorkoutCatalogReleaseItem" i
         JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
         WHERE r.code = $1 AND r.status = 'PUBLISHED'`,
        [CANONICAL_RELEASE_CODE],
      );
      expect(Number(pins.rows[0]?.c ?? 0)).toBe(84);

      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "ExerciseRevisionReadiness"`,
            )
          ).rows[0]?.c ?? -1,
        ),
      ).toBe(0);
      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "ExerciseRevisionTaxonomy"`,
            )
          ).rows[0]?.c ?? -1,
        ),
      ).toBe(0);
      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogMuscleCode"`,
            )
          ).rows[0]?.c ?? 0,
        ),
      ).toBeGreaterThanOrEqual(20);
      expect(
        Number(
          (
            await pool.query<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogMovementPatternCode"`,
            )
          ).rows[0]?.c ?? 0,
        ),
      ).toBeGreaterThanOrEqual(20);

      // Redundant 219 self-link twin must not exist; 210 constraint remains.
      const selfCons = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE conname IN ('ExerciseVariantRelation_no_self', 'ExerciseVariantRelation_no_self_chk')
         ORDER BY conname`,
      );
      expect(selfCons.rows.map((r) => r.conname)).toEqual([
        'ExerciseVariantRelation_no_self',
      ]);

      const approvedId = await approvedRevisionId(pool);
      const draftId = await createDraftRevision(pool);

      // --- DRAFT writes allowed ---
      await pool.query(
        `INSERT INTO "ExerciseRevisionTaxonomy"
          ("exerciseRevisionId", "primaryMovementPattern", "trainingRole", "progressionGroup")
         VALUES ($1, 'HORIZONTAL_PUSH', 'MAIN', 'push_up')`,
        [draftId],
      );
      await pool.query(
        `UPDATE "ExerciseRevisionTaxonomy"
         SET "trainingRole" = 'ACCESSORY'
         WHERE "exerciseRevisionId" = $1`,
        [draftId],
      );
      await pool.query(
        `INSERT INTO "ExerciseRevisionMuscleInvolvement"
          (id, "exerciseRevisionId", "muscleCode", involvement, "sortOrder")
         VALUES ($1, $2, 'CHEST', 'PRIMARY', 0)`,
        [randomUUID(), draftId],
      );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const g = await client.query<{ id: string }>(
          `INSERT INTO "ExerciseRevisionEquipmentGroup"
            (id, "exerciseRevisionId", "groupKind", "sortOrder")
           VALUES ($1, $2, 'ALL_OF', 0)
           RETURNING id`,
          [randomUUID(), draftId],
        );
        const groupId = g.rows[0]!.id;
        await client.query(
          `INSERT INTO "ExerciseRevisionEquipmentItem"
            (id, "groupId", "equipmentCode", "sortOrder")
           VALUES ($1, $2, 'DUMBBELL', 0), ($3, $2, 'BENCH', 1)`,
          [randomUUID(), groupId, randomUUID()],
        );
        await client.query('COMMIT');

        // ANY_OF + OPTIONAL in same txn
        await client.query('BEGIN');
        const anyG = await client.query<{ id: string }>(
          `INSERT INTO "ExerciseRevisionEquipmentGroup"
            (id, "exerciseRevisionId", "groupKind", "sortOrder")
           VALUES ($1, $2, 'ANY_OF', 1)
           RETURNING id`,
          [randomUUID(), draftId],
        );
        await client.query(
          `INSERT INTO "ExerciseRevisionEquipmentItem"
            (id, "groupId", "equipmentCode", "sortOrder")
           VALUES ($1, $2, 'KETTLEBELL', 0), ($3, $2, 'DUMBBELL', 1)`,
          [randomUUID(), anyG.rows[0]!.id, randomUUID()],
        );
        const optG = await client.query<{ id: string }>(
          `INSERT INTO "ExerciseRevisionEquipmentGroup"
            (id, "exerciseRevisionId", "groupKind", "sortOrder")
           VALUES ($1, $2, 'OPTIONAL', 2)
           RETURNING id`,
          [randomUUID(), draftId],
        );
        await client.query(
          `INSERT INTO "ExerciseRevisionEquipmentItem"
            (id, "groupId", "equipmentCode", "sortOrder")
           VALUES ($1, $2, 'MAT', 0)`,
          [randomUUID(), optG.rows[0]!.id],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      // Empty group rejected at COMMIT (ALL_OF / ANY_OF / OPTIONAL)
      const emptyKindOrders: Array<{ kind: 'ALL_OF' | 'ANY_OF' | 'OPTIONAL'; order: number }> = [
        { kind: 'ALL_OF', order: 90 },
        { kind: 'ANY_OF', order: 91 },
        { kind: 'OPTIONAL', order: 92 },
      ];
      for (const { kind, order } of emptyKindOrders) {
        await expect(
          (async () => {
            const c = await pool.connect();
            try {
              await c.query('BEGIN');
              await c.query(
                `INSERT INTO "ExerciseRevisionEquipmentGroup"
                  (id, "exerciseRevisionId", "groupKind", "sortOrder")
                 VALUES ($1, $2, $3, $4)`,
                [randomUUID(), draftId, kind, order],
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
      }

      // Delete last item leaving empty group → reject
      const lastItemGroup = await pool.query<{ id: string; groupId: string }>(
        `SELECT i.id, i."groupId"
         FROM "ExerciseRevisionEquipmentItem" i
         JOIN "ExerciseRevisionEquipmentGroup" g ON g.id = i."groupId"
         WHERE g."exerciseRevisionId" = $1 AND g."groupKind" = 'OPTIONAL'
         LIMIT 1`,
        [draftId],
      );
      await expect(
        (async () => {
          const c = await pool.connect();
          try {
            await c.query('BEGIN');
            await c.query(`DELETE FROM "ExerciseRevisionEquipmentItem" WHERE id = $1`, [
              lastItemGroup.rows[0]!.id,
            ]);
            await c.query('COMMIT');
          } catch (e) {
            await c.query('ROLLBACK').catch(() => undefined);
            throw e;
          } finally {
            c.release();
          }
        })(),
      ).rejects.toThrow(/V3_EQUIPMENT_GROUP_EMPTY/);

      // Vocabulary rejection
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionMuscleInvolvement"
            (id, "exerciseRevisionId", "muscleCode", involvement, "sortOrder")
           VALUES ($1, $2, 'NOT_A_MUSCLE', 'PRIMARY', 9)`,
          [randomUUID(), draftId],
        ),
      ).rejects.toThrow(/foreign key|WorkoutCatalogMuscleCode/i);
      await expect(
        pool.query(
          `UPDATE "ExerciseRevisionTaxonomy"
           SET "primaryMovementPattern" = 'NOT_A_PATTERN'
           WHERE "exerciseRevisionId" = $1`,
          [draftId],
        ),
      ).rejects.toThrow(/foreign key|WorkoutCatalogMovementPatternCode/i);

      // Duplicate muscle
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionMuscleInvolvement"
            (id, "exerciseRevisionId", "muscleCode", involvement, "sortOrder")
           VALUES ($1, $2, 'CHEST', 'SECONDARY', 1)`,
          [randomUUID(), draftId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);

      // --- APPROVED semantic freeze ---
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionTaxonomy"
            ("exerciseRevisionId", "trainingRole")
           VALUES ($1, 'MAIN')`,
          [approvedId],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);

      // Seed taxonomy on draft then approve → freeze
      const draft2 = await createDraftRevision(pool);
      await pool.query(
        `INSERT INTO "ExerciseRevisionTaxonomy"
          ("exerciseRevisionId", "primaryMovementPattern", "trainingRole")
         VALUES ($1, 'SQUAT', 'MAIN')`,
        [draft2],
      );
      await pool.query(
        `INSERT INTO "ExerciseRevisionMuscleInvolvement"
          (id, "exerciseRevisionId", "muscleCode", involvement, "sortOrder")
         VALUES ($1, $2, 'QUADS', 'PRIMARY', 0)`,
        [randomUUID(), draft2],
      );
      const cEquip = await pool.connect();
      let frozenGroupId = '';
      let frozenItemId = '';
      try {
        await cEquip.query('BEGIN');
        const g = await cEquip.query<{ id: string }>(
          `INSERT INTO "ExerciseRevisionEquipmentGroup"
            (id, "exerciseRevisionId", "groupKind", "sortOrder")
           VALUES ($1, $2, 'ALL_OF', 0) RETURNING id`,
          [randomUUID(), draft2],
        );
        frozenGroupId = g.rows[0]!.id;
        const item = await cEquip.query<{ id: string }>(
          `INSERT INTO "ExerciseRevisionEquipmentItem"
            (id, "groupId", "equipmentCode", "sortOrder")
           VALUES ($1, $2, 'BODYWEIGHT', 0) RETURNING id`,
          [randomUUID(), frozenGroupId],
        );
        frozenItemId = item.rows[0]!.id;
        await cEquip.query('COMMIT');
      } finally {
        cEquip.release();
      }

      await pool.query(
        `UPDATE "ExerciseRevision" SET status = 'APPROVED' WHERE id = $1`,
        [draft2],
      );

      await expect(
        pool.query(
          `UPDATE "ExerciseRevisionTaxonomy" SET "trainingRole" = 'ACCESSORY'
           WHERE "exerciseRevisionId" = $1`,
          [draft2],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(`DELETE FROM "ExerciseRevisionTaxonomy" WHERE "exerciseRevisionId" = $1`, [
          draft2,
        ]),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionMuscleInvolvement"
            (id, "exerciseRevisionId", "muscleCode", involvement, "sortOrder")
           VALUES ($1, $2, 'GLUTES', 'SECONDARY', 1)`,
          [randomUUID(), draft2],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(
          `UPDATE "ExerciseRevisionMuscleInvolvement" SET involvement = 'SECONDARY'
           WHERE "exerciseRevisionId" = $1 AND "muscleCode" = 'QUADS'`,
          [draft2],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(
          `DELETE FROM "ExerciseRevisionMuscleInvolvement"
           WHERE "exerciseRevisionId" = $1 AND "muscleCode" = 'QUADS'`,
          [draft2],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionEquipmentGroup"
            (id, "exerciseRevisionId", "groupKind", "sortOrder")
           VALUES ($1, $2, 'ANY_OF', 1)`,
          [randomUUID(), draft2],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(
          `INSERT INTO "ExerciseRevisionEquipmentItem"
            (id, "groupId", "equipmentCode", "sortOrder")
           VALUES ($1, $2, 'MAT', 1)`,
          [randomUUID(), frozenGroupId],
        ),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(`DELETE FROM "ExerciseRevisionEquipmentItem" WHERE id = $1`, [frozenItemId]),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);
      await expect(
        pool.query(`DELETE FROM "ExerciseRevisionEquipmentGroup" WHERE id = $1`, [
          frozenGroupId,
        ]),
      ).rejects.toThrow(/V3_REVISION_SEMANTIC_IMMUTABLE/);

      // APPROVED → DRAFT bypass blocked by existing revision lifecycle
      await expect(
        pool.query(`UPDATE "ExerciseRevision" SET status = 'DRAFT' WHERE id = $1`, [draft2]),
      ).rejects.toThrow(/EXERCISE_REVISION_IMMUTABLE|EXERCISE_REVISION_STATUS_INVALID/);

      // Readiness OPERATIONAL_MUTABLE on APPROVED (no fake READY default)
      await pool.query(
        `INSERT INTO "ExerciseRevisionReadiness"
          ("exerciseRevisionId", "energyReady", "generatorReady")
         VALUES ($1, true, false)`,
        [approvedId],
      );
      await pool.query(
        `UPDATE "ExerciseRevisionReadiness"
         SET "timingReady" = true, "mediaReady" = false
         WHERE "exerciseRevisionId" = $1`,
        [approvedId],
      );
      const ready = await pool.query<{ energyReady: boolean | null; generatorReady: boolean | null }>(
        `SELECT "energyReady", "generatorReady" FROM "ExerciseRevisionReadiness"
         WHERE "exerciseRevisionId" = $1`,
        [approvedId],
      );
      expect(ready.rows[0]?.energyReady).toBe(true);
      expect(ready.rows[0]?.generatorReady).toBe(false);

      // Content immutability still holds
      await expect(
        pool.query(
          `UPDATE "ExerciseRevision" SET "nameRu" = "nameRu" || ' x' WHERE id = $1`,
          [approvedId],
        ),
      ).rejects.toThrow(/EXERCISE_REVISION_IMMUTABLE/);

      // Self-link still rejected via 210 constraint
      const ex = await pool.query<{ id: string }>(
        `SELECT id FROM "Exercise" WHERE key IS NOT NULL ORDER BY key ASC LIMIT 1`,
      );
      await expect(
        pool.query(
          `INSERT INTO "ExerciseVariantRelation"
            (id, "fromExerciseId", "toExerciseId", "relationType", priority, "equipmentContext", "placeContext", "levelDelta", active)
           VALUES ($1, $2, $2, 'EASIER', 0, '', '', -1, true)`,
          [randomUUID(), ex.rows[0]!.id],
        ),
      ).rejects.toThrow(/no_self|check/i);

      const energyCols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'ExerciseEnergyProfile' AND column_name = 'metValue'`,
      );
      expect(energyCols.rowCount).toBe(1);
    });
  }, 180_000);
});
