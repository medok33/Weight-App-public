import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OwnerAdminService } from '../application/owner-admin.service';

function fixture(role: string) {
  const audits: unknown[] = [];
  const repository = {
    recordAudit: async (...args: unknown[]) => audits.push(args),
    listFeatureFlags: async () => [],
    setFeatureFlag: async (_u: string, key: string, enabled: boolean) => ({
      key,
      enabled,
      updatedAt: new Date().toISOString(),
    }),
    searchUsers: async () => [{ id: 'u1', email: 'a@b.c', username: 'alice', accountRole: 'USER', createdAt: '2026-01-01' }],
    overviewMetrics: async () => ({ users: 1, activeSessions: 1, auditEvents: 0 }),
    listCatalog: async () => [],
    createCatalog: async () => ({ id: 'p1' }),
    recordSupportAccess: async () => ({ expiresAt: '2026-01-01' }),
  };
  const authRepository = {
    writeAuditLog: vi.fn(async () => undefined),
    setAccountRole: vi.fn(async () => undefined),
    setSubscriptionTier: vi.fn(async () => undefined),
    deactivateUser: vi.fn(async () => undefined),
  };
  return {
    service: new OwnerAdminService(repository as never, authRepository as never),
    authRepository,
    audits,
    user: { id: 'actor', email: null, username: 'owner', role },
  };
}

describe('RBAC integration matrix', () => {
  it('allows OWNER to mutate feature flags', async () => {
    const { service, user } = fixture('OWNER');
    await expect(service.setFeatureFlag(user, 'new-dashboard', true)).resolves.toMatchObject({
      key: 'new-dashboard',
      enabled: true,
    });
  });

  it('allows ADMIN read but denies mutation', async () => {
    const { service, user } = fixture('ADMIN');
    await expect(service.featureFlags(user)).resolves.toEqual({ items: [] });
    await expect(service.setFeatureFlag(user, 'new-dashboard', true)).rejects.toThrow(ForbiddenException);
  });

  it('records AuditLog when OWNER views another user', async () => {
    const { service, user, authRepository } = fixture('OWNER');
    await service.searchUsers(user, 'al');
    expect(authRepository.writeAuditLog).toHaveBeenCalled();
  });

  it('exposes secrets only as configured status', () => {
    const { service, user } = fixture('OWNER');
    const status = service.secretsStatus(user);
    expect(status.AUTH_SESSION_SECRET === 'configured' || status.AUTH_SESSION_SECRET === 'not configured').toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/sk-|password|secret_value/i);
  });
});
