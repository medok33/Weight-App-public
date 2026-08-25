import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { canPublish, publicationChecksum, type AuthoringIngredient, type AuthoringStep, type CookTest, type HumanReview, type RecipeNutrition } from '../domain/recipe-authoring.policy';

export type PublicationInput = { recipeKey: string; title: string; description: string; servings: number; yieldGrams: number; ingredients: AuthoringIngredient[]; steps: AuthoringStep[]; nutrition: RecipeNutrition; cost: unknown; validationPass: boolean; similarityAutoPublish?: boolean; automatedQualityPass?: boolean; editorial?: HumanReview; cookTest?: CookTest; actorId: string; provenance?: Record<string, unknown> };

@Injectable()
export class RecipePublicationService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async publish(input: PublicationInput) {
    const gate = canPublish({ editorial: input.editorial, cookTest: input.cookTest, automatedQualityPass: input.automatedQualityPass, validationPass: input.validationPass, costStatus: (input.cost as { status?: 'PASS'|'UNAVAILABLE' })?.status ?? 'UNAVAILABLE', similarityAutoPublish: input.similarityAutoPublish });
    if (!gate.ok) throw new Error(`PUBLICATION_BLOCKED:${gate.reasons.join(',')}`);
    const checksum = publicationChecksum({ recipeKey: input.recipeKey, title: input.title, servings: input.servings, yieldGrams: input.yieldGrams, ingredients: input.ingredients, steps: input.steps, nutrition: input.nutrition, cost: input.cost });
    return this.db.withTransaction(async (query) => {
      const existing = await query<{ id: string; versionNumber: number }>(`SELECT id,"versionNumber" FROM "RecipeVersion" WHERE checksum=$1 LIMIT 1`, [checksum]);
      if (existing.rows[0]) return { recipeVersionId: existing.rows[0].id, versionNumber: existing.rows[0].versionNumber, idempotent: true };
      const recipe = await query<{ id: string }>(`INSERT INTO "Recipe" (name,servings,description,"portionGrams","recipeKey", "dataClass") VALUES ($1,$2,$3,$4,$5,'TEST_ONLY') ON CONFLICT ("recipeKey") DO UPDATE SET name=EXCLUDED.name RETURNING id`, [input.title, input.servings, input.description, input.yieldGrams / input.servings, input.recipeKey]);
      if (!recipe.rows[0]) throw new Error('RECIPE_CREATE_FAILED'); const recipeId = recipe.rows[0].id;
      await query(`SELECT id FROM "Recipe" WHERE id=$1 FOR UPDATE`, [recipeId]);
      const current = await query<{ n: number }>(`SELECT COALESCE(MAX("versionNumber"),0)+1 AS n FROM "RecipeVersion" WHERE "recipeId"=$1`, [recipeId]); const versionNumber = Number(current.rows[0]?.n ?? 1);
      const version = await query<{ id: string }>(`INSERT INTO "RecipeVersion" ("recipeId","versionNumber",status,"contentSnapshotJson","ingredientsSnapshotJson","stepsSnapshotJson","nutritionSnapshotJson","costSnapshotJson","restrictionSnapshotJson","servings","servingWeightGrams","changeType","createdBy","approvedBy","approvedAt","publishedAt",checksum,provenance) VALUES ($1,$2,'PUBLISHED',$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,'{}'::jsonb,$8,$9,'SYSTEM',$10,$10,now(),now(),$11,'SYSTEM') RETURNING id`, [recipeId, versionNumber, JSON.stringify({ title: input.title, description: input.description, servings: input.servings, automatedQualityPass: input.automatedQualityPass === true, cookTestStatus: input.cookTest ? (input.cookTest.decision === 'PASS' ? 'PASSED' : 'FAILED') : 'NOT_PERFORMED', provenance: input.provenance ?? null }), JSON.stringify(input.ingredients), JSON.stringify(input.steps), JSON.stringify(input.nutrition), JSON.stringify(input.cost), input.servings, input.yieldGrams / input.servings, input.actorId, checksum]);
      if (!version.rows[0]) throw new Error('VERSION_CREATE_FAILED'); const versionId = version.rows[0].id;
      await query(`UPDATE "Recipe" SET "currentVersionId"=$1,"contentRevision"="contentRevision"+1 WHERE id=$2`, [versionId, recipeId]);
      return { recipeId, recipeVersionId: versionId, versionNumber, idempotent: false };
    });
  }
}
