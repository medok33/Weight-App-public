import { Inject, Injectable } from "@nestjs/common";
import { PrismaService, type SqlQuery } from "../../../infrastructure/database/prisma.service";
import { EXERCISE_MEDIA_VISUAL_PROFILES } from "../catalog/exercise-media-visual-profiles";
import {
  EXERCISE_MEDIA_FOUNDATION_ROLES,
  EXERCISE_MEDIA_ROLE_ORDER,
  isExerciseMediaFoundationRole,
  type ExerciseMediaAdminView,
  type ExerciseMediaFoundationRole,
  type ExerciseMediaPublicView,
  type RegisterExerciseMediaInput,
} from "../domain/exercise-media.types";

type MediaRow = {
  id: string;
  exerciseId: string;
  revisionId: string | null;
  mediaType: string;
  role: string;
  storageKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  altText: string;
  sortOrder: number;
  status: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  promptHash: string | null;
  characterProfileKey: string | null;
  visualStyleKey: string | null;
  outfitProfileKey: string | null;
  backgroundProfileKey: string | null;
  approvedAt: Date | null;
  retiredAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

const PUBLIC_SELECT = `
  id, "exerciseId", "revisionId", "mediaType", role, "storageKey",
  "mimeType", width, height, checksum, "altText", "sortOrder", status,
  provider, model, "promptVersion", "promptHash",
  "characterProfileKey", "visualStyleKey", "outfitProfileKey", "backgroundProfileKey",
  "approvedAt", "retiredAt", "reviewedAt", "createdAt"
`;

function roleOrderSql(): string {
  return `CASE role
    WHEN 'START_POSITION' THEN 0
    WHEN 'END_POSITION' THEN 1
    WHEN 'MUSCLE_MAP' THEN 2
    ELSE 99
  END`;
}

function asIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAdminView(row: MediaRow): ExerciseMediaAdminView {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    exerciseRevisionId: row.revisionId ?? "",
    role: row.role as ExerciseMediaFoundationRole,
    mediaType: row.mediaType,
    mimeType: row.mimeType,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    altText: row.altText,
    sortOrder: Number(row.sortOrder),
    status: row.status as ExerciseMediaAdminView["status"],
    storageKey: row.storageKey,
    checksum: row.checksum,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    characterProfileKey: row.characterProfileKey,
    visualStyleKey: row.visualStyleKey,
    outfitProfileKey: row.outfitProfileKey,
    backgroundProfileKey: row.backgroundProfileKey,
    approvedAt: asIso(row.approvedAt),
    retiredAt: asIso(row.retiredAt),
    reviewedAt: asIso(row.reviewedAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function toPublicView(row: MediaRow): ExerciseMediaPublicView {
  return {
    id: row.id,
    role: row.role as ExerciseMediaFoundationRole,
    mediaType: row.mediaType,
    mimeType: row.mimeType,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    altText: row.altText,
    sortOrder: Number(row.sortOrder),
  };
}

@Injectable()
export class ExerciseMediaService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async listForRevisionAdmin(revisionId: string): Promise<ExerciseMediaAdminView[]> {
    await this.requireRevision(revisionId);
    const result = await this.db.query<MediaRow>(
      `SELECT ${PUBLIC_SELECT}
       FROM "ExerciseMedia"
       WHERE "revisionId" = $1
         AND role = ANY($2::text[])
       ORDER BY ${roleOrderSql()}, "createdAt" ASC`,
      [revisionId, [...EXERCISE_MEDIA_FOUNDATION_ROLES]],
    );
    return result.rows.map(toAdminView);
  }

  /**
   * Customer-facing approved foundation media for a revision.
   * Missing media → empty array (never throws).
   * Does not expose storageKey.
   */
  async listApprovedPublicForRevision(revisionId: string | null | undefined): Promise<ExerciseMediaPublicView[]> {
    if (!revisionId) return [];
    const result = await this.db.query<MediaRow>(
      `SELECT ${PUBLIC_SELECT}
       FROM "ExerciseMedia"
       WHERE "revisionId" = $1
         AND status = 'APPROVED'
         AND role = ANY($2::text[])
       ORDER BY ${roleOrderSql()}, "sortOrder" ASC`,
      [revisionId, [...EXERCISE_MEDIA_FOUNDATION_ROLES]],
    );
    return result.rows.map(toPublicView);
  }

  async registerMetadata(
    revisionId: string,
    input: RegisterExerciseMediaInput,
  ): Promise<ExerciseMediaAdminView> {
    if (!isExerciseMediaFoundationRole(input.role)) {
      throw new Error("EXERCISE_MEDIA_ROLE_INVALID");
    }
    const storageKey = String(input.storageKey ?? "").trim();
    const mimeType = String(input.mimeType ?? "").trim();
    const checksum = String(input.checksum ?? "").trim();
    if (!storageKey) throw new Error("EXERCISE_MEDIA_STORAGE_KEY_REQUIRED");
    if (!mimeType) throw new Error("EXERCISE_MEDIA_MIME_TYPE_REQUIRED");
    if (!checksum) throw new Error("EXERCISE_MEDIA_CHECKSUM_REQUIRED");
    if (!Number.isInteger(input.width) || input.width <= 0) {
      throw new Error("EXERCISE_MEDIA_DIMENSIONS_INVALID");
    }
    if (!Number.isInteger(input.height) || input.height <= 0) {
      throw new Error("EXERCISE_MEDIA_DIMENSIONS_INVALID");
    }

    const revision = await this.requireRevision(revisionId);
    const sortOrder = EXERCISE_MEDIA_ROLE_ORDER[input.role];
    const altText =
      String(input.altText ?? "").trim() ||
      `${input.role.replaceAll("_", " ").toLowerCase()} for exercise`;

    const characterProfileKey =
      input.characterProfileKey?.trim() || EXERCISE_MEDIA_VISUAL_PROFILES.characterProfileKey;
    const visualStyleKey =
      input.visualStyleKey?.trim() || EXERCISE_MEDIA_VISUAL_PROFILES.visualStyleKey;
    const outfitProfileKey =
      input.outfitProfileKey?.trim() || EXERCISE_MEDIA_VISUAL_PROFILES.outfitProfileKey;
    const backgroundProfileKey =
      input.backgroundProfileKey?.trim() || EXERCISE_MEDIA_VISUAL_PROFILES.backgroundProfileKey;
    const promptVersion =
      input.promptVersion?.trim() || EXERCISE_MEDIA_VISUAL_PROFILES.promptVersion;

    const inserted = await this.db.query<MediaRow>(
      `INSERT INTO "ExerciseMedia" (
         "exerciseId", "revisionId", "mediaType", role, "storageKey",
         "mimeType", width, height, checksum, "altText", "sortOrder",
         status, provider, model, "promptVersion", "promptHash",
         "characterProfileKey", "visualStyleKey", "outfitProfileKey", "backgroundProfileKey",
         provenance
       ) VALUES (
         $1, $2, 'image', $3, $4,
         $5, $6, $7, $8, $9, $10,
         'DRAFT', $11, $12, $13, $14,
         $15, $16, $17, $18,
         'workout-catalog-01c-a'
       )
       RETURNING ${PUBLIC_SELECT}`,
      [
        revision.exerciseId,
        revisionId,
        input.role,
        storageKey,
        mimeType,
        input.width,
        input.height,
        checksum,
        altText,
        sortOrder,
        input.provider?.trim() || "pending",
        input.model?.trim() || null,
        promptVersion,
        input.promptHash?.trim() || null,
        characterProfileKey,
        visualStyleKey,
        outfitProfileKey,
        backgroundProfileKey,
      ],
    );
    return toAdminView(inserted.rows[0]!);
  }

  async approve(revisionId: string, mediaId: string): Promise<ExerciseMediaAdminView> {
    return this.db.withTransaction(async (query) => {
      await this.requireRevision(revisionId, query);
      const locked = await query<MediaRow>(
        `SELECT ${PUBLIC_SELECT}
         FROM "ExerciseMedia"
         WHERE id = $1 AND "revisionId" = $2
         FOR UPDATE`,
        [mediaId, revisionId],
      );
      const row = locked.rows[0];
      if (!row) throw new Error("EXERCISE_MEDIA_NOT_FOUND");
      if (!isExerciseMediaFoundationRole(row.role)) {
        throw new Error("EXERCISE_MEDIA_ROLE_INVALID");
      }
      if (row.status === "APPROVED") return toAdminView(row);
      if (row.status === "RETIRED") throw new Error("EXERCISE_MEDIA_RETIRED");
      if (row.status !== "DRAFT") throw new Error("EXERCISE_MEDIA_STATUS_INVALID");

      try {
        const updated = await query<MediaRow>(
          `UPDATE "ExerciseMedia"
           SET status = 'APPROVED',
               "approvedAt" = COALESCE("approvedAt", now()),
               "reviewedAt" = now(),
               "updatedAt" = now()
           WHERE id = $1 AND "revisionId" = $2 AND status = 'DRAFT'
           RETURNING ${PUBLIC_SELECT}`,
          [mediaId, revisionId],
        );
        if (!updated.rows[0]) throw new Error("EXERCISE_MEDIA_STATUS_INVALID");
        return toAdminView(updated.rows[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ExerciseMedia_revision_role_approved_uidx|duplicate key/i.test(message)) {
          throw new Error("EXERCISE_MEDIA_APPROVED_ROLE_EXISTS");
        }
        throw error;
      }
    });
  }

  async retire(revisionId: string, mediaId: string): Promise<ExerciseMediaAdminView> {
    await this.requireRevision(revisionId);
    const updated = await this.db.query<MediaRow>(
      `UPDATE "ExerciseMedia"
       SET status = 'RETIRED',
           "retiredAt" = COALESCE("retiredAt", now()),
           "updatedAt" = now()
       WHERE id = $1 AND "revisionId" = $2 AND status = 'APPROVED'
       RETURNING ${PUBLIC_SELECT}`,
      [mediaId, revisionId],
    );
    if (!updated.rows[0]) {
      const existing = await this.db.query<{ status: string }>(
        `SELECT status FROM "ExerciseMedia" WHERE id = $1 AND "revisionId" = $2`,
        [mediaId, revisionId],
      );
      if (!existing.rows[0]) throw new Error("EXERCISE_MEDIA_NOT_FOUND");
      throw new Error("EXERCISE_MEDIA_STATUS_INVALID");
    }
    return toAdminView(updated.rows[0]);
  }

  private async requireRevision(
    revisionId: string,
    query: SqlQuery = this.db.query.bind(this.db) as SqlQuery,
  ): Promise<{ id: string; exerciseId: string }> {
    const result = await query<{ id: string; exerciseId: string }>(
      `SELECT id, "exerciseId" FROM "ExerciseRevision" WHERE id = $1`,
      [revisionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("EXERCISE_REVISION_NOT_FOUND");
    return row;
  }
}
