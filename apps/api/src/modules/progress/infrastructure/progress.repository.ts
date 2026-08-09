import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { ProgressEntry } from '../domain/progress.types';

type ProgressRow = { id: string; userId: string; weightKg: string; measuredAt: string };

type ProgressWeightRow = ProgressRow & { createdAt: string };

export type ProgressWeightEntry = ProgressEntry & {
  id: string;
  createdAt: string;
};

@Injectable()
export class ProgressRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async add(entry: ProgressEntry): Promise<ProgressEntry> {
    const result = await this.db.query<ProgressRow>(
      `INSERT INTO "ProgressEntry" ("userId", "weightKg", "measuredAt")
       VALUES ($1, $2, $3::timestamptz)
       RETURNING id, "userId", "weightKg"::text AS "weightKg", "measuredAt"::text AS "measuredAt"`,
      [entry.userId, entry.weightKg, entry.measuredAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error('PROGRESS_SAVE_FAILED');
    return { id: row.id, userId: row.userId, weightKg: Number(row.weightKg), measuredAt: row.measuredAt };
  }

  async listByUser(userId: string, limit = 60): Promise<ProgressEntry[]> {
    const result = await this.db.query<ProgressRow>(
      `SELECT id, "userId", "weightKg"::text AS "weightKg", "measuredAt"::text AS "measuredAt"
       FROM "ProgressEntry"
       WHERE "userId" = $1
       ORDER BY "measuredAt" ASC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      weightKg: Number(row.weightKg),
      measuredAt: row.measuredAt,
    }));
  }

  /**
   * Weight candidates for workout-energy resolution (asOf inclusive).
   * Ordered oldest→newest by measuredAt, createdAt, id for deterministic tie-break.
   */
  async listWeightEntriesAsOf(userId: string, asOf: Date): Promise<ProgressWeightEntry[]> {
    const result = await this.db.query<ProgressWeightRow>(
      `SELECT id, "userId", "weightKg"::text AS "weightKg",
              "measuredAt"::text AS "measuredAt", "createdAt"::text AS "createdAt"
       FROM "ProgressEntry"
       WHERE "userId" = $1
         AND "measuredAt" <= $2::timestamptz
       ORDER BY "measuredAt" ASC, "createdAt" ASC, id ASC`,
      [userId, asOf.toISOString()],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      weightKg: Number(row.weightKg),
      measuredAt: row.measuredAt,
      createdAt: row.createdAt,
    }));
  }
}
