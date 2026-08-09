import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { Auth01bService } from '../../src/modules/auth/application/auth-01b.service';
import { AuthRepository } from '../../src/modules/auth/infrastructure/auth.repository';

describe('AUTH-01B deletion retention migration semantics', () => {
  let db: PrismaService;
  let service: Auth01bService;

  beforeAll(() => {
    db = new PrismaService();
    service = new Auth01bService(db, new AuthRepository(db));
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it('retained global and financial records survive actor deletion with user identity detached', async () => {
    const actorId = randomUUID();
    const paymentId = randomUUID();
    const refundId = randomUUID();
    const inviteId = randomUUID();

    await db.query(`INSERT INTO "User" (id, email, "accountRole", status) VALUES ($1,'actor-delete@example.test','USER','ACTIVE')`, [actorId]);
    await db.query(`INSERT INTO "AIControl" (id, enabled, "updatedBy") VALUES (1,true,$1)`, [actorId]);
    await db.query(`INSERT INTO "FeatureFlag" (key, enabled, "updatedBy") VALUES ('auth01b.test',true,$1)`, [actorId]);
    await db.query(
      `INSERT INTO "BetaInvite" (id, "emailNormalized", "tokenHash", "expiresAt", "createdByUserId")
       VALUES ($1,'invite-target@example.test',$2,CURRENT_TIMESTAMP + interval '1 day',$3)`,
      [inviteId, `token-${inviteId}`, actorId],
    );
    await db.query(
      `INSERT INTO "Payment" (id, "userId", provider, "providerPaymentId", status, "amountMinor", currency, metadata)
       VALUES ($1,$2,'mock',$3,'succeeded',1234,'USD','{}'::jsonb)`,
      [paymentId, actorId, `pay-${paymentId}`],
    );
    await db.query(
      `INSERT INTO "Refund" (id, "paymentId", "amountMinor", currency, status, "requestedByUserId", metadata)
       VALUES ($1,$2,234,'USD','succeeded',$3,'{}'::jsonb)`,
      [refundId, paymentId, actorId],
    );

    await db.query(`DELETE FROM "User" WHERE id=$1`, [actorId]);

    expect(await expectScalar(`SELECT COUNT(*) FROM "AIControl" WHERE id=1 AND "updatedBy" IS NULL`)).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "FeatureFlag" WHERE key='auth01b.test' AND "updatedBy" IS NULL`)).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "BetaInvite" WHERE id=$1 AND "createdByUserId" IS NULL`, [inviteId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "Payment" WHERE id=$1 AND "userId" IS NULL AND "amountMinor"=1234`, [paymentId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "Refund" WHERE id=$1 AND "paymentId"=$2`, [refundId, paymentId])).toBe(1);
  });

  it('account deletion revokes entitlements, anonymizes invite targets, preserves multi-member family, and removes last-member family', async () => {
    const userId = randomUUID();
    const otherId = randomUUID();
    const multiFamilyId = randomUUID();
    const lastFamilyId = randomUUID();
    const sharedDishId = randomUUID();
    const otherPortionId = randomUUID();
    const ownPortionId = randomUUID();
    const shoppingListId = randomUUID();
    const itemId = randomUUID();
    const privateShoppingListId = randomUUID();
    const paymentId = randomUUID();
    const entitlementId = randomUUID();
    const inviteId = randomUUID();

    await db.query(`INSERT INTO "User" (id, email, username, "accountRole", status) VALUES ($1,'delete-me@example.test','deleteme','USER','ACTIVE'),($2,'other@example.test','other','USER','ACTIVE')`, [userId, otherId]);
    await db.query(`INSERT INTO "ShoppingList" (id, "userId") VALUES ($1,$2)`, [privateShoppingListId, userId]);
    await db.query(
      `INSERT INTO "BetaInvite" (id, "emailNormalized", "tokenHash", "expiresAt", "createdByUserId")
       VALUES ($1,'delete-me@example.test',$2,CURRENT_TIMESTAMP + interval '1 day',$3)`,
      [inviteId, `target-${inviteId}`, otherId],
    );
    await db.query(
      `INSERT INTO "Payment" (id, "userId", provider, "providerPaymentId", status, "amountMinor", currency, metadata)
       VALUES ($1,$2,'mock',$3,'succeeded',5000,'USD','{}'::jsonb)`,
      [paymentId, userId, `pay-${paymentId}`],
    );
    await db.query(
      `INSERT INTO "Entitlement" (id, "userId", key, status, "sourcePaymentId", metadata)
       VALUES ($1,$2,'premium','active',$3,'{}'::jsonb)`,
      [entitlementId, userId, paymentId],
    );
    await db.query(`INSERT INTO "Family" (id, "ownerUserId", name) VALUES ($1,$2,'Multi'),($3,$2,'Last')`, [multiFamilyId, userId, lastFamilyId]);
    await db.query(
      `INSERT INTO "FamilyMember" ("familyId", "userId", role, status)
       VALUES ($1,$2,'OWNER','ACTIVE'),($1,$3,'MEMBER','ACTIVE'),($4,$2,'OWNER','ACTIVE')`,
      [multiFamilyId, userId, otherId, lastFamilyId],
    );
    await db.query(`INSERT INTO "SharedDish" (id, "familyId", "recipeKey", "createdByUserId") VALUES ($1,$2,'recipe:test',$3)`, [sharedDishId, multiFamilyId, userId]);
    await db.query(
      `INSERT INTO "SharedDishPortion" (id, "sharedDishId", "userId", servings, "calories", "proteinG", "fatG", "carbsG")
       VALUES ($1,$3,$4,1,100,10,3,8),($2,$3,$5,1,100,10,3,8)`,
      [ownPortionId, otherPortionId, sharedDishId, userId, otherId],
    );
    await db.query(`INSERT INTO "FamilyShoppingList" (id, "familyId", "regeneratedByUserId") VALUES ($1,$2,$3)`, [shoppingListId, multiFamilyId, userId]);
    await db.query(`INSERT INTO "FamilyShoppingItem" (id, "listId", "productKey", name, unit, quantity) VALUES ($1,$2,'p','Milk','l',1)`, [itemId, shoppingListId]);

    const deleted = await service.deleteAccount(
      { id: userId, email: 'delete-me@example.test', username: 'deleteme', role: 'USER', recentOwnerReauthAt: new Date() },
      'DELETE MY ACCOUNT',
    );

    expect(deleted.ok).toBe(true);
    expect(await expectScalar(`SELECT COUNT(*) FROM "User" WHERE id=$1 AND email IS NULL AND username IS NULL AND status='DELETED'`, [userId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "AuthIdentity" WHERE "userId"=$1`, [userId])).toBe(0);
    expect(await expectScalar(`SELECT COUNT(*) FROM "ShoppingList" WHERE id=$1`, [privateShoppingListId])).toBe(0);
    expect(await expectScalar(`SELECT COUNT(*) FROM "Payment" WHERE id=$1 AND "userId" IS NULL AND "amountMinor"=5000`, [paymentId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "Entitlement" WHERE id=$1 AND "userId" IS NULL AND status='revoked' AND "endsAt" IS NOT NULL`, [entitlementId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "BetaInvite" WHERE id=$1 AND "revokedAt" IS NOT NULL AND "emailNormalized" <> 'delete-me@example.test'`, [inviteId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "Family" WHERE id=$1 AND "ownerUserId"=$2`, [multiFamilyId, otherId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "FamilyMember" WHERE "familyId"=$1 AND "userId"=$2`, [multiFamilyId, userId])).toBe(0);
    expect(await expectScalar(`SELECT COUNT(*) FROM "FamilyMember" WHERE "familyId"=$1 AND "userId"=$2`, [multiFamilyId, otherId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "SharedDish" WHERE id=$1 AND "createdByUserId" IS NULL`, [sharedDishId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "SharedDishPortion" WHERE id=$1`, [ownPortionId])).toBe(0);
    expect(await expectScalar(`SELECT COUNT(*) FROM "SharedDishPortion" WHERE id=$1`, [otherPortionId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "FamilyShoppingList" WHERE id=$1 AND "regeneratedByUserId" IS NULL`, [shoppingListId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "FamilyShoppingItem" WHERE id=$1`, [itemId])).toBe(1);
    expect(await expectScalar(`SELECT COUNT(*) FROM "Family" WHERE id=$1`, [lastFamilyId])).toBe(0);
  });

  async function expectScalar(sql: string, params: unknown[] = []) {
    const result = await db.query<{ count: string }>(sql, params);
    return Number(result.rows[0]?.count ?? 0);
  }
});
