import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  ALLOWED_MEDIA_MIME,
  assertRightsTransition,
  EXTERNAL_MEDIA_URL_POLICY,
  isPublicationEligibleMedia,
  toUserMediaDto,
  type MediaLicenseType,
  type MediaModerationStatus,
  type MediaRightsStatus,
  type MediaSourceType,
  type RecipeMediaRole,
} from '../domain/recipe-media.policy';

@Injectable()
export class RecipeMediaService {
  readonly externalUrlPolicy = EXTERNAL_MEDIA_URL_POLICY;
  readonly storageConfigured = Boolean(process.env.MEDIA_STORAGE_ROOT?.trim());

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
  ) {}

  async listAssets(filters: {
    sourceType?: string;
    rightsStatus?: string;
    moderationStatus?: string;
    licenseType?: string;
    limit?: number;
  }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filters.sourceType) push(`"sourceType" = ?`, filters.sourceType);
    if (filters.rightsStatus) push(`"rightsStatus" = ?`, filters.rightsStatus);
    if (filters.moderationStatus) push(`"moderationStatus" = ?`, filters.moderationStatus);
    if (filters.licenseType) push(`"licenseType" = ?`, filters.licenseType);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(filters.limit ?? 100);
    const rows = await this.db.query(
      `SELECT * FROM "MediaAsset" ${where} ORDER BY "updatedAt" DESC LIMIT $${values.length}`,
      values,
    );
    return rows.rows;
  }

  async getAsset(id: string) {
    const row = await this.db.query(`SELECT * FROM "MediaAsset" WHERE id = $1`, [id]);
    return row.rows[0] ?? null;
  }

  async registerMetadata(input: {
    actorUserId: string;
    actorRole: string;
    sourceType: MediaSourceType;
    licenseType?: MediaLicenseType;
    sourceUrl?: string | null;
    sourceReference?: string | null;
    rightsHolder?: string | null;
    licenseUrl?: string | null;
    attributionText?: string | null;
    originalFilename?: string | null;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
    sizeBytes?: number | null;
    checksumSha256?: string | null;
    aiProvider?: string | null;
    aiModel?: string | null;
    aiPromptHash?: string | null;
  }) {
    this.assertStaff(input.actorRole);
    if (input.mimeType && !ALLOWED_MEDIA_MIME.has(input.mimeType)) {
      throw new Error('MEDIA_MIME_NOT_ALLOWED');
    }
    if (input.sourceUrl && !/^https?:\/\//i.test(input.sourceUrl)) {
      throw new Error('MEDIA_SOURCE_URL_INVALID');
    }
    // sourceUrl is provenance only — never used as runtime USER src.
    const licenseType = input.licenseType ?? (input.sourceType === 'LEGACY_UNKNOWN' ? 'UNKNOWN' : 'UNKNOWN');
    const inserted = await this.db.query(
      `INSERT INTO "MediaAsset" (
         "storageProvider", "sourceType", "sourceUrl", "sourceReference",
         "rightsHolder", "licenseType", "licenseUrl", "attributionText",
         "originalFilename", "mimeType", width, height, "sizeBytes", "checksumSha256",
         "aiProvider", "aiModel", "aiPromptHash", "createdBy",
         "moderationStatus", "rightsStatus"
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         'PENDING', 'PENDING_REVIEW'
       ) RETURNING *`,
      [
        this.storageConfigured ? 'LOCAL' : 'LOCAL_TEST',
        input.sourceType,
        input.sourceUrl ?? null,
        input.sourceReference ?? null,
        input.rightsHolder ?? null,
        licenseType,
        input.licenseUrl ?? null,
        input.attributionText ?? null,
        input.originalFilename ?? null,
        input.mimeType ?? null,
        input.width ?? null,
        input.height ?? null,
        input.sizeBytes ?? null,
        input.checksumSha256 ?? null,
        input.aiProvider ?? null,
        input.aiModel ?? null,
        input.aiPromptHash ?? null,
        input.actorUserId,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'media.registered',
      entityType: 'MediaAsset',
      entityId: inserted.rows[0]!.id,
      metadata: { sourceType: input.sourceType, licenseType },
    });
    return {
      ...inserted.rows[0],
      storageConfigured: this.storageConfigured,
      uploadAvailable: this.storageConfigured,
      message: this.storageConfigured ? null : 'MEDIA_STORAGE_NOT_CONFIGURED',
    };
  }

  async patchRights(input: {
    mediaId: string;
    actorUserId: string;
    actorRole: string;
    rightsStatus: MediaRightsStatus;
    licenseType?: MediaLicenseType;
    attributionText?: string | null;
    rightsValidUntil?: string | null;
    reason?: string;
  }) {
    this.assertStaff(input.actorRole);
    const current = await this.getAsset(input.mediaId);
    if (!current) throw new Error('MEDIA_NOT_FOUND');
    assertRightsTransition(current.rightsStatus as MediaRightsStatus, input.rightsStatus);
    if (input.rightsStatus === 'APPROVED') {
      const licenseType = (input.licenseType ?? current.licenseType) as MediaLicenseType;
      if (licenseType === 'UNKNOWN' || current.sourceType === 'LEGACY_UNKNOWN') {
        throw new Error('MEDIA_CANNOT_APPROVE_UNKNOWN');
      }
    }
    const updated = await this.db.query(
      `UPDATE "MediaAsset"
       SET "rightsStatus" = $2,
           "licenseType" = COALESCE($3, "licenseType"),
           "attributionText" = COALESCE($4, "attributionText"),
           "rightsValidUntil" = COALESCE($5::timestamptz, "rightsValidUntil"),
           "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [
        input.mediaId,
        input.rightsStatus,
        input.licenseType ?? null,
        input.attributionText ?? null,
        input.rightsValidUntil ?? null,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'media.rights_changed',
      entityType: 'MediaAsset',
      entityId: input.mediaId,
      metadata: { from: current.rightsStatus, to: input.rightsStatus, reason: input.reason ?? null },
    });
    return updated.rows[0];
  }

  async patchModeration(input: {
    mediaId: string;
    actorUserId: string;
    actorRole: string;
    moderationStatus: MediaModerationStatus;
    reason?: string;
  }) {
    this.assertStaff(input.actorRole);
    const current = await this.getAsset(input.mediaId);
    if (!current) throw new Error('MEDIA_NOT_FOUND');
    const updated = await this.db.query(
      `UPDATE "MediaAsset"
       SET "moderationStatus" = $2, "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [input.mediaId, input.moderationStatus],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'media.moderation_changed',
      entityType: 'MediaAsset',
      entityId: input.mediaId,
      metadata: { from: current.moderationStatus, to: input.moderationStatus, reason: input.reason ?? null },
    });
    return updated.rows[0];
  }

  async takedown(input: { mediaId: string; actorUserId: string; actorRole: string; reason: string }) {
    if (String(input.actorRole).toUpperCase() !== 'OWNER') throw new Error('OWNER_ACCESS_FORBIDDEN');
    if (!String(input.reason ?? '').trim()) throw new Error('MEDIA_TAKEDOWN_REASON_REQUIRED');
    const current = await this.getAsset(input.mediaId);
    if (!current) throw new Error('MEDIA_NOT_FOUND');
    const updated = await this.db.query(
      `UPDATE "MediaAsset"
       SET "rightsStatus" = 'TAKEDOWN',
           "moderationStatus" = 'BLOCKED',
           "updatedAt" = now()
       WHERE id = $1
       RETURNING *`,
      [input.mediaId],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'media.takedown',
      entityType: 'MediaAsset',
      entityId: input.mediaId,
      metadata: { reason: input.reason },
    });
    return updated.rows[0];
  }

  async listForVersion(recipeVersionId: string) {
    const rows = await this.db.query(
      `SELECT m.*, a."sourceType", a."licenseType", a."rightsStatus", a."moderationStatus",
              a."attributionText", a."rightsValidUntil", a."mimeType", a.width, a.height,
              a."storageKey", a."sourceUrl"
       FROM "RecipeVersionMedia" m
       JOIN "MediaAsset" a ON a.id = m."mediaAssetId"
       WHERE m."recipeVersionId" = $1
       ORDER BY m.role, m.position`,
      [recipeVersionId],
    );
    return rows.rows;
  }

  async linkToVersion(input: {
    recipeId: string;
    versionId: string;
    mediaAssetId: string;
    role: RecipeMediaRole;
    position?: number;
    altText: string;
    caption?: string | null;
    stepIndex?: number | null;
    actorUserId: string;
    actorRole: string;
  }) {
    this.assertStaff(input.actorRole);
    if (!String(input.altText ?? '').trim()) throw new Error('MEDIA_ALT_TEXT_REQUIRED');
    const version = await this.db.query(
      `SELECT id FROM "RecipeVersion" WHERE id = $1 AND "recipeId" = $2`,
      [input.versionId, input.recipeId],
    );
    if (!version.rows[0]) throw new Error('RECIPE_VERSION_NOT_FOUND');
    const asset = await this.getAsset(input.mediaAssetId);
    if (!asset) throw new Error('MEDIA_NOT_FOUND');
    if (asset.rightsStatus === 'TAKEDOWN' || asset.moderationStatus === 'BLOCKED') {
      throw new Error('MEDIA_BLOCKED');
    }
    const life = await this.db.query<{ lifecycleStatus: string }>(
      `SELECT "lifecycleStatus" FROM "RecipeVersionLifecycle" WHERE "recipeVersionId" = $1`,
      [input.versionId],
    );
    if (life.rows[0]?.lifecycleStatus === 'PUBLISHED') {
      throw new Error('RECIPE_VERSION_MEDIA_IMMUTABLE');
    }
    const inserted = await this.db.query(
      `INSERT INTO "RecipeVersionMedia" (
         "recipeVersionId", "mediaAssetId", role, position, "altText", caption, "stepIndex"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.versionId,
        input.mediaAssetId,
        input.role,
        input.position ?? 0,
        input.altText.trim(),
        input.caption ?? null,
        input.stepIndex ?? null,
      ],
    );
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'media.linked',
      entityType: 'RecipeVersionMedia',
      entityId: inserted.rows[0]!.id,
      metadata: { recipeVersionId: input.versionId, mediaAssetId: input.mediaAssetId, role: input.role },
    });
    return inserted.rows[0];
  }

  async unlinkFromVersion(input: {
    recipeId: string;
    versionId: string;
    linkId: string;
    actorUserId: string;
    actorRole: string;
  }) {
    this.assertStaff(input.actorRole);
    const life = await this.db.query<{ lifecycleStatus: string }>(
      `SELECT "lifecycleStatus" FROM "RecipeVersionLifecycle" WHERE "recipeVersionId" = $1`,
      [input.versionId],
    );
    if (life.rows[0]?.lifecycleStatus === 'PUBLISHED') {
      throw new Error('RECIPE_VERSION_MEDIA_IMMUTABLE');
    }
    const deleted = await this.db.query(
      `DELETE FROM "RecipeVersionMedia" m
       USING "RecipeVersion" v
       WHERE m.id = $1
         AND m."recipeVersionId" = $2
         AND v.id = m."recipeVersionId"
         AND v."recipeId" = $3
       RETURNING m.id`,
      [input.linkId, input.versionId, input.recipeId],
    );
    if (!deleted.rows[0]) throw new Error('MEDIA_LINK_NOT_FOUND');
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'media.unlinked',
      entityType: 'RecipeVersionMedia',
      entityId: input.linkId,
      metadata: { recipeVersionId: input.versionId },
    });
    return { id: input.linkId, deleted: true };
  }

  async assertPublicationMediaGate(recipeVersionId: string) {
    const links = await this.listForVersion(recipeVersionId);
    if (links.length === 0) {
      return { allowed: true, linkedCount: 0, policy: 'MEDIA_OPTIONAL' };
    }
    for (const link of links) {
      const check = isPublicationEligibleMedia({
        rightsStatus: link.rightsStatus,
        moderationStatus: link.moderationStatus,
        licenseType: link.licenseType,
        sourceType: link.sourceType,
        attributionText: link.attributionText,
        rightsValidUntil: link.rightsValidUntil,
      });
      if (!check.eligible) {
        throw Object.assign(new Error('MEDIA_PUBLICATION_BLOCKED'), {
          code: 'MEDIA_PUBLICATION_BLOCKED',
          reason: check.reason,
          mediaAssetId: link.mediaAssetId,
        });
      }
    }
    return { allowed: true, linkedCount: links.length, policy: 'ATTACHED_MEDIA_MUST_BE_APPROVED' };
  }

  async listUserVisibleForVersion(recipeVersionId: string) {
    const links = await this.listForVersion(recipeVersionId);
    return links.map((link) => {
      const eligible = isPublicationEligibleMedia({
        rightsStatus: link.rightsStatus,
        moderationStatus: link.moderationStatus,
        licenseType: link.licenseType,
        sourceType: link.sourceType,
        attributionText: link.attributionText,
        rightsValidUntil: link.rightsValidUntil,
      });
      const takedown = link.rightsStatus === 'TAKEDOWN' || link.moderationStatus === 'BLOCKED';
      return toUserMediaDto({
        id: link.id,
        role: link.role,
        altText: link.altText,
        caption: link.caption,
        width: link.width,
        height: link.height,
        mimeType: link.mimeType,
        deliveryUrl: eligible.eligible && !takedown ? `/api/v1/media/${link.mediaAssetId}/content` : null,
        placeholder: takedown || !eligible.eligible,
      });
    });
  }

  async mediaBackfillReport() {
    // Current Recipe schema has no legacy image columns — report zero discovered assets.
    const assets = await this.db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "MediaAsset"`);
    const links = await this.db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "RecipeVersionMedia"`);
    return {
      package: 'RP2-02C',
      legacyMediaFound: 0,
      assetsCreated: Number(assets.rows[0]?.n ?? 0),
      linksCreated: Number(links.rows[0]?.n ?? 0),
      sourceTypeDistribution: {},
      note: 'No legacy Recipe image URL columns; MediaAsset populated only via admin registration.',
      externalUrlPolicy: EXTERNAL_MEDIA_URL_POLICY,
    };
  }

  private assertStaff(role: string) {
    const normalized = String(role ?? '').toUpperCase();
    if (normalized !== 'OWNER' && normalized !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }
}
