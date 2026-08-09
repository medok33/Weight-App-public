import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class FamilyModeRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async create(ownerUserId: string, name: string) {
    const family = await this.db.query<{ id: string; ownerUserId: string; name: string }>(
      `INSERT INTO "Family" ("ownerUserId", name) VALUES ($1::uuid,$2) RETURNING id,"ownerUserId",name`, [ownerUserId, name],
    );
    await this.db.query(`INSERT INTO "FamilyMember" ("familyId","userId",role) VALUES ($1::uuid,$2::uuid,'OWNER')`, [family.rows[0].id, ownerUserId]);
    return family.rows[0];
  }
  async myFamily(userId: string) {
    return (await this.db.query<{ id: string; ownerUserId: string; name: string }>(
      `SELECT f.id,f."ownerUserId",f.name FROM "Family" f JOIN "FamilyMember" m ON m."familyId"=f.id WHERE m."userId"=$1::uuid AND m.status='ACTIVE' ORDER BY f."createdAt" LIMIT 1`, [userId],
    )).rows[0] ?? null;
  }
  async member(familyId: string, userId: string) {
    return (await this.db.query<{ id: string; role: string; status: string; healthShareConsent: boolean }>(
      `SELECT id,role,status,"healthShareConsent" FROM "FamilyMember" WHERE "familyId"=$1::uuid AND "userId"=$2::uuid`, [familyId, userId],
    )).rows[0] ?? null;
  }
  async members(familyId: string) {
    return (await this.db.query(`SELECT id,"userId",role,status,"healthShareConsent","joinedAt","leftAt" FROM "FamilyMember" WHERE "familyId"=$1::uuid ORDER BY "joinedAt"`, [familyId])).rows;
  }
  async pendingCount(familyId: string) {
    return (await this.db.query<{ count: string }>(`SELECT count(*)::text AS count FROM "FamilyInvitation" WHERE "familyId"=$1::uuid AND status='PENDING'`, [familyId])).rows[0];
  }
  async createInvitation(familyId: string, invitedByUserId: string, tokenHash: string, expiresAt: Date, emailOrUsername?: string) {
    return (await this.db.query(
      `INSERT INTO "FamilyInvitation" ("familyId","invitedByUserId","tokenHash","expiresAt","emailOrUsername") VALUES ($1::uuid,$2::uuid,$3,$4,$5) RETURNING id,"expiresAt"`,
      [familyId, invitedByUserId, tokenHash, expiresAt, emailOrUsername ?? null],
    )).rows[0];
  }
  async accept(tokenHash: string, userId: string) {
    const invitation = await this.db.query<{ id: string; familyId: string }>(
      `UPDATE "FamilyInvitation" SET status='ACCEPTED',"acceptedByUserId"=$2::uuid,"usedAt"=CURRENT_TIMESTAMP
       WHERE "tokenHash"=$1 AND status='PENDING' AND "expiresAt">CURRENT_TIMESTAMP RETURNING id,"familyId"`, [tokenHash, userId],
    );
    if (!invitation.rows[0]) return null;
    await this.db.query(
      `INSERT INTO "FamilyMember" ("familyId","userId",role,status) VALUES ($1::uuid,$2::uuid,'MEMBER','ACTIVE')
       ON CONFLICT ("familyId","userId") DO UPDATE SET status='ACTIVE',"leftAt"=NULL`, [invitation.rows[0].familyId, userId],
    );
    return invitation.rows[0];
  }
  async revoke(familyId: string, invitationId: string) {
    return (await this.db.query(`UPDATE "FamilyInvitation" SET status='REVOKED' WHERE id=$1::uuid AND "familyId"=$2::uuid AND status='PENDING'`, [invitationId, familyId])).rowCount ?? 0;
  }
  async deactivate(familyId: string, userId: string, status: 'LEFT' | 'REMOVED') {
    return (await this.db.query(`UPDATE "FamilyMember" SET status=$3,"leftAt"=CURRENT_TIMESTAMP,"healthShareConsent"=false WHERE "familyId"=$1::uuid AND "userId"=$2::uuid AND status='ACTIVE'`, [familyId, userId, status])).rowCount ?? 0;
  }
  async setHealthConsent(familyId: string, userId: string, value: boolean) {
    return (await this.db.query(`UPDATE "FamilyMember" SET "healthShareConsent"=$3 WHERE "familyId"=$1::uuid AND "userId"=$2::uuid AND status='ACTIVE' RETURNING id`, [familyId, userId, value])).rows[0] ?? null;
  }

  async getShoppingList(familyId: string) {
    const list = (
      await this.db.query<{ id: string; familyId: string; version: number }>(
        `SELECT id,"familyId",version FROM "FamilyShoppingList" WHERE "familyId"=$1::uuid`,
        [familyId],
      )
    ).rows[0];
    if (!list) return null;
    const items = (
      await this.db.query(
        `SELECT id,"productKey",name,unit,quantity,purchased,"forDishes" FROM "FamilyShoppingItem" WHERE "listId"=$1::uuid ORDER BY name`,
        [list.id],
      )
    ).rows;
    return { ...list, items };
  }

  async replaceShoppingList(
    familyId: string,
    regeneratedByUserId: string,
    items: Array<{ productKey: string; name: string; unit: string; quantity: number; forDishes: string[] }>,
  ) {
    const existing = (
      await this.db.query<{ id: string; version: number }>(
        `SELECT id, version FROM "FamilyShoppingList" WHERE "familyId"=$1::uuid`,
        [familyId],
      )
    ).rows[0];
    let listId: string;
    if (existing) {
      const updated = (
        await this.db.query<{ id: string; version: number }>(
          `UPDATE "FamilyShoppingList"
           SET version = version + 1, "regeneratedAt"=CURRENT_TIMESTAMP, "regeneratedByUserId"=$2::uuid
           WHERE id=$1::uuid RETURNING id, version`,
          [existing.id, regeneratedByUserId],
        )
      ).rows[0];
      listId = updated.id;
      await this.db.query(`DELETE FROM "FamilyShoppingItem" WHERE "listId"=$1::uuid`, [listId]);
    } else {
      const created = (
        await this.db.query<{ id: string; version: number }>(
          `INSERT INTO "FamilyShoppingList" ("familyId","regeneratedByUserId") VALUES ($1::uuid,$2::uuid) RETURNING id, version`,
          [familyId, regeneratedByUserId],
        )
      ).rows[0];
      listId = created.id;
    }
    for (const item of items) {
      await this.db.query(
        `INSERT INTO "FamilyShoppingItem" ("listId","productKey",name,unit,quantity,"forDishes")
         VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb)`,
        [listId, item.productKey, item.name, item.unit, item.quantity, JSON.stringify(item.forDishes)],
      );
    }
    return this.getShoppingList(familyId);
  }

  async markShoppingItemPurchased(familyId: string, itemId: string, purchased: boolean, expectedVersion: number) {
    const list = (
      await this.db.query<{ id: string; version: number }>(
        `SELECT id, version FROM "FamilyShoppingList" WHERE "familyId"=$1::uuid`,
        [familyId],
      )
    ).rows[0];
    if (!list) throw new Error('FAMILY_SHOPPING_NOT_FOUND');
    if (list.version !== expectedVersion) throw new Error('FAMILY_SHOPPING_STALE');
    const updated = (
      await this.db.query(
        `UPDATE "FamilyShoppingItem" SET purchased=$3
         WHERE id=$1::uuid AND "listId"=$2::uuid RETURNING id, purchased`,
        [itemId, list.id, purchased],
      )
    ).rows[0];
    if (!updated) throw new Error('FAMILY_SHOPPING_ITEM_NOT_FOUND');
    return { listVersion: list.version, item: updated };
  }
}
