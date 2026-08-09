import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { MealCompletionRecord } from '../domain/meal-tracking.types';

@Injectable()
export class MealTrackingRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async upsertCompletion(input: {
    userId: string;
    mealId: string;
    planId: string;
    dayIndex: number;
    calories: number;
    proteinG: number;
    localDate: string;
  }): Promise<MealCompletionRecord> {
    const result = await this.db.query<MealCompletionRecord>(
      `INSERT INTO "MealCompletion" ("userId", "mealId", "planId", "dayIndex", calories, "proteinG", "localDate")
       VALUES ($1, $2, $3, $4, $5, $6, $7::date)
       ON CONFLICT ("userId", "mealId", "localDate") DO UPDATE SET
         calories = EXCLUDED.calories,
         "proteinG" = EXCLUDED."proteinG",
         "completedAt" = now()
       RETURNING id, "userId", "mealId", "planId", "dayIndex",
         calories::float8 AS calories, "proteinG"::float8 AS "proteinG",
         "localDate"::text AS "localDate", "completedAt"::text AS "completedAt"`,
      [input.userId, input.mealId, input.planId, input.dayIndex, input.calories, input.proteinG, input.localDate],
    );
    const row = result.rows[0];
    if (!row) throw new Error('MEAL_COMPLETION_SAVE_FAILED');
    return row;
  }

  async removeCompletion(userId: string, mealId: string, localDate: string): Promise<void> {
    await this.db.query(
      'DELETE FROM "MealCompletion" WHERE "userId" = $1 AND "mealId" = $2 AND "localDate" = $3::date',
      [userId, mealId, localDate],
    );
  }

  async findCompletedMealIds(userId: string, localDate: string): Promise<Set<string>> {
    const result = await this.db.query<{ mealId: string }>(
      'SELECT "mealId" FROM "MealCompletion" WHERE "userId" = $1 AND "localDate" = $2::date',
      [userId, localDate],
    );
    return new Set(result.rows.map((row) => row.mealId));
  }

  async sumForDate(userId: string, localDate: string): Promise<{ calories: number; proteinG: number }> {
    const result = await this.db.query<{ calories: string; proteinG: string }>(
      `SELECT COALESCE(SUM(calories), 0)::text AS calories, COALESCE(SUM("proteinG"), 0)::text AS "proteinG"
       FROM "MealCompletion" WHERE "userId" = $1 AND "localDate" = $2::date`,
      [userId, localDate],
    );
    return {
      calories: Number(result.rows[0]?.calories ?? 0),
      proteinG: Number(result.rows[0]?.proteinG ?? 0),
    };
  }
}
