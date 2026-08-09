import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type { RecipeIngredientSnapshot } from '../domain/recipe-version.policy';

@Injectable()
export class RecipeProductDependencyService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async listForVersion(recipeVersionId: string) {
    const rows = await this.db.query(
      `SELECT d.*, COALESCE(p.name, p."canonicalName") AS "productName"
       FROM "RecipeProductDependency" d
       JOIN "Product" p ON p.id = d."productId"
       WHERE d."recipeVersionId" = $1
       ORDER BY d."ingredientIndex" ASC`,
      [recipeVersionId],
    );
    return rows.rows;
  }

  /**
   * Build dependencies from immutable ingredients snapshot in the same TX as version create.
   * Pins ProductNutritionVersion when provided (new versions only).
   */
  async createFromSnapshot(
    input: {
      recipeVersionId: string;
      ingredients: RecipeIngredientSnapshot[];
      nutritionByProductId?: Map<
        string,
        {
          productNutritionVersionId: string | null;
          calories: number;
          proteinG: number;
          fatG: number;
          carbsG: number;
        }
      >;
    },
    query?: SqlQuery,
  ) {
    const run = query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    for (const [index, ing] of input.ingredients.entries()) {
      const productId = ing.canonicalProductId || ing.productId;
      if (!productId) continue;
      const nutrition = input.nutritionByProductId?.get(productId);
      const resolved =
        nutrition?.productNutritionVersionId != null ? 'RESOLVED' : 'LEGACY_UNRESOLVED';
      await run(
        `INSERT INTO "RecipeProductDependency" (
           "recipeVersionId", "productId", "productNutritionVersionId",
           "ingredientIndex", amount, unit, "dependencyRole", "resolutionStatus", source,
           "nutritionCalories", "nutritionProteinG", "nutritionFatG", "nutritionCarbsG"
         ) VALUES ($1,$2,$3,$4,$5,$6,'INGREDIENT',$7,'INGREDIENTS_SNAPSHOT',$8,$9,$10,$11)
         ON CONFLICT ("recipeVersionId", "ingredientIndex") DO NOTHING`,
        [
          input.recipeVersionId,
          productId,
          nutrition?.productNutritionVersionId ?? null,
          index,
          Number(ing.amount),
          ing.unit || 'g',
          resolved,
          nutrition?.calories ?? null,
          nutrition?.proteinG ?? null,
          nutrition?.fatG ?? null,
          nutrition?.carbsG ?? null,
        ],
      );
    }
  }

  async findVersionIdsByProduct(productId: string, query?: SqlQuery): Promise<string[]> {
    const run = query ?? ((text: string, values: unknown[] = []) => this.db.query(text, values));
    const rows = await run<{ recipeVersionId: string }>(
      `SELECT DISTINCT "recipeVersionId"
       FROM "RecipeProductDependency"
       WHERE "productId" = $1`,
      [productId],
    );
    return rows.rows.map((r) => r.recipeVersionId);
  }
}
