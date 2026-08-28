import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { CookTest, HumanReview } from '../domain/recipe-authoring.policy';

@Injectable()
export class RecipeAuthoringPersistence {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async recordEditorialReview(versionId: string, review: HumanReview) {
    if (review.decision === 'PASS' && !review.reviewerId) throw new Error('HUMAN_REVIEWER_REQUIRED');
    return this.db.query(`INSERT INTO "RecipeEditorialReview" ("recipeVersionId","reviewerId","reviewedAt","decision","notes","defectsJson","correctionsJson") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING *`, [versionId, review.reviewerId, review.reviewedAt, review.decision, review.notes ?? null, JSON.stringify(review.defects ?? []), JSON.stringify(review.corrections ?? [])]);
  }
  async recordCookTest(versionId: string, test: CookTest) {
    if (test.decision === 'PASS' && !test.actuallyCooked) throw new Error('COOK_TEST_ACTUALLY_COOKED_REQUIRED');
    return this.db.query(`INSERT INTO "RecipeCookTest" ("recipeVersionId","reviewerId","testedAt","actuallyCooked","actualCookingTimeMinutes","actualYieldGrams","ingredientMeasurability","stepExecutability","equipmentSufficiency","textureResult","tasteResult","defectsJson","notes","decision") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`, [versionId, test.reviewerId, test.testedAt, test.actuallyCooked, test.actualCookingTimeMinutes, test.actualYieldGrams, test.ingredientMeasurability, test.stepExecutability, test.equipmentSufficiency, test.textureResult, test.tasteResult, JSON.stringify(test.defects ?? []), test.notes ?? null, test.decision]);
  }
  async latestGates(versionId: string) { const [editorial, cook] = await Promise.all([this.db.query(`SELECT * FROM "RecipeEditorialReview" WHERE "recipeVersionId"=$1 ORDER BY "reviewedAt" DESC LIMIT 1`, [versionId]), this.db.query(`SELECT * FROM "RecipeCookTest" WHERE "recipeVersionId"=$1 ORDER BY "testedAt" DESC LIMIT 1`, [versionId])]); return { editorial: editorial.rows[0] ?? null, cookTest: cook.rows[0] ?? null }; }
}
