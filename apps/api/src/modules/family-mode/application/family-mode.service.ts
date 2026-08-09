import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import {
  assertActiveMember,
  assertCanLeave,
  assertOwnerRole,
  assertPendingInviteCapacity,
  invitationGenericError,
  validateFamilyName,
} from '../domain/family-mode.policy';
import {
  allocateIndividualPortions,
  buildFamilyShoppingList,
  type SharedDishInput,
} from '../domain/family-meals.policy';
import { FamilyModeRepository } from '../infrastructure/family-mode.repository';

@Injectable()
export class FamilyModeService {
  constructor(
    @Inject(FamilyModeRepository) private readonly repository: FamilyModeRepository,
    @Inject(AuditSecurityService) private readonly audit: AuditSecurityService,
  ) {}

  async createFamily(userId: string, name: string) {
    const trimmed = validateFamilyName(name);
    if (await this.repository.myFamily(userId)) throw new Error('FAMILY_ALREADY_EXISTS');
    return this.repository.create(userId, trimmed);
  }

  getMyFamily(userId: string) {
    return this.repository.myFamily(userId);
  }

  async listMembers(userId: string, familyId: string) {
    await this.assertFamilyAccess(userId, familyId);
    return this.repository.members(familyId);
  }

  async invite(userId: string, familyId: string, emailOrUsername?: string) {
    await this.assertOwner(userId, familyId);
    assertPendingInviteCapacity(Number((await this.repository.pendingCount(familyId)).count));
    const token = randomBytes(32).toString('base64url');
    const invitation = await this.repository.createInvitation(
      familyId,
      userId,
      hashToken(token),
      new Date(Date.now() + 7 * 86400_000),
      emailOrUsername,
    );
    // Raw token returned once; never persisted, logged, or audited.
    return { invitation, token };
  }

  async acceptInvitation(userId: string, token: string) {
    if (!token?.trim()) throw invitationGenericError();
    const accepted = await this.repository.accept(hashToken(token), userId);
    if (!accepted) throw invitationGenericError();
    await this.audit.appendEvent({
      actorUserId: userId,
      action: 'family.invitation.accept',
      entityType: 'FamilyInvitation',
      entityId: accepted.id,
      metadata: {},
    });
    return { familyId: accepted.familyId };
  }

  async revokeInvitation(userId: string, familyId: string, invitationId: string) {
    await this.assertOwner(userId, familyId);
    if (!(await this.repository.revoke(familyId, invitationId))) throw invitationGenericError();
    await this.audit.appendEvent({
      actorUserId: userId,
      action: 'family.invitation.revoke',
      entityType: 'FamilyInvitation',
      entityId: invitationId,
      metadata: {},
    });
  }

  async removeMember(userId: string, familyId: string, memberUserId: string) {
    await this.assertOwner(userId, familyId);
    if (memberUserId === userId) throw new Error('FAMILY_OWNER_ACTION_REQUIRED');
    if (!(await this.repository.deactivate(familyId, memberUserId, 'REMOVED'))) {
      throw new Error('FAMILY_MEMBER_NOT_FOUND');
    }
  }

  async leaveFamily(userId: string, familyId: string) {
    const member = await this.assertFamilyAccess(userId, familyId);
    assertCanLeave(member);
    if (!(await this.repository.deactivate(familyId, userId, 'LEFT'))) {
      throw new Error('FAMILY_MEMBER_NOT_FOUND');
    }
  }

  async setHealthShareConsent(userId: string, familyId: string, granted: boolean) {
    const member = await this.assertFamilyAccess(userId, familyId);
    if (!(await this.repository.setHealthConsent(familyId, userId, granted))) {
      throw new Error('FAMILY_MEMBER_NOT_FOUND');
    }
    await this.audit.appendEvent({
      actorUserId: member.userId ?? userId,
      action: granted ? 'family.health_share.grant' : 'family.health_share.revoke',
      entityType: 'FamilyMember',
      entityId: familyId,
      metadata: {},
    });
  }

  async assertFamilyAccess(userId: string, familyId: string) {
    const member = await this.repository.member(familyId, userId);
    return assertActiveMember(
      member
        ? {
            id: member.id,
            familyId,
            userId,
            role: member.role as 'OWNER' | 'MEMBER',
            status: member.status as 'ACTIVE' | 'LEFT' | 'REMOVED',
            healthShareConsent: member.healthShareConsent,
          }
        : null,
    );
  }

  async planSharedDish(actorUserId: string, familyId: string, input: SharedDishInput) {
    await this.assertFamilyAccess(actorUserId, familyId);
    if (input.familyId !== familyId) throw new Error('FAMILY_SHARED_DISH_INVALID');
    const result = allocateIndividualPortions(input);
    const own = result.portions.find((portion) => portion.userId === actorUserId);
    return {
      dishName: input.name,
      ingredientQuantityMatches: result.ingredientQuantityMatches,
      portions: own ? [own] : [],
      aggregate: {
        servings: result.portions
          .filter((p): p is Extract<(typeof p), { compatible: true }> => p.compatible)
          .reduce((sum, p) => sum + p.servings, 0),
      },
      // Never expose other members' macros, weight, or restriction reasons.
    };
  }

  async regenerateFamilyShoppingList(
    actorUserId: string,
    familyId: string,
    meals: Array<{ dishName: string; servings: number; ingredients: SharedDishInput['ingredients'] }>,
    pantry: Array<{ productKey?: string; name: string; unit: string; quantity: number; expiresOn?: string | null }>,
  ) {
    await this.assertOwner(actorUserId, familyId);
    const items = buildFamilyShoppingList(meals, pantry).map((item) => ({
      productKey: item.productKey,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      forDishes: item.forDishes,
    }));
    return this.repository.replaceShoppingList(familyId, actorUserId, items);
  }

  async getFamilyShoppingList(actorUserId: string, familyId: string) {
    await this.assertFamilyAccess(actorUserId, familyId);
    return this.repository.getShoppingList(familyId);
  }

  async markFamilyShoppingPurchased(
    actorUserId: string,
    familyId: string,
    itemId: string,
    purchased: boolean,
    version: number,
  ) {
    await this.assertFamilyAccess(actorUserId, familyId);
    if (!Number.isInteger(version) || version < 1) throw new Error('FAMILY_SHOPPING_STALE');
    return this.repository.markShoppingItemPurchased(familyId, itemId, purchased, version);
  }

  private async assertOwner(userId: string, familyId: string) {
    return assertOwnerRole(await this.assertFamilyAccess(userId, familyId));
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
