import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';

@Injectable()
export class RecipeFamilyService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
  ) {}

  async list() {
    const rows = await this.db.query(
      `SELECT f.*, COUNT(r.id)::int AS "recipeCount"
       FROM "RecipeFamily" f
       LEFT JOIN "Recipe" r ON r."recipeFamilyId" = f.id
       GROUP BY f.id
       ORDER BY f."canonicalName" ASC`,
    );
    return rows.rows;
  }

  async create(input: {
    actorUserId: string;
    actorRole: string;
    canonicalName: string;
    slug: string;
    dishType?: string;
    primaryProductId?: string | null;
  }) {
    this.assertAdmin(input.actorRole);
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO "RecipeFamily" ("canonicalName", slug, "dishType", "primaryProductId", status)
       VALUES ($1,$2,$3,$4,'ACTIVE')
       RETURNING id`,
      [
        input.canonicalName.trim(),
        input.slug.trim().toLowerCase(),
        input.dishType ?? 'UNCLASSIFIED',
        input.primaryProductId ?? null,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('RECIPE_FAMILY_CREATE_FAILED');
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.family.created',
      entityType: 'RecipeFamily',
      entityId: id,
      metadata: { slug: input.slug },
    });
    return this.get(id);
  }

  async patch(
    id: string,
    input: {
      actorUserId: string;
      actorRole: string;
      canonicalName?: string;
      dishType?: string;
      primaryProductId?: string | null;
      status?: 'ACTIVE' | 'ARCHIVED';
    },
  ) {
    this.assertAdmin(input.actorRole);
    await this.db.query(
      `UPDATE "RecipeFamily"
       SET
         "canonicalName" = COALESCE($2, "canonicalName"),
         "dishType" = COALESCE($3, "dishType"),
         "primaryProductId" = COALESCE($4, "primaryProductId"),
         status = COALESCE($5, status),
         "updatedAt" = now()
       WHERE id = $1`,
      [
        id,
        input.canonicalName?.trim() ?? null,
        input.dishType ?? null,
        input.primaryProductId === undefined ? null : input.primaryProductId,
        input.status ?? null,
      ],
    );
    // Fix COALESCE for primaryProductId when explicitly null — use distinct update branches.
    if (input.primaryProductId === null) {
      await this.db.query(`UPDATE "RecipeFamily" SET "primaryProductId" = NULL, "updatedAt" = now() WHERE id = $1`, [
        id,
      ]);
    }
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.family.updated',
      entityType: 'RecipeFamily',
      entityId: id,
      metadata: {},
    });
    return this.get(id);
  }

  async assignRecipe(input: {
    actorUserId: string;
    actorRole: string;
    recipeId: string;
    recipeFamilyId: string | null;
  }) {
    this.assertAdmin(input.actorRole);
    if (input.recipeFamilyId) {
      const exists = await this.db.query(`SELECT 1 FROM "RecipeFamily" WHERE id = $1`, [input.recipeFamilyId]);
      if (!exists.rows[0]) throw new Error('RECIPE_FAMILY_NOT_FOUND');
    }
    const updated = await this.db.query(
      `UPDATE "Recipe" SET "recipeFamilyId" = $2 WHERE id = $1 RETURNING id`,
      [input.recipeId, input.recipeFamilyId],
    );
    if (!updated.rows[0]) throw new Error('RECIPE_NOT_FOUND');
    await this.audit?.appendEvent({
      actorUserId: input.actorUserId,
      action: 'recipe.family.assigned',
      entityType: 'Recipe',
      entityId: input.recipeId,
      metadata: { recipeFamilyId: input.recipeFamilyId },
    });
    return { recipeId: input.recipeId, recipeFamilyId: input.recipeFamilyId };
  }

  async get(id: string) {
    const rows = await this.db.query(`SELECT * FROM "RecipeFamily" WHERE id = $1`, [id]);
    return rows.rows[0] ?? null;
  }

  private assertAdmin(role: string) {
    const normalized = String(role ?? '').toUpperCase();
    if (normalized !== 'OWNER' && normalized !== 'ADMIN') throw new Error('OWNER_ACCESS_FORBIDDEN');
  }
}
