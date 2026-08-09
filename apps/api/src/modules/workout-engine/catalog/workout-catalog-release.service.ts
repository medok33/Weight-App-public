import { Inject, Injectable } from "@nestjs/common";
import { PrismaService, type SqlQuery } from "../../../infrastructure/database/prisma.service";
import type {
  CatalogExercise,
  MovementPattern,
  RiskLevel,
  TrainingLevel,
} from "../domain/workout-engine.types";
import { BOOTSTRAP_RELEASE_CODE } from "./catalog-enums";

export type PublishedCatalogRelease = {
  id: string;
  code: string;
  status: string;
  manifestVersion: string;
  publishedAt: Date | null;
};

/** Transaction-scoped advisory lock for catalog publication (global). */
export const CATALOG_PUBLISH_ADVISORY_LOCK_KEY = 210_001_01;

const MANDATORY_REVISION_FIELDS = [
  "nameRu",
  "techniqueRu",
  "commonMistakeRu",
  "easierVariantRu",
  "breathingRu",
  "stopConditionsRu",
] as const;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      return [];
    }
  }
  return [];
}

function requireNonEmpty(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("WORKOUT_CATALOG_INTEGRITY_ERROR");
  }
  return value;
}

@Injectable()
export class WorkoutCatalogReleaseService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async resolveCurrentPublishedRelease(): Promise<PublishedCatalogRelease | null> {
    const result = await this.db.query<{
      id: string;
      code: string;
      status: string;
      manifestVersion: string;
      publishedAt: Date | null;
    }>(
      `SELECT id, code, status, "manifestVersion", "publishedAt"
       FROM "WorkoutCatalogRelease"
       WHERE status = 'PUBLISHED'
       ORDER BY "publishedAt" ASC NULLS LAST, "createdAt" ASC
       LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }

  /**
   * Generator-eligible exercises: current PUBLISHED release items matching the
   * canonical eligibility predicate. Customer-facing content comes only from the
   * pinned ExerciseRevision (no Exercise hub COALESCE fallback).
   */
  async listGeneratorEligibleExercises(): Promise<{
    release: PublishedCatalogRelease;
    exercises: CatalogExercise[];
  }> {
    const release = await this.resolveCurrentPublishedRelease();
    if (!release) {
      throw new Error("WORKOUT_CATALOG_RELEASE_MISSING");
    }

    const result = await this.db.query<{
      id: string;
      key: string | null;
      hubName: string;
      nameRu: string | null;
      nameEn: string | null;
      techniqueRu: string | null;
      techniqueEn: string | null;
      commonMistakeRu: string | null;
      commonMistakeEn: string | null;
      easierVariantRu: string | null;
      easierVariantEn: string | null;
      breathingRu: string | null;
      breathingEn: string | null;
      stopConditionsRu: string | null;
      stopConditionsEn: string | null;
      preferredCandidateKey: string | null;
      estimatedDurationSeconds: number | null;
      repetitionMode: string | null;
      defaultSets: number | null;
      defaultDurationSeconds: number | null;
      defaultRepsMin: number | null;
      defaultRepsMax: number | null;
      hubEstimatedMinutes: number | null;
      riskLevel: string;
      movementPattern: string | null;
      difficulty: string | null;
      equipmentCodesJson: unknown;
      muscleGroupsJson: unknown;
      isActive: boolean;
      revisionId: string;
      revisionStatus: string;
    }>(
      `SELECT e.id, e.key, e.name AS "hubName",
              r."nameRu", r."nameEn",
              r."techniqueRu", r."techniqueEn",
              r."commonMistakeRu", r."commonMistakeEn",
              r."easierVariantRu", r."easierVariantEn",
              r."breathingRu", r."breathingEn",
              r."stopConditionsRu", r."stopConditionsEn",
              preferred.key AS "preferredCandidateKey",
              r."estimatedDurationSeconds", r."repetitionMode",
              r."defaultSets", r."defaultDurationSeconds", r."defaultRepsMin", r."defaultRepsMax",
              e."estimatedMinutes" AS "hubEstimatedMinutes",
              e."riskLevel", e."movementPattern", e.difficulty,
              e."equipmentCodesJson", e."muscleGroupsJson", e."isActive",
              r.id AS "revisionId",
              r.status AS "revisionStatus"
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       JOIN "Exercise" e ON e.id = i."exerciseId"
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       LEFT JOIN LATERAL (
         SELECT pe.key
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" pe ON pe.id = vr."toExerciseId"
         WHERE vr."fromExerciseId" = e.id
           AND vr.active = true
           AND vr.priority = 0
           AND vr."relationType" IN ('EASIER', 'SAME_LEVEL')
         ORDER BY pe.key ASC
         LIMIT 1
       ) preferred ON true
       WHERE rel.id = $1
         AND rel.status = 'PUBLISHED'
         AND i."enabledForGenerator" = true
         AND r.status = 'APPROVED'
         AND r."exerciseId" = i."exerciseId"
         AND e."familyId" IS NOT DISTINCT FROM i."familyId"
         AND e."isActive" = true
         AND e.key IS NOT NULL
       ORDER BY i.ordinal ASC, e.key ASC`,
      [release.id],
    );

    // Skip rows with missing mandatory RU fields rather than throwing for the whole list.
    // This prevents a single corrupt/mutated revision from blocking all candidates.
    const exercises: CatalogExercise[] = result.rows.flatMap((row) => {
      let nameRu: string;
      let techniqueRu: string;
      let commonMistakeRu: string;
      let easierVariantRu: string;
      let breathingRu: string;
      let stopConditionsRu: string;
      try {
        nameRu = requireNonEmpty(row.nameRu);
        techniqueRu = requireNonEmpty(row.techniqueRu);
        commonMistakeRu = requireNonEmpty(row.commonMistakeRu);
        easierVariantRu = requireNonEmpty(row.easierVariantRu);
        breathingRu = requireNonEmpty(row.breathingRu);
        stopConditionsRu = requireNonEmpty(row.stopConditionsRu);
      } catch {
        return [];
      }
      const estimatedMinutes =
        row.estimatedDurationSeconds != null
          ? Math.ceil(Number(row.estimatedDurationSeconds) / 60)
          : row.hubEstimatedMinutes;

      return [{
        id: row.id,
        key: row.key!,
        name: nameRu,
        nameRu,
        nameEn: row.nameEn,
        displayNameRu: nameRu,
        displayNameEn: row.nameEn,
        techniqueSummaryRu: techniqueRu,
        techniqueSummaryEn: row.techniqueEn,
        commonMistakeRu,
        commonMistakeEn: row.commonMistakeEn,
        easierVariantRu,
        easierVariantEn: row.easierVariantEn,
        breathingRu,
        breathingEn: row.breathingEn,
        stopConditionsRu,
        stopConditionsEn: row.stopConditionsEn,
        easierVariantKey: row.preferredCandidateKey,
        estimatedMinutes,
        riskLevel: (row.riskLevel as RiskLevel) || "low",
        movementPattern: (row.movementPattern as MovementPattern) || "cardio",
        difficulty: (row.difficulty as TrainingLevel) || "BEGINNER",
        equipmentCodes: asStringArray(row.equipmentCodesJson),
        muscleGroups: asStringArray(row.muscleGroupsJson),
        isActive: row.isActive,
        exerciseRevisionId: row.revisionId,
        repetitionMode: row.repetitionMode as CatalogExercise["repetitionMode"],
        defaultSets: row.defaultSets,
        defaultDurationSeconds: row.defaultDurationSeconds,
        defaultRepsMin: row.defaultRepsMin,
        defaultRepsMax: row.defaultRepsMax,
      }];
    });

    if (exercises.length === 0) {
      throw new Error("WORKOUT_CATALOG_RELEASE_EMPTY");
    }

    return { release, exercises };
  }

  /**
   * Resolve a customer-facing exercise detail through the current PUBLISHED
   * release pin → APPROVED ExerciseRevision. Hub is identity/filter only.
   */
  async getPublishedExerciseDetail(exerciseKey: string): Promise<Record<string, unknown>> {
    const key = String(exerciseKey ?? "").trim();
    if (!key) throw new Error("WORKOUT_EXERCISE_NOT_FOUND");

    const release = await this.resolveCurrentPublishedRelease();
    if (!release) {
      throw new Error("WORKOUT_CATALOG_RELEASE_MISSING");
    }

    const result = await this.db.query<{
      id: string;
      key: string;
      riskLevel: string;
      movementPattern: string | null;
      difficulty: string | null;
      estimatedMinutes: number | null;
      equipmentCodesJson: unknown;
      muscleGroupsJson: unknown;
      revisionId: string;
      revisionStatus: string;
      nameRu: string | null;
      nameEn: string | null;
      techniqueRu: string | null;
      techniqueEn: string | null;
      commonMistakeRu: string | null;
      commonMistakeEn: string | null;
      easierVariantRu: string | null;
      easierVariantEn: string | null;
      breathingRu: string | null;
      breathingEn: string | null;
      stopConditionsRu: string | null;
      stopConditionsEn: string | null;
      estimatedDurationSeconds: number | null;
      repetitionMode: string | null;
      defaultDurationSeconds: number | null;
      defaultRepsMin: number | null;
      defaultRepsMax: number | null;
      preferredCandidateKey: string | null;
      enabledForGenerator: boolean;
    }>(
      `SELECT e.id, e.key, e."riskLevel", e."movementPattern", e.difficulty,
              e."estimatedMinutes", e."equipmentCodesJson", e."muscleGroupsJson",
              r.id AS "revisionId", r.status AS "revisionStatus",
              r."nameRu", r."nameEn",
              r."techniqueRu", r."techniqueEn",
              r."commonMistakeRu", r."commonMistakeEn",
              r."easierVariantRu", r."easierVariantEn",
              r."breathingRu", r."breathingEn",
              r."stopConditionsRu", r."stopConditionsEn",
              r."estimatedDurationSeconds", r."repetitionMode",
              r."defaultDurationSeconds", r."defaultRepsMin", r."defaultRepsMax",
              preferred.key AS "preferredCandidateKey",
              i."enabledForGenerator"
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       JOIN "Exercise" e ON e.id = i."exerciseId"
       JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       LEFT JOIN LATERAL (
         SELECT pe.key
         FROM "ExerciseVariantRelation" vr
         JOIN "Exercise" pe ON pe.id = vr."toExerciseId"
         WHERE vr."fromExerciseId" = e.id
           AND vr.active = true
           AND vr.priority = 0
           AND vr."relationType" IN ('EASIER', 'SAME_LEVEL')
         ORDER BY pe.key ASC
         LIMIT 1
       ) preferred ON true
       WHERE rel.id = $1
         AND rel.status = 'PUBLISHED'
         AND e.key = $2
         AND e."isActive" = true
       LIMIT 1`,
      [release.id, key],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("WORKOUT_EXERCISE_NOT_AVAILABLE");
    }
    if (row.revisionStatus !== "APPROVED") {
      throw new Error("WORKOUT_CATALOG_INTEGRITY_ERROR");
    }
    for (const field of MANDATORY_REVISION_FIELDS) {
      requireNonEmpty(row[field]);
    }

    const nameRu = row.nameRu as string;
    const nameEn = row.nameEn ?? nameRu;
    const estimatedMinutes =
      row.estimatedDurationSeconds != null
        ? Math.ceil(Number(row.estimatedDurationSeconds) / 60)
        : row.estimatedMinutes;

    // Customer media: APPROVED foundation roles only, ordered START → END → MUSCLE_MAP.
    // Missing media → empty list (never blocks the exercise). storageKey is not exposed.
    const media = await this.db.query<Record<string, unknown>>(
      `SELECT id, "mediaType", role, "mimeType", width, height, "altText", "sortOrder"
       FROM "ExerciseMedia"
       WHERE "revisionId" = $1
         AND status = 'APPROVED'
         AND role IN ('START_POSITION', 'END_POSITION', 'MUSCLE_MAP')
       ORDER BY CASE role
         WHEN 'START_POSITION' THEN 0
         WHEN 'END_POSITION' THEN 1
         WHEN 'MUSCLE_MAP' THEN 2
         ELSE 99
       END, "sortOrder" ASC`,
      [row.revisionId],
    );

    return {
      id: row.id,
      key: row.key,
      name: nameRu,
      nameRu,
      nameEn,
      displayNameRu: nameRu,
      displayNameEn: nameEn,
      techniqueSummaryRu: row.techniqueRu,
      techniqueSummaryEn: row.techniqueEn,
      commonMistakeRu: row.commonMistakeRu,
      commonMistakeEn: row.commonMistakeEn,
      easierVariantRu: row.easierVariantRu,
      easierVariantEn: row.easierVariantEn,
      breathingRu: row.breathingRu,
      breathingEn: row.breathingEn,
      stopConditionsRu: row.stopConditionsRu,
      stopConditionsEn: row.stopConditionsEn,
      easierVariantKey: row.preferredCandidateKey,
      estimatedMinutes,
      riskLevel: row.riskLevel,
      movementPattern: row.movementPattern,
      difficulty: row.difficulty,
      equipmentCodesJson: row.equipmentCodesJson,
      muscleGroupsJson: row.muscleGroupsJson,
      exerciseRevisionId: row.revisionId,
      repetitionMode: row.repetitionMode,
      defaultDurationSeconds: row.defaultDurationSeconds,
      defaultRepsMin: row.defaultRepsMin,
      defaultRepsMax: row.defaultRepsMax,
      catalogReleaseId: release.id,
      catalogReleaseCode: release.code,
      enabledForGenerator: row.enabledForGenerator,
      media: media.rows,
    };
  }

  async assertReleasePublishable(
    releaseId: string,
    query: SqlQuery = this.db.query.bind(this.db) as SqlQuery,
  ): Promise<void> {
    const release = await query<{
      status: string;
      itemCount: string;
      eligibleCount: string;
      badCount: string;
    }>(
      // Canonical eligible FILTER must match workout_catalog_release_eligible_item_count.
      // Null-key items are not eligible but are not structurally "bad" (mixed publish OK).
      `SELECT rel.status,
              COUNT(i.id)::text AS "itemCount",
              COUNT(i.id) FILTER (
                WHERE i."enabledForGenerator" = true
                   AND r.id IS NOT NULL
                   AND r.status = 'APPROVED'
                   AND r."exerciseId" = i."exerciseId"
                   AND e."familyId" IS NOT DISTINCT FROM i."familyId"
                   AND e."isActive" IS TRUE
                   AND e.key IS NOT NULL
              )::text AS "eligibleCount",
              COUNT(i.id) FILTER (
                WHERE r.id IS NULL
                   OR r.status IS DISTINCT FROM 'APPROVED'
                   OR r."exerciseId" IS DISTINCT FROM i."exerciseId"
                   OR e.id IS NULL
                   OR e."familyId" IS DISTINCT FROM i."familyId"
                   OR e."isActive" IS NOT TRUE
              )::text AS "badCount"
       FROM "WorkoutCatalogRelease" rel
       LEFT JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
       LEFT JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
       LEFT JOIN "Exercise" e ON e.id = i."exerciseId"
       WHERE rel.id = $1
       GROUP BY rel.status`,
      [releaseId],
    );
    const row = release.rows[0];
    if (!row) throw new Error("WORKOUT_CATALOG_RELEASE_NOT_FOUND");
    if (row.status !== "DRAFT") throw new Error("WORKOUT_CATALOG_RELEASE_NOT_DRAFT");
    if (Number(row.itemCount) < 1 || Number(row.eligibleCount) < 1) {
      throw new Error("WORKOUT_CATALOG_RELEASE_EMPTY");
    }
    if (Number(row.badCount) > 0) throw new Error("WORKOUT_CATALOG_RELEASE_NON_APPROVED");
  }

  /**
   * Atomically retire the current PUBLISHED release (if any) and publish the
   * candidate DRAFT inside one transaction under a global advisory xact lock.
   * On failure the prior PUBLISHED release remains unchanged.
   */
  async publishRelease(releaseId: string): Promise<PublishedCatalogRelease> {
    return this.db.withTransaction(async (query) => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [CATALOG_PUBLISH_ADVISORY_LOCK_KEY]);
      await this.assertReleasePublishable(releaseId, query);

      await query(
        `UPDATE "WorkoutCatalogRelease"
         SET status = 'RETIRED',
             "retiredAt" = COALESCE("retiredAt", now())
         WHERE status = 'PUBLISHED'
           AND id <> $1`,
        [releaseId],
      );

      const updated = await query<{
        id: string;
        code: string;
        status: string;
        manifestVersion: string;
        publishedAt: Date | null;
      }>(
        `UPDATE "WorkoutCatalogRelease"
         SET status = 'PUBLISHED',
             "publishedAt" = COALESCE("publishedAt", now()),
             "retiredAt" = NULL
         WHERE id = $1 AND status = 'DRAFT'
         RETURNING id, code, status, "manifestVersion", "publishedAt"`,
        [releaseId],
      );
      const row = updated.rows[0];
      if (!row) throw new Error("WORKOUT_CATALOG_RELEASE_PUBLISH_FAILED");

      const published = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
      );
      if (Number(published.rows[0]?.count) !== 1) {
        throw new Error("WORKOUT_CATALOG_RELEASE_PUBLISH_FAILED");
      }
      return row;
    });
  }

  /** Idempotent check used by tests/acceptance. */
  async bootstrapReleaseCode(): Promise<string> {
    return BOOTSTRAP_RELEASE_CODE;
  }
}
