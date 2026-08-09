/**
 * WORKOUT-CATALOG-01C-A — ExerciseMedia foundation persistence.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { runSqlMigrations } from "../../scripts/lib/sql-migration-runner.mjs";
import { PrismaService } from "../../src/infrastructure/database/prisma.service";
import { ExerciseMediaService } from "../../src/modules/workout-engine/application/exercise-media.service";
import { WorkoutCatalogReleaseService } from "../../src/modules/workout-engine/catalog/workout-catalog-release.service";
import { EXERCISE_MEDIA_FOUNDATION_ROLES } from "../../src/modules/workout-engine/domain/exercise-media.types";
import {
  assertCanonicalPublished,
  withDisposableMigratedDb,
} from "./helpers/disposable-catalog-db";

function mediaService(db: PrismaService) {
  return new ExerciseMediaService(db);
}

async function loadApprovedRevision(pool: Pool, exerciseKey: string) {
  const row = await pool.query<{ revisionId: string; exerciseId: string }>(
    `SELECT i."exerciseRevisionId" AS "revisionId", i."exerciseId"
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "WorkoutCatalogRelease" r ON r.id = i."releaseId"
     JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE r.status = 'PUBLISHED' AND e.key = $1
     LIMIT 1`,
    [exerciseKey],
  );
  expect(row.rows.length).toBeGreaterThan(0);
  return row.rows[0]!;
}

describe("WORKOUT-CATALOG-01C-A ExerciseMedia foundation", () => {
  it("migration 214 applies on fresh DB and a second run is idempotent (0 applied)", async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const ledger = await pool.query<{ migrationName: string }>(
        `SELECT "migrationName" FROM "SchemaMigrationLedger"
         WHERE "migrationName" = $1`,
        ["214_workout_catalog_01c_a_exercise_media_foundation"],
      );
      expect(ledger.rows).toHaveLength(1);

      const cols = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'ExerciseMedia'
           AND column_name IN (
             'mimeType', 'width', 'height', 'checksum',
             'promptHash', 'characterProfileKey', 'visualStyleKey',
             'outfitProfileKey', 'backgroundProfileKey',
             'approvedAt', 'retiredAt'
           )
         ORDER BY column_name`,
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual([
        "approvedAt",
        "backgroundProfileKey",
        "characterProfileKey",
        "checksum",
        "height",
        "mimeType",
        "outfitProfileKey",
        "promptHash",
        "retiredAt",
        "visualStyleKey",
        "width",
      ]);

      const client = await pool.connect();
      try {
        const rerun = await runSqlMigrations(client, {
          migrationsRoot: resolve(process.cwd(), "prisma/migrations"),
        });
        expect(rerun.applied).toEqual([]);
      } finally {
        client.release();
      }
    });
  }, 300_000);

  it("registers three foundation roles as DRAFT; customer sees empty until APPROVED", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const svc = mediaService(db);
      const catalog = new WorkoutCatalogReleaseService(db);
      const { revisionId } = await loadApprovedRevision(pool, "glute_bridge");

      for (const role of EXERCISE_MEDIA_FOUNDATION_ROLES) {
        const created = await svc.registerMetadata(revisionId, {
          role,
          storageKey: `workout/exercises/glute_bridge/${role.toLowerCase()}.webp`,
          mimeType: "image/webp",
          width: 1280,
          height: 960,
          checksum: `sha256:${role}`,
          provider: "pending",
          promptVersion: "exercise-media-v1",
          promptHash: `hash-${role}`,
          characterProfileKey: "weight-female-v1",
          visualStyleKey: "calm-premium-v1",
          outfitProfileKey: "forest-graphite-v1",
          backgroundProfileKey: "warm-studio-v1",
        });
        expect(created.status).toBe("DRAFT");
        expect(created.role).toBe(role);
        expect(created.storageKey).toContain(role.toLowerCase());
        expect(created.approvedAt).toBeNull();
        expect(created.retiredAt).toBeNull();
        expect(created.promptHash).toBe(`hash-${role}`);
        expect(created.characterProfileKey).toBe("weight-female-v1");
        expect(created.visualStyleKey).toBe("calm-premium-v1");
        expect(created.outfitProfileKey).toBe("forest-graphite-v1");
        expect(created.backgroundProfileKey).toBe("warm-studio-v1");
        expect(created.promptVersion).toBe("exercise-media-v1");
      }

      const publicMedia = await svc.listApprovedPublicForRevision(revisionId);
      expect(publicMedia).toEqual([]);

      const detail = await catalog.getPublishedExerciseDetail("glute_bridge");
      expect(detail.media).toEqual([]);
    });
  }, 300_000);

  it("duplicate APPROVED role is blocked; DRAFT/RETIRED excluded; APPROVED ordered", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const svc = mediaService(db);
      const catalog = new WorkoutCatalogReleaseService(db);
      const { revisionId } = await loadApprovedRevision(pool, "bodyweight_squats");

      const drafts = [];
      for (const role of EXERCISE_MEDIA_FOUNDATION_ROLES) {
        drafts.push(
          await svc.registerMetadata(revisionId, {
            role,
            storageKey: `workout/exercises/bodyweight_squats/${role}.webp`,
            mimeType: "image/webp",
            width: 800,
            height: 600,
            checksum: `sha256:${role}-a`,
          }),
        );
      }

      const approved = [];
      for (const draft of drafts) {
        approved.push(await svc.approve(revisionId, draft.id));
      }
      expect(approved.map((m) => m.status)).toEqual(["APPROVED", "APPROVED", "APPROVED"]);
      expect(approved.every((m) => m.approvedAt != null)).toBe(true);
      expect(approved.every((m) => m.retiredAt == null)).toBe(true);
      expect(approved.every((m) => m.characterProfileKey === "weight-female-v1")).toBe(true);

      const duplicate = await svc.registerMetadata(revisionId, {
        role: "START_POSITION",
        storageKey: "workout/exercises/bodyweight_squats/start-dup.webp",
        mimeType: "image/webp",
        width: 800,
        height: 600,
        checksum: "sha256:dup",
      });
      await expect(svc.approve(revisionId, duplicate.id)).rejects.toThrow(
        /EXERCISE_MEDIA_APPROVED_ROLE_EXISTS/,
      );

      const publicMedia = await svc.listApprovedPublicForRevision(revisionId);
      expect(publicMedia.map((m) => m.role)).toEqual([
        "START_POSITION",
        "END_POSITION",
        "MUSCLE_MAP",
      ]);
      expect(publicMedia.every((m) => !("storageKey" in m))).toBe(true);

      const detail = await catalog.getPublishedExerciseDetail("bodyweight_squats");
      expect(detail.media.map((m: { role: string }) => m.role)).toEqual([
        "START_POSITION",
        "END_POSITION",
        "MUSCLE_MAP",
      ]);

      const retired = await svc.retire(revisionId, approved[0]!.id);
      expect(retired.status).toBe("RETIRED");
      expect(retired.retiredAt).toBeTruthy();
      expect(retired.approvedAt).toBeTruthy();

      const afterRetire = await svc.listApprovedPublicForRevision(revisionId);
      expect(afterRetire.map((m) => m.role)).toEqual(["END_POSITION", "MUSCLE_MAP"]);

      const admin = await svc.listForRevisionAdmin(revisionId);
      expect(admin.some((m) => m.status === "DRAFT")).toBe(true);
      expect(admin.some((m) => m.status === "RETIRED")).toBe(true);
      expect(admin.filter((m) => m.status === "APPROVED").map((m) => m.role)).toEqual([
        "END_POSITION",
        "MUSCLE_MAP",
      ]);
      const retiredAdmin = admin.find((m) => m.id === approved[0]!.id);
      expect(retiredAdmin?.retiredAt).toBeTruthy();
    });
  }, 300_000);

  it("media of one revision do not appear on another; missing media does not break exercise", async () => {
    await withDisposableMigratedDb(async ({ pool, createDb }) => {
      await assertCanonicalPublished(pool);
      const db = createDb();
      const svc = mediaService(db);
      const catalog = new WorkoutCatalogReleaseService(db);

      const a = await loadApprovedRevision(pool, "push_ups");
      const b = await loadApprovedRevision(pool, "band_row");
      expect(a.revisionId).not.toBe(b.revisionId);

      const created = await svc.registerMetadata(a.revisionId, {
        role: "MUSCLE_MAP",
        storageKey: "workout/exercises/push_ups/muscle.webp",
        mimeType: "image/webp",
        width: 1024,
        height: 768,
        checksum: "sha256:push",
      });
      await svc.approve(a.revisionId, created.id);

      expect((await svc.listApprovedPublicForRevision(a.revisionId)).map((m) => m.role)).toEqual([
        "MUSCLE_MAP",
      ]);
      expect(await svc.listApprovedPublicForRevision(b.revisionId)).toEqual([]);

      const detailB = await catalog.getPublishedExerciseDetail("band_row");
      expect(detailB.media).toEqual([]);
      expect(detailB.key).toBe("band_row");
      expect(detailB.techniqueSummaryRu).toBeTruthy();
    });
  }, 300_000);
});
