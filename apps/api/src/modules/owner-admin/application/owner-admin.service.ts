import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AuthRepository } from '../../auth/infrastructure/auth.repository';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { OwnerAdminRepository } from '../infrastructure/owner-admin.repository';
import {
  CLOSED_BETA_FLAG_KEY,
  assertClosedBetaFlagKey,
  isClosedBetaEnabled,
  maskSupportUser,
  validateCatalogProduct,
  validateFeatureFlagKey,
  validateSupportAccess,
} from '../domain/owner-admin.policy';

@Injectable()
export class OwnerAdminService {
  constructor(
    @Inject(OwnerAdminRepository) private readonly repository: OwnerAdminRepository,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
  ) {}

  async access(user: RequestUser) {
    await this.repository.recordAudit(user.id, 'owner.access.granted', { role: user.role });
    return { allowed: true, role: user.role };
  }

  async overview(user: RequestUser) {
    const access = await this.access(user);
    return { ...access, metrics: await this.repository.overviewMetrics() };
  }

  async searchUsers(user: RequestUser, rawQuery: string | undefined, requestId?: string) {
    const query = (rawQuery ?? '').trim();
    if (query.length < 2 || query.length > 100) throw new Error('OWNER_USER_QUERY_INVALID');
    const users = await this.repository.searchUsers(query);
    for (const item of users) {
      await this.authRepository.writeAuditLog({
        ownerUserId: user.id,
        targetUserId: item.id,
        action: 'owner.user.viewed',
        entityType: 'User',
        entityId: item.id,
        requestId: requestId ?? null,
      });
    }
    return {
      items: users.map((item) => ({
        id: item.id,
        email: maskSupportUser(item.email ?? ''),
        username: item.username,
        role: item.accountRole,
        createdAt: item.createdAt,
      })),
      total: users.length,
    };
  }

  async grantSupportAccess(user: RequestUser, reason: string | undefined, ttlMinutes: number | undefined) {
    const input = validateSupportAccess(reason ?? '', ttlMinutes ?? 0);
    return { granted: true, ...(await this.repository.recordSupportAccess(user.id, input.reason, input.ttlMinutes)) };
  }

  async catalog(user: RequestUser) {
    void user;
    return { items: await this.repository.listCatalog() };
  }

  async createCatalog(
    user: RequestUser,
    input: { canonicalName: string; unit: string; caloriesPer100g: number; proteinPer100g: number },
  ) {
    if (user.role !== 'OWNER') throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    return this.repository.createCatalog(user.id, validateCatalogProduct(input));
  }

  async featureFlags(user: RequestUser) {
    void user;
    return { items: await this.repository.listFeatureFlags() };
  }

  async setFeatureFlag(user: RequestUser, key: string, enabled: boolean) {
    if (user.role !== 'OWNER') throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    return this.repository.setFeatureFlag(user.id, validateFeatureFlagKey(key), enabled);
  }

  /** STEP_168: enable/disable closed_beta flag (OWNER only). */
  async setClosedBetaFlag(user: RequestUser, enabled: boolean) {
    if (user.role !== 'OWNER') throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    assertClosedBetaFlagKey(CLOSED_BETA_FLAG_KEY);
    return this.repository.setFeatureFlag(user.id, CLOSED_BETA_FLAG_KEY, enabled);
  }

  async closedBetaStatus(user: RequestUser) {
    void user;
    const items = await this.repository.listFeatureFlags();
    return {
      key: CLOSED_BETA_FLAG_KEY,
      enabled: isClosedBetaEnabled(items),
      items: items.filter((i) => i.key === CLOSED_BETA_FLAG_KEY),
    };
  }

  secretsStatus(user: RequestUser) {
    void user;
    return {
      AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET ? 'configured' : 'not configured',
      DATABASE_URL: process.env.DATABASE_URL ? 'configured' : 'not configured',
      AI_API_KEY: process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
        ? 'configured'
        : 'not configured',
    };
  }

  async setUserRole(actor: RequestUser, targetUserId: string, role: string) {
    if (actor.role !== 'OWNER') throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    await this.authRepository.setAccountRole(actor.id, targetUserId, role);
    return { ok: true, userId: targetUserId, role: String(role).toUpperCase() };
  }

  async setUserSubscription(
    actor: RequestUser,
    targetUserId: string,
    tier: 'FREE' | 'PREMIUM',
    requestId?: string,
  ) {
    if (actor.role !== 'OWNER') throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    await this.authRepository.setSubscriptionTier(targetUserId, tier);
    await this.authRepository.writeAuditLog({
      ownerUserId: actor.id,
      targetUserId,
      action: 'owner.subscription.updated',
      entityType: 'UserSubscription',
      entityId: targetUserId,
      requestId: requestId ?? null,
      metadata: { tier },
    });
    return { ok: true, userId: targetUserId, tier };
  }

  async deactivateUser(actor: RequestUser, targetUserId: string) {
    if (actor.role !== 'OWNER') throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    await this.authRepository.deactivateUser(actor.id, targetUserId);
    return { ok: true, userId: targetUserId, status: 'INACTIVE' };
  }
}
