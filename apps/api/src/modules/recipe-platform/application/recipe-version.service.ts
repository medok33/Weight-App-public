import { Inject, Injectable, Optional } from '@nestjs/common';
import { hasAdminAuthority } from '../../auth/domain/account-role.policy';
import { createHash } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../product-catalog/application/product-foundation.resolvers';
import {
  computeRecipeVersionChecksum,
  DETERMINISTIC_RECIPE_FAMILIES,
  macrosFromIngredientAmount,
  sumNutrition,
  type RecipeContentSnapshot,
  type RecipeIngredientSnapshot,
  type RecipeNutritionSnapshot,
  type RecipeRestrictionSnapshot,
  type RecipeStepSnapshot,
  type RecipeVersionChangeType,
} from '../domain/recipe-version.policy';
import { RecipeLifecycleService } from './recipe-lifecycle.service';
import { RecipeProductDependencyService } from './recipe-product-dependency.service';
import { RecipeFingerprintService } from './recipe-fingerprint.service';
import { RecipeMediaService } from './recipe-media.service';

type RecipeRow = {
  id: string;
  name: string;
  description: string | null;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: string | null;
  portionGrams: string | null;
  allergens: unknown;
  dietaryTags: unknown;
  equipment: unknown;
  recipeKey: string | null;
  currentVersionId: string | null;
  contentRevision: number;
};

@Injectable()
export class RecipeVersionService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(ProductNutritionResolver) private readonly nutrition?: ProductNutritionResolver,
    @Optional() @Inject(ProductRestrictionResolver) private readonly restrictions?: ProductRestrictionResolver,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(RecipeLifecycleService) private readonly lifecycle?: RecipeLifecycleService,
    @Optional()
    @Inject(RecipeProductDependencyService)
    private readonly dependencies?: RecipeProductDependencyService,
    @Optional() @Inject(RecipeFingerprintService) private readonly fingerprints?: RecipeFingerprintService,
    @Optional() @Inject(RecipeMediaService) private readonly media?: RecipeMediaService,
  ) {}

  async listRecipes(limit = 200) {
    const rows = await this.db.query(
      `SELECT r.id, r.name, r."recipeKey", r."recipeFamilyId", r."currentVersionId",
              v."versionNumber" AS "currentVersionNumber", v.status AS "currentVersionStatus",
              v."publishedAt" AS "currentPublishedAt", f."canonicalName" AS "familyName"
       FROM "Recipe" r
       LEFT JOIN "RecipeVersion" v ON v.id = r."currentVersionId"
       LEFT JOIN "RecipeFamily" f ON f.id = r."recipeFamilyId"
       ORDER BY r.name ASC
       LIMIT $1`,
      [limit],
    );
    return rows.rows;
  }

  async listVersions(recipeId: string) {
    const rows = await this.db.query<{
      id: string;
      versionNumber: number;
      status: string;
      changeType: string;
      changeReason: string | null;
      createdAt: Date;
      publishedAt: Date | null;
      checksum: string;
      lifecycleStatus: string | null;
      validationStatus: string | null;
      isCurrent: boolean;
    }>(
      `SELECT v.id, v."versionNumber", v.status, v."changeType", v."changeReason",
              v."createdAt", v."publishedAt", v.checksum,
              l."lifecycleStatus", l."validationStatus",
              (r."currentVersionId" = v.id) AS "isCurrent"
       FROM "RecipeVersion" v
       JOIN "Recipe" r ON r.id = v."recipeId"
       LEFT JOIN "RecipeVersionLifecycle" l ON l."recipeVersionId" = v.id
       WHERE v."recipeId" = $1
       ORDER BY v."versionNumber" ASC`,
      [recipeId],
    );
    return rows.rows;
  }

  async getVersion(recipeId: string, versionId: string) {
    const rows = await this.db.query(
      `SELECT *
       FROM "RecipeVersion"
       WHERE id = $1 AND "recipeId" = $2
       LIMIT 1`,
      [versionId, recipeId],
    );
    return rows.rows[0] ?? null;
  }

  /** Clone mutable Recipe shell + ingredients/steps for duplicate-review workflows (no auto-publish). */
  async cloneRecipeShell(input: {
    sourceRecipeId: string;
    name: string;
    actorUserId: string;
    actorRole: string;
  }) {
    const role = String(input.actorRole ?? '').toUpperCase();
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
    if (!String(input.name ?? '').trim()) throw new Error('RECIPE_NAME_REQUIRED');
    return this.db.withTransaction(async (query) => {
      const source = await query<{
        id: string;
        servings: number;
        description: string | null;
        prepMinutes: number | null;
        cookMinutes: number | null;
        difficulty: string | null;
        portionGrams: string | null;
        allergens: unknown;
        dietaryTags: unknown;
        equipment: unknown;
        recipeFamilyId: string | null;
      }>(`SELECT * FROM "Recipe" WHERE id = $1 FOR SHARE`, [input.sourceRecipeId]);
      if (!source.rows[0]) throw new Error('RECIPE_NOT_FOUND');
      const src = source.rows[0];
      const key = `clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created = await query<{ id: string }>(
        `INSERT INTO "Recipe" (
           name, servings, description, "prepMinutes", "cookMinutes", difficulty,
           "portionGrams", allergens, "dietaryTags", equipment, "recipeKey", "recipeFamilyId", "dataClass"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,'TEST_ONLY')
         RETURNING id`,
        [
          input.name.trim(),
          src.servings,
          src.description,
          src.prepMinutes,
          src.cookMinutes,
          src.difficulty,
          src.portionGrams,
          typeof src.allergens === 'string' ? src.allergens : JSON.stringify(src.allergens ?? []),
          typeof src.dietaryTags === 'string' ? src.dietaryTags : JSON.stringify(src.dietaryTags ?? []),
          typeof src.equipment === 'string' ? src.equipment : JSON.stringify(src.equipment ?? []),
          key,
          src.recipeFamilyId,
        ],
      );
      const recipeId = created.rows[0]!.id;
      await query(
        `INSERT INTO "RecipeIngredient" ("recipeId", "productId", quantity, unit)
         SELECT $1, "productId", quantity, unit FROM "RecipeIngredient" WHERE "recipeId" = $2`,
        [recipeId, input.sourceRecipeId],
      );
      await query(
        `INSERT INTO "RecipeStep" ("recipeId", "stepIndex", instruction, "durationMinutes", "temperatureC", equipment)
         SELECT $1, "stepIndex", instruction, "durationMinutes", "temperatureC", equipment
         FROM "RecipeStep" WHERE "recipeId" = $2`,
        [recipeId, input.sourceRecipeId],
      );
      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.cloned_shell',
        entityType: 'Recipe',
        entityId: recipeId,
        metadata: { sourceRecipeId: input.sourceRecipeId },
      });
      return { id: recipeId, name: input.name.trim(), sourceRecipeId: input.sourceRecipeId };
    });
  }

  async resolveUsableVersionId(recipeId: string, query?: SqlQuery): Promise<string | null> {
    if (this.lifecycle) {
      return this.lifecycle.resolveUsableVersionId(recipeId, query);
    }
    // Legacy fallback only when lifecycle service is unavailable (tests without module wiring).
    const q = query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    const current = await q<{ currentVersionId: string | null }>(
      `SELECT "currentVersionId" FROM "Recipe" WHERE id = $1 LIMIT 1`,
      [recipeId],
    );
    return current.rows[0]?.currentVersionId ?? null;
  }

  async createVersion(input: {
    recipeId: string;
    actorUserId: string;
    actorRole: string;
    changeReason?: string;
    changeType?: RecipeVersionChangeType;
    publish?: boolean;
  }) {
    const role = String(input.actorRole ?? '').toUpperCase();
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');

    const created = await this.db.withTransaction(async (query) => {
      await query('SELECT pg_advisory_xact_lock($1)', [
        Number.parseInt(createHash('sha256').update(input.recipeId).digest('hex').slice(0, 8), 16),
      ]);

      const locked = await query<{ contentRevision: number }>(
        `SELECT "contentRevision" FROM "Recipe" WHERE id = $1 FOR UPDATE`,
        [input.recipeId],
      );
      if (!locked.rows[0]) throw new Error('RECIPE_NOT_FOUND');

      const snapshots = await this.buildSnapshotsFromMutableRecipe(input.recipeId, query);
      const nextNumber = await query<{ n: number }>(
        `SELECT COALESCE(MAX("versionNumber"), 0) + 1 AS n
         FROM "RecipeVersion" WHERE "recipeId" = $1`,
        [input.recipeId],
      );
      const versionNumber = Number(nextNumber.rows[0]?.n ?? 1);
      // Snapshot content is always locked. Operational publish goes through publishVersion gates.
      const lockSnapshot = true;
      const changeType = input.changeType ?? 'MANUAL_PUBLISH';
      const provenance = role === 'OWNER' ? 'OWNER_PUBLISH' : 'ADMIN_PUBLISH';
      const checksum = computeRecipeVersionChecksum(snapshots);

      const parent = await query<{ id: string }>(
        `SELECT id FROM "RecipeVersion" WHERE "recipeId" = $1 ORDER BY "versionNumber" DESC LIMIT 1`,
        [input.recipeId],
      );

      const inserted = await query<{ id: string; versionNumber: number }>(
        `INSERT INTO "RecipeVersion" (
           "recipeId", "versionNumber", status,
           "contentSnapshotJson", "ingredientsSnapshotJson", "stepsSnapshotJson",
           "nutritionSnapshotJson", "costSnapshotJson", "restrictionSnapshotJson",
           servings, "servingWeightGrams", "changeType", "changeReason",
           "createdBy", "approvedBy", "approvedAt", "publishedAt",
           checksum, "parentVersionId", provenance
         ) VALUES (
           $1,$2,$3,
           $4::jsonb,$5::jsonb,$6::jsonb,
           $7::jsonb,NULL,$8::jsonb,
           $9,$10,$11,$12,
           $13,$14,$15,$16,
           $17,$18,$19
         )
         RETURNING id, "versionNumber"`,
        [
          input.recipeId,
          versionNumber,
          lockSnapshot ? 'PUBLISHED' : 'DRAFT',
          JSON.stringify(snapshots.content),
          JSON.stringify(snapshots.ingredients),
          JSON.stringify(snapshots.steps),
          JSON.stringify(snapshots.nutrition),
          JSON.stringify(snapshots.restrictions),
          snapshots.servings,
          snapshots.servingWeightGrams,
          changeType,
          input.changeReason ?? null,
          input.actorUserId,
          null,
          null,
          lockSnapshot ? new Date() : null,
          checksum,
          parent.rows[0]?.id ?? null,
          provenance,
        ],
      );

      const version = inserted.rows[0];
      if (!version) throw new Error('RECIPE_VERSION_CREATE_FAILED');

      // Always IN_REVIEW on create; publishVersion applies duplicate/media gates then publishes.
      await query(
        `INSERT INTO "RecipeVersionLifecycle" (
           "recipeVersionId", "lifecycleStatus", "validationStatus", "revision",
           "changedAt", "changedBy", "reasonCode"
         ) VALUES ($1,'IN_REVIEW','VALID',1,now(),$2,'SUBMIT')
         ON CONFLICT ("recipeVersionId") DO NOTHING`,
        [version.id, input.actorUserId],
      );
      await query(
        `INSERT INTO "RecipeVersionLifecycleEvent" (
           "recipeVersionId", "fromStatus", "toStatus", "validationFrom", "validationTo",
           "actorId", "reasonCode"
         ) VALUES ($1,NULL,'IN_REVIEW',NULL,'VALID',$2,'SUBMIT')`,
        [version.id, input.actorUserId],
      );

      const nutritionPins = new Map<
        string,
        {
          productNutritionVersionId: string | null;
          calories: number;
          proteinG: number;
          fatG: number;
          carbsG: number;
        }
      >();
      const pinRows = await query<{
        productId: string;
        nutritionVersionId: string | null;
        calories: string;
        protein: string;
        fat: string;
        carbohydrate: string;
      }>(
        `SELECT p.id AS "productId", p."currentNutritionVersionId" AS "nutritionVersionId",
                COALESCE(v.calories, p."caloriesPer100g", 0)::text AS calories,
                COALESCE(v.protein, p."proteinPer100g", 0)::text AS protein,
                COALESCE(v.fat, p."fatPer100g", 0)::text AS fat,
                COALESCE(v.carbohydrate, p."carbsPer100g", 0)::text AS carbohydrate
         FROM "Product" p
         LEFT JOIN "ProductNutritionVersion" v ON v.id = p."currentNutritionVersionId"
         WHERE p.id = ANY($1::uuid[])`,
        [snapshots.ingredients.map((i) => i.productId)],
      );
      for (const row of pinRows.rows) {
        const ing = snapshots.ingredients.find((i) => i.productId === row.productId);
        const part = macrosFromIngredientAmount({
          caloriesPer100g: Number(row.calories),
          proteinPer100g: Number(row.protein),
          fatPer100g: Number(row.fat),
          carbsPer100g: Number(row.carbohydrate),
          amount: Number(ing?.amount ?? 0),
          unit: ing?.unit ?? 'g',
        });
        nutritionPins.set(row.productId, {
          productNutritionVersionId: row.nutritionVersionId,
          calories: part.calories,
          proteinG: part.proteinG,
          fatG: part.fatG,
          carbsG: part.carbsG,
        });
      }
      if (this.dependencies) {
        await this.dependencies.createFromSnapshot(
          {
            recipeVersionId: version.id,
            ingredients: snapshots.ingredients,
            nutritionByProductId: nutritionPins,
          },
          query,
        );
      }

      if (this.fingerprints) {
        await this.fingerprints.ensureFingerprint(version.id, query);
      }

      await this.audit?.appendEvent({
        actorUserId: input.actorUserId,
        action: 'recipe.version.created',
        entityType: 'RecipeVersion',
        entityId: version.id,
        metadata: {
          recipeId: input.recipeId,
          versionNumber: version.versionNumber,
          checksum,
          changeType,
          lifecycleStatus: 'IN_REVIEW',
        },
      });

      return {
        id: version.id,
        recipeId: input.recipeId,
        versionNumber: version.versionNumber,
        checksum,
        status: 'PUBLISHED',
        lifecycleStatus: 'IN_REVIEW',
        validationStatus: 'VALID',
        content: snapshots.content,
        ingredients: snapshots.ingredients,
        steps: snapshots.steps,
        nutrition: snapshots.nutrition,
      };
    });

    if (input.publish !== false) {
      return this.publishVersion({
        recipeId: input.recipeId,
        versionId: created.id,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      });
    }
    return created;
  }

  async publishVersion(input: {
    recipeId: string;
    versionId: string;
    actorUserId: string;
    actorRole: string;
    acknowledgeNearDuplicate?: boolean;
    overrideExactDuplicate?: boolean;
    overrideReason?: string;
  }) {
    if (this.fingerprints) {
      await this.fingerprints.ensureFingerprint(input.versionId);
      await this.fingerprints.scanCandidates({ limitPerVersion: 30 });
      await this.fingerprints.evaluatePublicationGate({
        recipeId: input.recipeId,
        versionId: input.versionId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        acknowledgeNearDuplicate: input.acknowledgeNearDuplicate,
        overrideExactDuplicate: input.overrideExactDuplicate,
        overrideReason: input.overrideReason,
      });
    }
    if (this.media) {
      await this.media.assertPublicationMediaGate(input.versionId);
    }
    if (this.lifecycle) {
      const life = await this.lifecycle.getLifecycle(input.versionId);
      if (!life) throw new Error('RECIPE_LIFECYCLE_NOT_FOUND');
      if (String(life.lifecycleStatus) === 'IN_REVIEW') {
        await this.lifecycle.approve({
          recipeId: input.recipeId,
          versionId: input.versionId,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
        });
      }
      return this.lifecycle.publish({
        recipeId: input.recipeId,
        versionId: input.versionId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      });
    }
    const role = String(input.actorRole ?? '').toUpperCase();
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
    await this.db.query(`UPDATE "Recipe" SET "currentVersionId" = $2 WHERE id = $1`, [
      input.recipeId,
      input.versionId,
    ]);
    return { id: input.versionId };
  }

  async ensureDeterministicFamilies(actorUserId?: string | null) {
    const report = {
      familiesCreated: 0,
      familiesExisting: 0,
      recipesAssigned: 0,
      recipesUnassigned: 0,
      ambiguousSkipped: 0,
    };

    for (const family of DETERMINISTIC_RECIPE_FAMILIES) {
      let primaryProductId: string | null = null;
      const product = await this.db.query<{ id: string }>(
        `SELECT id FROM "Product" WHERE "productKey" = $1 AND status <> 'MERGED' LIMIT 1`,
        [family.primaryProductKey],
      );
      primaryProductId = product.rows[0]?.id ?? null;

      const existing = await this.db.query<{ id: string }>(
        `SELECT id FROM "RecipeFamily" WHERE slug = $1 LIMIT 1`,
        [family.slug],
      );
      let familyId = existing.rows[0]?.id;
      if (!familyId) {
        const inserted = await this.db.query<{ id: string }>(
          `INSERT INTO "RecipeFamily" ("canonicalName", slug, "dishType", "primaryProductId", status)
           VALUES ($1,$2,$3,$4,'ACTIVE')
           RETURNING id`,
          [family.canonicalName, family.slug, family.dishType, primaryProductId],
        );
        familyId = inserted.rows[0]?.id;
        report.familiesCreated += 1;
        if (familyId && actorUserId) {
          await this.audit?.appendEvent({
            actorUserId,
            action: 'recipe.family.created',
            entityType: 'RecipeFamily',
            entityId: familyId,
            metadata: { slug: family.slug },
          });
        }
      } else {
        report.familiesExisting += 1;
      }
      if (!familyId) continue;

      for (const recipeKey of family.recipeKeys) {
        const updated = await this.db.query(
          `UPDATE "Recipe"
           SET "recipeFamilyId" = $2
           WHERE "recipeKey" = $1
             AND ("recipeFamilyId" IS NULL OR "recipeFamilyId" = $2)
           RETURNING id`,
          [recipeKey, familyId],
        );
        report.recipesAssigned += updated.rowCount ?? 0;
        if (updated.rows[0] && actorUserId) {
          await this.audit?.appendEvent({
            actorUserId,
            action: 'recipe.family.assigned',
            entityType: 'Recipe',
            entityId: updated.rows[0].id as string,
            metadata: { recipeFamilyId: familyId, recipeKey },
          });
        }
      }
    }

    const unassigned = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "Recipe" WHERE "recipeFamilyId" IS NULL`,
    );
    report.recipesUnassigned = Number(unassigned.rows[0]?.c ?? 0);
    return report;
  }

  async buildBackfillReport() {
    const totals = await this.db.query<{
      recipes: string;
      versions: string;
      withoutIngredients: string;
      withoutSteps: string;
      families: string;
      familyAssigned: string;
      familyUnassigned: string;
      mealItems: string;
      mealPinned: string;
      mealUnresolved: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "Recipe") AS recipes,
         (SELECT COUNT(*)::text FROM "RecipeVersion") AS versions,
         (SELECT COUNT(*)::text FROM "Recipe" r
           WHERE NOT EXISTS (SELECT 1 FROM "RecipeIngredient" ri WHERE ri."recipeId" = r.id)) AS "withoutIngredients",
         (SELECT COUNT(*)::text FROM "Recipe" r
           WHERE NOT EXISTS (SELECT 1 FROM "RecipeStep" rs WHERE rs."recipeId" = r.id)) AS "withoutSteps",
         (SELECT COUNT(*)::text FROM "RecipeFamily") AS families,
         (SELECT COUNT(*)::text FROM "Recipe" WHERE "recipeFamilyId" IS NOT NULL) AS "familyAssigned",
         (SELECT COUNT(*)::text FROM "Recipe" WHERE "recipeFamilyId" IS NULL) AS "familyUnassigned",
         (SELECT COUNT(*)::text FROM "MealItem" WHERE "recipeId" IS NOT NULL) AS "mealItems",
         (SELECT COUNT(*)::text FROM "MealItem" WHERE "recipeVersionId" IS NOT NULL) AS "mealPinned",
         (SELECT COUNT(*)::text FROM "MealItem"
           WHERE "recipeId" IS NOT NULL AND "recipeVersionId" IS NULL) AS "mealUnresolved"`,
    );
    return totals.rows[0];
  }

  private async buildSnapshotsFromMutableRecipe(recipeId: string, query: SqlQuery) {
    const recipeResult = await query<RecipeRow>(
      `SELECT id, name, description, servings, "prepMinutes", "cookMinutes", difficulty,
              "portionGrams"::text AS "portionGrams", allergens, "dietaryTags", equipment,
              "recipeKey", "currentVersionId", "contentRevision"
       FROM "Recipe" WHERE id = $1`,
      [recipeId],
    );
    const recipe = recipeResult.rows[0];
    if (!recipe) throw new Error('RECIPE_NOT_FOUND');

    const ingredients = await query<{
      id: string;
      productId: string;
      quantity: string;
      unit: string;
      displayName: string | null;
    }>(
      `SELECT ri.id, ri."productId", ri.quantity::text AS quantity, ri.unit,
              COALESCE(p."canonicalName", p.name) AS "displayName"
       FROM "RecipeIngredient" ri
       LEFT JOIN "Product" p ON p.id = ri."productId"
       WHERE ri."recipeId" = $1
       ORDER BY ri.id`,
      [recipeId],
    );
    if (!ingredients.rows.length) throw new Error('RECIPE_VERSION_NO_INGREDIENTS');

    const steps = await query<{
      stepIndex: number;
      instruction: string;
      durationMinutes: number | null;
      temperatureC: number | null;
      equipment: string | null;
    }>(
      `SELECT "stepIndex", instruction, "durationMinutes", "temperatureC", equipment
       FROM "RecipeStep"
       WHERE "recipeId" = $1
       ORDER BY "stepIndex"`,
      [recipeId],
    );

    const productIds = ingredients.rows.map((row) => row.productId);
    const nutritionMap = this.nutrition
      ? await this.nutrition.resolveForProducts(productIds)
      : new Map();
    const restrictionMap = this.restrictions
      ? await this.restrictions.resolveForProducts(productIds)
      : new Map();

    const ingredientSnapshots: RecipeIngredientSnapshot[] = [];
    const nutritionParts: RecipeNutritionSnapshot[] = [];
    for (const [index, row] of ingredients.rows.entries()) {
      const amount = Number(row.quantity);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('RECIPE_VERSION_INVALID_UNIT_OR_AMOUNT');
      if (!row.unit || !String(row.unit).trim()) throw new Error('RECIPE_VERSION_INVALID_UNIT_OR_AMOUNT');
      ingredientSnapshots.push({
        productId: row.productId,
        canonicalProductId: row.productId,
        displayName: row.displayName ?? row.productId,
        amount,
        unit: row.unit,
        ordering: index + 1,
      });
      const macros = nutritionMap.get(row.productId);
      nutritionParts.push(
        macrosFromIngredientAmount({
          caloriesPer100g: Number(macros?.calories ?? 0),
          proteinPer100g: Number(macros?.protein ?? 0),
          fatPer100g: Number(macros?.fat ?? 0),
          carbsPer100g: Number(macros?.carbohydrate ?? 0),
          amount,
          unit: row.unit,
        }),
      );
    }

    const allergenSet = new Set(asStringArray(recipe.allergens));
    const tagSet = new Set(asStringArray(recipe.dietaryTags));
    for (const rest of restrictionMap.values()) {
      for (const code of rest.allergenLegacyCodes ?? []) allergenSet.add(code);
      for (const tag of rest.dietaryTagCodes ?? []) tagSet.add(tag);
    }

    const content: RecipeContentSnapshot = {
      title: recipe.name,
      description: recipe.description,
      servings: recipe.servings,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      difficulty: recipe.difficulty,
      portionGrams: recipe.portionGrams != null ? Number(recipe.portionGrams) : null,
      equipment: asStringArray(recipe.equipment),
      recipeKey: recipe.recipeKey,
      allergens: [...allergenSet],
      dietaryTags: [...tagSet],
    };
    const stepSnapshots: RecipeStepSnapshot[] = steps.rows.map((step) => ({
      stepIndex: step.stepIndex,
      instruction: step.instruction,
      durationMinutes: step.durationMinutes,
      temperatureC: step.temperatureC,
      equipment: step.equipment,
    }));
    const nutrition = sumNutrition(nutritionParts);
    const restrictions: RecipeRestrictionSnapshot = {
      allergens: [...allergenSet],
      dietaryTags: [...tagSet],
    };

    if (!recipe.servings || recipe.servings < 1) throw new Error('RECIPE_VERSION_INVALID_SERVINGS');

    return {
      content,
      ingredients: ingredientSnapshots,
      steps: stepSnapshots,
      nutrition,
      restrictions,
      servings: recipe.servings,
      servingWeightGrams: content.portionGrams,
    };
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
