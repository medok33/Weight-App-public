import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { PantryItemInput, PantryItemRecord, PantryRecord } from '../domain/pantry.types';

@Injectable()
export class PantryRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async findByUser(userId: string): Promise<PantryRecord | null> {
    const result = await this.db.query<PantryRecord>(
      `SELECT id, "userId", name, "createdAt"::text, "updatedAt"::text
       FROM "Pantry" WHERE "userId"=$1::uuid`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async createForUser(userId: string, name = 'Home'): Promise<PantryRecord> {
    const result = await this.db.query<PantryRecord>(
      `INSERT INTO "Pantry" ("userId", name)
       VALUES ($1::uuid, $2)
       ON CONFLICT ("userId") DO UPDATE SET name=EXCLUDED.name
       RETURNING id, "userId", name, "createdAt"::text, "updatedAt"::text`,
      [userId, name],
    );
    return result.rows[0];
  }

  async listItems(pantryId: string): Promise<PantryItemRecord[]> {
    const result = await this.db.query<PantryItemRecord>(
      `SELECT id, "pantryId", name, quantity::float8 AS quantity, unit,
              "expiresOn"::text AS "expiresOn", "createdAt"::text, "updatedAt"::text
       FROM "PantryItem"
       WHERE "pantryId"=$1::uuid
       ORDER BY COALESCE("expiresOn", '9999-12-31'::date) ASC, name ASC`,
      [pantryId],
    );
    return result.rows.map((row) => ({
      ...row,
      expiresOn: row.expiresOn ? String(row.expiresOn).slice(0, 10) : null,
    }));
  }

  async upsertItem(pantryId: string, input: PantryItemInput): Promise<PantryItemRecord> {
    const result = await this.db.query<PantryItemRecord>(
      `INSERT INTO "PantryItem" ("pantryId", name, quantity, unit, "expiresOn")
       VALUES ($1::uuid, $2, $3, $4, $5::date)
       ON CONFLICT ("pantryId", name, unit) DO UPDATE
         SET quantity=EXCLUDED.quantity,
             "expiresOn"=EXCLUDED."expiresOn",
             "updatedAt"=CURRENT_TIMESTAMP
       RETURNING id, "pantryId", name, quantity::float8 AS quantity, unit,
                 "expiresOn"::text AS "expiresOn", "createdAt"::text, "updatedAt"::text`,
      [pantryId, input.name, input.quantity, input.unit, input.expiresOn ?? null],
    );
    const row = result.rows[0];
    return { ...row, expiresOn: row.expiresOn ? String(row.expiresOn).slice(0, 10) : null };
  }

  async deleteItem(pantryId: string, itemId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM "PantryItem" WHERE id=$1::uuid AND "pantryId"=$2::uuid`,
      [itemId, pantryId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
